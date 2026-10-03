/**
 * Catálogo FIJO de editores para «Abrir en…». El renderer solo envía un id de `EDITOR_IDS`; aquí se decide,
 * por plataforma, dónde buscarlo (rutas conocidas) y con qué argumentos se lanza (siempre un arreglo, sin shell).
 * Puro (sin Electron): la detección recibe `exists`/`readdir` inyectados para poder probarla con rutas simuladas.
 */
import { isAbsolute, join as posixJoin } from 'node:path/posix'
import { join as winJoin } from 'node:path/win32'
import { EDITOR_IDS, type EditorId, type EditorInfo } from '@shared/ipc-code'
import { codeCandidates } from '../dialog/code-candidates'

export interface EditorEnv {
  platform: string
  env: Record<string, string | undefined>
  home: string
  exists: (path: string) => boolean
  readdir?: (path: string) => string[]
}

export interface LaunchSpec {
  cmd: string
  args: string[]
}

const LABELS: Record<EditorId, string> = {
  vscode: 'Visual Studio Code',
  cursor: 'Cursor',
  zed: 'Zed',
  sublime: 'Sublime Text',
  webstorm: 'WebStorm',
  intellij: 'IntelliJ IDEA',
  system: 'System'
}

interface Def {
  /** macOS: nombres de `.app` en /Applications y ~/Applications. */
  mac: string[]
  /** Windows: rutas relativas a una variable de entorno (se prueban en orden). */
  win: Array<{ base: string; rel: string[] } | { base: string; dir: string; startsWith: string; rel: string[] }>
  /** Linux: nombres de ejecutable en carpetas conocidas. */
  linux: string[]
}

const DEFS: Record<Exclude<EditorId, 'system' | 'vscode'>, Def> = {
  cursor: {
    mac: ['Cursor.app'],
    win: [
      { base: 'LOCALAPPDATA', rel: ['Programs', 'cursor', 'Cursor.exe'] },
      { base: 'LOCALAPPDATA', rel: ['Programs', 'Cursor', 'Cursor.exe'] }
    ],
    linux: ['cursor']
  },
  zed: {
    mac: ['Zed.app', 'Zed Preview.app'],
    win: [{ base: 'LOCALAPPDATA', rel: ['Programs', 'Zed', 'Zed.exe'] }],
    linux: ['zed', 'zeditor']
  },
  sublime: {
    mac: ['Sublime Text.app'],
    win: [
      { base: 'ProgramFiles', rel: ['Sublime Text', 'sublime_text.exe'] },
      { base: 'ProgramFiles', rel: ['Sublime Text 3', 'sublime_text.exe'] }
    ],
    linux: ['subl', 'sublime_text']
  },
  webstorm: {
    mac: ['WebStorm.app'],
    win: [{ base: 'ProgramFiles', dir: 'JetBrains', startsWith: 'WebStorm', rel: ['bin', 'webstorm64.exe'] }],
    linux: ['webstorm']
  },
  intellij: {
    mac: ['IntelliJ IDEA.app', 'IntelliJ IDEA CE.app', 'IntelliJ IDEA Ultimate.app'],
    win: [{ base: 'ProgramFiles', dir: 'JetBrains', startsWith: 'IntelliJ IDEA', rel: ['bin', 'idea64.exe'] }],
    linux: ['idea', 'intellij-idea-ultimate', 'intellij-idea-community']
  }
}

const getEnv = (env: Record<string, string | undefined>, name: string): string | undefined =>
  env[Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase()) ?? name]

/** Primera ruta/app instalada del editor (o `null`). Para `vscode` reutiliza los candidatos ya existentes. */
function findInstall(id: Exclude<EditorId, 'system'>, e: EditorEnv): { kind: 'app' | 'exe'; path: string } | null {
  if (e.platform === 'darwin') {
    const apps = id === 'vscode' ? ['Visual Studio Code.app'] : DEFS[id].mac
    for (const dir of ['/Applications', posixJoin(e.home, 'Applications')])
      for (const app of apps) {
        const p = posixJoin(dir, app)
        if (e.exists(p)) return { kind: 'app', path: p }
      }
    return null
  }
  if (e.platform === 'win32') {
    if (id === 'vscode') {
      for (const p of codeCandidates('win32', e.env as NodeJS.ProcessEnv)) if (e.exists(p)) return { kind: 'exe', path: p }
      return null
    }
    for (const w of DEFS[id].win) {
      const base = getEnv(e.env, w.base)
      if (!base) continue
      if ('dir' in w) {
        const root = winJoin(base, w.dir)
        let names: string[] = []
        try {
          names = e.readdir?.(root) ?? []
        } catch {
          names = []
        }
        for (const n of names
          .filter((x) => x.startsWith(w.startsWith))
          .sort()
          .reverse()) {
          const p = winJoin(root, n, ...w.rel)
          if (e.exists(p)) return { kind: 'exe', path: p }
        }
      } else {
        const p = winJoin(base, ...w.rel)
        if (e.exists(p)) return { kind: 'exe', path: p }
      }
    }
    return null
  }
  // Linux y similares: ejecutables en carpetas conocidas (siempre rutas absolutas, nunca el PATH).
  const names = id === 'vscode' ? ['code'] : DEFS[id].linux
  for (const dir of ['/usr/bin', '/usr/local/bin', '/snap/bin', '/opt/homebrew/bin', posixJoin(e.home, '.local', 'bin')])
    for (const n of names) {
      const p = posixJoin(dir, n)
      if (e.exists(p)) return { kind: 'exe', path: p }
    }
  return null
}

/** Editores detectados, en el orden del catálogo; «system» (aplicación predeterminada) siempre al final. */
export function detectEditors(e: EditorEnv): EditorInfo[] {
  const out: EditorInfo[] = []
  for (const id of EDITOR_IDS) {
    if (id === 'system') continue
    if (findInstall(id, e)) out.push({ id, label: LABELS[id] })
  }
  out.push({ id: 'system', label: LABELS.system })
  return out
}

/**
 * Cómo abrir `folder` con el editor `id`: `null` si no está instalado (o es `system`, que lo resuelve el servicio).
 * La carpeta debe ser absoluta (así nunca se interpreta como opción).
 */
export function launchSpec(id: EditorId, folder: string, e: EditorEnv): LaunchSpec | null {
  if (id === 'system') return null
  if (!(EDITOR_IDS as readonly string[]).includes(id)) return null
  if (typeof folder !== 'string' || folder.includes('\0') || !(isAbsolute(folder) || /^[A-Za-z]:[\\/]/.test(folder))) return null
  const found = findInstall(id, e)
  if (!found) return null
  return found.kind === 'app' ? { cmd: 'open', args: ['-a', found.path, folder] } : { cmd: found.path, args: [folder] }
}

// ---- Solo pruebas ----

export interface E2eEditors {
  /** Archivo donde se registra cada llamada (JSON por línea) en lugar de lanzar nada. */
  log: string
  detected: EditorId[]
}

/** `ONYXCODE_E2E_EDITOR_LOG` (+ `ONYXCODE_E2E_EDITORS`): honrada ÚNICAMENTE con la app sin empaquetar. */
export function resolveE2eEditors(i: { isPackaged: boolean; env: Record<string, string | undefined> }): E2eEditors | null {
  const log = !i.isPackaged ? i.env.ONYXCODE_E2E_EDITOR_LOG : undefined
  if (!log || !(isAbsolute(log) || /^[A-Za-z]:[\\/]/.test(log))) return null
  const want = (i.env.ONYXCODE_E2E_EDITORS ?? 'vscode,zed').split(',').map((s) => s.trim())
  return { log, detected: EDITOR_IDS.filter((id) => id !== 'system' && want.includes(id)) }
}

export const editorLabel = (id: EditorId): string => LABELS[id]
