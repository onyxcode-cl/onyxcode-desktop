/**
 * Contrato IPC tipado del modo Code: terminal (pty), git y diálogos del sistema.
 *
 * - Los canales invoke responden SIEMPRE envueltos en `IpcResult<T>` (igual que `shared/ipc.ts`).
 * - `window.api.code` (ver `src/preload/code-api.ts`) desenvuelve el resultado y lanza
 *   `Error` si `ok === false`.
 */

// ---------------------------------------------------------------------------
// Canales
// ---------------------------------------------------------------------------

export const CODE_CHANNELS = {
  // pty
  ptyCreate: 'pty:create',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyList: 'pty:list',
  ptyAvailable: 'pty:available',
  // git
  gitIsRepo: 'git:isRepo',
  gitStatus: 'git:status',
  gitDiff: 'git:diff',
  gitBranches: 'git:branches',
  gitCurrentBranch: 'git:currentBranch',
  gitWorktrees: 'git:worktrees',
  gitCreateWorktree: 'git:createWorktree',
  gitRemoveWorktree: 'git:removeWorktree',
  gitCommit: 'git:commit',
  gitLog: 'git:log',
  // dialog
  dialogOpenFolder: 'dialog:openFolder',
  dialogRevealInFinder: 'dialog:revealInFinder',
  dialogOpenInEditor: 'dialog:openInEditor'
} as const

export const CODE_EVENTS = {
  ptyData: 'pty:data',
  ptyExit: 'pty:exit'
} as const

// ---------------------------------------------------------------------------
// Tipos de dominio
// ---------------------------------------------------------------------------

export interface PtyCreateRequest {
  cwd: string
  cols: number
  rows: number
  shell?: string
}
export interface PtyInfo {
  id: string
  pid: number
  cwd: string
}
export interface PtyDataEvent {
  id: string
  data: string
}
export interface PtyExitEvent {
  id: string
  exitCode: number
}

export interface GitFileStatus {
  path: string
  index: string
  workingDir: string
}
export interface GitStatus {
  branch: string | null
  ahead: number
  behind: number
  files: GitFileStatus[]
}
export interface GitWorktree {
  path: string
  branch: string | null
  head: string
}

export interface PtyAvailability {
  available: boolean
  /** Motivo si node-pty no pudo cargarse. */
  error?: string
}

export type GitChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'typechange' | 'untracked' | 'ignored' | 'conflicted'

/** Archivo en `git status`. `index`/`workingDir` son las letras XY de porcelain (`' '` = sin cambios). */
export interface GitFileStatusDetailed extends GitFileStatus {
  /** Ruta original en renombres/copias. */
  origPath?: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  conflicted: boolean
  kind: GitChangeKind
}

export interface GitStatusDetailed extends GitStatus {
  isRepo: boolean
  /** Raíz del repo (toplevel) o null si no es repo. */
  root: string | null
  /** SHA del HEAD o null si la rama no tiene commits. */
  head: string | null
  detached: boolean
  upstream: string | null
  files: GitFileStatusDetailed[]
}

export interface GitDiffRequest {
  cwd: string
  /** Archivo (relativo a la raíz del repo o absoluto dentro de él). Omitido = todo el repo. */
  path?: string
  /**
   * `true` = solo staged; `false` = solo unstaged + untracked; omitido = todo
   * (staged + unstaged + untracked como diffs de alta completa).
   */
  staged?: boolean
}

export interface GitBranch {
  name: string
  current: boolean
  upstream: string | null
  /** SHA corto. */
  head: string
}

export interface GitWorktreeDetailed extends GitWorktree {
  main: boolean
  bare: boolean
  detached: boolean
  locked: boolean
  prunable: boolean
}

export interface GitCommitResult {
  hash: string
  shortHash: string
  summary: string
}

export interface GitLogEntry {
  hash: string
  shortHash: string
  author: string
  email: string
  /** Epoch en milisegundos. */
  date: number
  subject: string
}

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

export interface CodeInvokeContract {
  'pty:create': { req: PtyCreateRequest; res: PtyInfo }
  'pty:write': { req: { id: string; data: string }; res: void }
  'pty:resize': { req: { id: string; cols: number; rows: number }; res: void }
  'pty:kill': { req: { id: string }; res: void }
  'pty:list': { req: void; res: PtyInfo[] }
  'pty:available': { req: void; res: PtyAvailability }

  'git:isRepo': { req: { cwd: string }; res: boolean }
  'git:status': { req: { cwd: string }; res: GitStatusDetailed }
  'git:diff': { req: GitDiffRequest; res: string }
  'git:branches': { req: { cwd: string }; res: GitBranch[] }
  'git:currentBranch': { req: { cwd: string }; res: string | null }
  'git:worktrees': { req: { cwd: string }; res: GitWorktreeDetailed[] }
  'git:createWorktree': { req: { cwd: string; branch: string; base?: string }; res: { path: string; branch: string } }
  'git:removeWorktree': { req: { cwd: string; path: string; force?: boolean }; res: void }
  'git:commit': { req: { cwd: string; message: string; stageAll?: boolean }; res: GitCommitResult }
  'git:log': { req: { cwd: string; n?: number }; res: GitLogEntry[] }

  'dialog:openFolder': { req: { title?: string; defaultPath?: string } | undefined; res: string | null }
  'dialog:revealInFinder': { req: { path: string }; res: void }
  'dialog:openInEditor': { req: { path: string }; res: { via: 'code' | 'open' } }
}

export interface CodeEventContract {
  'pty:data': PtyDataEvent
  'pty:exit': PtyExitEvent
}

export type CodeInvokeChannel = keyof CodeInvokeContract
export type CodeEventChannel = keyof CodeEventContract
export type CodeRequest<C extends CodeInvokeChannel> = CodeInvokeContract[C]['req']
export type CodeResponse<C extends CodeInvokeChannel> = CodeInvokeContract[C]['res']

type ChannelValues = (typeof CODE_CHANNELS)[keyof typeof CODE_CHANNELS]
// Garantiza en compilación que CODE_CHANNELS y el contrato coinciden exactamente.
const _cover1: Exclude<CodeInvokeChannel, ChannelValues> extends never ? true : never = true
const _cover2: Exclude<ChannelValues, CodeInvokeChannel> extends never ? true : never = true
void _cover1
void _cover2

export const CODE_INVOKE_CHANNELS = Object.values(CODE_CHANNELS) as readonly CodeInvokeChannel[]

// ---------------------------------------------------------------------------
// API expuesta en `window.api.code`
// ---------------------------------------------------------------------------

export interface CodeApi {
  pty: {
    available(): Promise<PtyAvailability>
    create(req: PtyCreateRequest): Promise<PtyInfo>
    write(id: string, data: string): Promise<void>
    resize(id: string, cols: number, rows: number): Promise<void>
    kill(id: string): Promise<void>
    list(): Promise<PtyInfo[]>
  }
  git: {
    isRepo(cwd: string): Promise<boolean>
    status(cwd: string): Promise<GitStatusDetailed>
    diff(req: GitDiffRequest): Promise<string>
    branches(cwd: string): Promise<GitBranch[]>
    currentBranch(cwd: string): Promise<string | null>
    worktrees(cwd: string): Promise<GitWorktreeDetailed[]>
    createWorktree(cwd: string, branch: string, base?: string): Promise<{ path: string; branch: string }>
    removeWorktree(cwd: string, path: string, force?: boolean): Promise<void>
    commit(cwd: string, message: string, stageAll?: boolean): Promise<GitCommitResult>
    log(cwd: string, n?: number): Promise<GitLogEntry[]>
  }
  dialog: {
    openFolder(opts?: { title?: string; defaultPath?: string }): Promise<string | null>
    revealInFinder(path: string): Promise<void>
    openInEditor(path: string): Promise<{ via: 'code' | 'open' }>
  }
  /** Salida de todas las terminales de esta ventana. Devuelve función para desuscribir. */
  onPtyData(cb: (e: PtyDataEvent) => void): () => void
  onPtyExit(cb: (e: PtyExitEvent) => void): () => void
}
