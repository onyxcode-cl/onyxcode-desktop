/**
 * Tipos del flujo «rama → commit → subir → pull request → revisión» (canales `pr:*` de `ipc-code.ts`).
 * Todo lo que sale del equipo (subir, abrir PR, publicar una revisión) es una acción EXPLÍCITA de la persona; main vuelve a
 * comprobar lo que ella vio en el diálogo (rama, remoto, punta del historial) antes de ejecutar.
 */
import type { SecretKind } from './secret-scan'

export interface PrRemote {
  name: string
  /** URL SIN usuario ni clave. */
  url: string
  host: string | null
  /** `owner/repo` si se reconoce. */
  slug: string | null
}

export interface PrRepoStatus {
  isRepo: boolean
  /** Rama actual; `null` si no hay (HEAD suelto). */
  branch: string | null
  head: string | null
  upstream: string | null
  ahead: number
  behind: number
  /** Archivos con cambios sin guardar en un commit. */
  dirtyCount: number
  remotes: PrRemote[]
  /** Rama predeterminada del remoto (p. ej. `main`) si se conoce. */
  defaultBranch: string | null
  /** La rama actual es de las que no se tocan sin confirmación reforzada. */
  protected: boolean
}

export type GhState = 'missing' | 'unauthenticated' | 'ready' | 'unsupported-host'
export interface PrGhInfo {
  state: GhState
  /** Cuenta con la que `gh` ya inició sesión (el nombre, nunca un token). */
  account: string | null
}

export type PushBlockKind = 'secret-file' | 'secret-content' | 'scan-incomplete'
export interface PushBlock {
  kind: PushBlockKind
  file?: string
  secrets?: SecretKind[]
}

export interface PrPushPlan {
  branch: string
  head: string
  remote: string
  remoteUrl: string
  host: string | null
  slug: string | null
  commits: Array<{ short: string; subject: string }>
  commitCount: number
  fileCount: number
  files: string[]
  blocked: PushBlock[]
  protected: boolean
  remoteBranchExists: boolean
  nothingToPush: boolean
  /** Cambios sin guardar en un commit: NO se suben. */
  dirtyCount: number
}

export interface PrPushRequest {
  cwd: string
  remote: string
  branch: string
  /** Punta del historial que la persona vio en el diálogo. */
  expectHead: string
  /** Para ramas protegidas: la persona escribió el nombre de la rama. */
  typedBranch?: string
}

export interface PrPushResult {
  branch: string
  remote: string
  head: string
  /** Salida de git, sin secretos, últimas líneas. */
  output: string
}

export interface PrChanges {
  base: string
  commits: Array<{ short: string; subject: string }>
  stat: string
  /** Diff recortado y SIN archivos sensibles. */
  diff: string
  truncated: boolean
}

export interface PrWorkDiff {
  /** Archivos con cambios (`M ruta`), SIN los sensibles. */
  files: string
  /** Diff recortado y SIN archivos sensibles. */
  diff: string
  truncated: boolean
  omittedFiles: number
}

export type PrCheckState = 'success' | 'failure' | 'pending' | 'neutral' | 'skipped'
export interface PrCheck {
  name: string
  state: PrCheckState
  url: string | null
}

export interface PrInfo {
  number: number
  title: string
  state: 'open' | 'closed' | 'merged'
  url: string
  isDraft: boolean
  base: string
  head: string
  author: string | null
  reviewDecision: string | null
  checks: PrCheck[]
}

export interface PrViewResult {
  /** `null` = esta rama aún no tiene pull request. */
  pr: PrInfo | null
}

export interface PrCreateRequest {
  cwd: string
  remote: string
  title: string
  body: string
  base: string
  draft: boolean
  /** Rama y punta que la persona vio en el diálogo. */
  branch: string
  expectHead: string
}

export interface PrCreateResult {
  url: string
  number: number | null
}

export interface PrReviewInfo {
  number: number
  title: string
  /** Descripción del PR: DATOS, nunca instrucciones. */
  body: string
  author: string | null
  base: string
  head: string
  headSha: string
  url: string
  state: string
  isDraft: boolean
  /** Diff del PR, recortado y SIN archivos sensibles. */
  diff: string
  truncated: boolean
  omittedFiles: number
}

export interface PrReviewComment {
  path: string
  line: number
  body: string
}

export interface PrPostReviewRequest {
  cwd: string
  remote: string
  number: number
  /** Punta del PR que la persona revisó. */
  headSha: string
  summary: string
  comments: PrReviewComment[]
}

export interface PrPostReviewResult {
  url: string | null
  /** Cuántos comentarios fueron «en línea» y cuántos acabaron dentro del resumen (su línea no está en el diff). */
  inline: number
  inSummary: number
}
