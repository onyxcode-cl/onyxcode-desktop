/**
 * "Abrir aparte": el documento del Chat se abre en el PROGRAMA de ArtCraft de escritorio (DeckCraft, WordCraft, GridCraft o PdfCraft)
 * si la persona lo tiene instalado, y si no en el programa que su sistema use por defecto para ese tipo de archivo.
 * No descarga ni instala nada: solo busca en las carpetas de instalación habituales y lanza el programa con el archivo como argumento
 * (sin pasar por una shell, el nombre del archivo es un solo argumento).
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type ExternalKind = 'pdf' | 'xlsx' | 'pptx' | 'docx'

const PROGRAM: Record<ExternalKind, string> = { pptx: 'DeckCraft', docx: 'WordCraft', xlsx: 'GridCraft', pdf: 'PdfCraft' }

export interface FindDeps {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  home: string
  exists: (p: string) => boolean
  /** Rutas de programas ya instalados por Lazunox (en Windows, el `.exe` de escritorio viene en el mismo zip que el `-cli.exe`). */
  extra?: string[]
}

/** Ruta del programa de ArtCraft de escritorio para este tipo de documento (`null` si no está instalado o la plataforma no es macOS/Windows). */
export function findCraftApp(kind: ExternalKind, deps: FindDeps): string | null {
  const name = PROGRAM[kind]
  const exe = `${name.toLowerCase()}.exe`
  const candidates: string[] = [...(deps.extra ?? [])]
  if (deps.platform === 'darwin') {
    candidates.push(join('/Applications', `${name}.app`), join(deps.home, 'Applications', `${name}.app`))
  } else if (deps.platform === 'win32') {
    for (const base of [
      deps.env.LOCALAPPDATA && join(deps.env.LOCALAPPDATA, 'Programs'),
      deps.env.ProgramFiles,
      deps.env['ProgramFiles(x86)']
    ]) {
      if (base) candidates.push(join(base, name, exe), join(base, name, `${name}.exe`))
    }
  }
  return candidates.find((p) => deps.exists(p)) ?? null
}

/** Lanza el programa con el archivo. Resuelve cuando el sistema aceptó el lanzamiento (no espera a que la persona cierre el programa). */
function launch(app: string, file: string, platform: NodeJS.Platform): Promise<void> {
  return new Promise((resolve, reject) => {
    if (platform === 'darwin') {
      execFile('open', ['-a', app, file], (err) => (err ? reject(err) : resolve()))
      return
    }
    const child = spawn(app, [file], { detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

/**
 * `'craft'` si se abrió en el programa de ArtCraft; `'system'` si no está y se usó el programa por defecto del sistema (`openPath`);
 * lanza si ninguno pudo abrirlo.
 */
export function defaultFindDeps(extra: string[] = []): FindDeps {
  return { platform: process.platform, env: process.env, home: homedir(), exists: existsSync, extra }
}

/** Programa de escritorio que viene junto al `-cli` ya instalado (Windows: `deckcraft-cli.exe` → `deckcraft.exe`). */
export function guiNextToCli(cliPath: string | null | undefined): string[] {
  if (!cliPath || !/-cli\.exe$/i.test(cliPath)) return []
  return [cliPath.replace(/-cli\.exe$/i, '.exe')]
}

export async function openExternally(
  kind: ExternalKind,
  file: string,
  openPath: (p: string) => Promise<string>,
  deps: FindDeps = defaultFindDeps()
): Promise<'craft' | 'system'> {
  const app = findCraftApp(kind, deps)
  if (app) {
    try {
      await launch(app, file, deps.platform)
      return 'craft'
    } catch (e) {
      console.warn('[craft] no se pudo abrir con el programa de ArtCraft, se usa el del sistema:', e instanceof Error ? e.message : e)
    }
  }
  const err = await openPath(file)
  if (err) throw new Error(err)
  return 'system'
}
