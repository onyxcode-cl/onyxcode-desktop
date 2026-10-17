/**
 * Servicio de habilidades de Personalización (F8-B180).
 *
 *  - Habilidades INCLUIDAS (`resources/opencode/skills/<id>`): se apagan quitando su carpeta de `userData/opencode-config/skills`
 *    (la copia de trabajo que lee el motor) y se encienden copiándola de nuevo desde el paquete, que nunca se toca. Es
 *    determinista: no depende de reglas de permisos del motor. Se aplica a las tareas y conversaciones NUEVAS.
 *  - Habilidades PROPIAS: solo desde una carpeta que la persona elige con el diálogo nativo (lo abre `main`; el renderer nunca
 *    manda una ruta). Se valida (`skill-folder.ts`), se muestra una vista previa y SOLO tras la confirmación se copia, con una
 *    ficha de un solo uso que caduca a los 10 minutos y se compara la huella (si la carpeta cambió, se rechaza). No se descarga
 *    nada, no se ejecuta nada.
 */
import { randomBytes } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { BundledSkillInfo, SkillFolderPreview, SkillsState, UserSkillInfo } from '@shared/ipc-extras'
import { PersonalizacionStore, type UserSkillRecord } from './store'
import { SKILL_PREVIEW_CHARS, SkillFolderError, safeRelative, scanSkillFolder, type ScannedSkill } from './skill-folder'

export const SKILL_TOKEN_TTL_MS = 10 * 60_000

export interface SkillsDeps {
  store: PersonalizacionStore
  /** Copia de trabajo del motor (`userData/opencode-config/skills`). */
  skillsDir: () => string
  /** Habilidades del paquete (`resources/opencode/skills`), solo lectura. */
  bundledDir: () => string
  /** Diálogo nativo de carpeta. `null` = cancelado. */
  pickFolder: () => Promise<string | null>
  /** Avisa al motor (recarga de configuración) tras un cambio. */
  afterChange?: () => Promise<void> | void
  now?: () => number
}

interface Pending {
  token: string
  folder: string
  digest: string
  name: string
  expires: number
}

/** Ids de habilidades incluidas: carpetas con `SKILL.md` (`_shared` no es una habilidad). */
export function bundledSkillIds(bundledDir: string): string[] {
  try {
    return readdirSync(bundledDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('_') && existsSync(join(bundledDir, e.name, 'SKILL.md')))
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

export function createSkillsService(deps: SkillsDeps): {
  list: () => SkillsState
  setEnabled: (req: { id: string; enabled: boolean }) => Promise<SkillsState>
  pick: () => Promise<SkillFolderPreview | null>
  install: (req: { token: string }) => Promise<SkillsState>
  remove: (req: { name: string }) => Promise<SkillsState>
} {
  const now = deps.now ?? Date.now
  let pending: Pending | null = null

  const list = (): SkillsState => {
    const st = deps.store.read()
    const ids = bundledSkillIds(deps.bundledDir())
    const bundled: BundledSkillInfo[] = ids.map((id) => ({ id, enabled: !st.disabledSkills.includes(id) }))
    const user: UserSkillInfo[] = Object.entries(st.userSkills)
      .filter(([name]) => existsSync(join(deps.skillsDir(), name, 'SKILL.md')))
      .map(([name, r]) => ({
        name,
        description: r.description,
        installedAt: r.installedAt,
        fileCount: r.fileCount,
        bytes: r.bytes,
        hasScripts: r.hasScripts,
        modified: isModified(join(deps.skillsDir(), name), r)
      }))
      .sort((a, b) => b.installedAt - a.installedAt)
    return { bundled, user }
  }

  const changed = async (): Promise<void> => {
    try {
      await deps.afterChange?.()
    } catch {
      // el motor puede no estar listo: lo instalado se verá en el siguiente arranque o tarea
    }
  }

  const setEnabled = async ({ id, enabled }: { id: string; enabled: boolean }): Promise<SkillsState> => {
    if (!bundledSkillIds(deps.bundledDir()).includes(id)) throw new SkillFolderError('reserved')
    const dest = join(deps.skillsDir(), id)
    if (enabled) {
      if (!existsSync(dest)) cpSync(join(deps.bundledDir(), id), dest, { recursive: true })
    } else {
      rmSync(dest, { recursive: true, force: true })
    }
    deps.store.update((s) => {
      s.disabledSkills = enabled ? s.disabledSkills.filter((x) => x !== id) : [...new Set([...s.disabledSkills, id])]
    })
    await changed()
    return list()
  }

  const pick = async (): Promise<SkillFolderPreview | null> => {
    const chosen = await deps.pickFolder()
    pending = null
    if (!chosen) return null
    const scanned = scanSkillFolder(chosen)
    checkAvailable(scanned.name)
    const token = randomBytes(16).toString('hex')
    pending = { token, folder: chosen, digest: scanned.digest, name: scanned.name, expires: now() + SKILL_TOKEN_TTL_MS }
    const trunc = scanned.body.length > SKILL_PREVIEW_CHARS
    return {
      token,
      folderLabel: basename(chosen),
      name: scanned.name,
      description: scanned.description,
      fileCount: scanned.files.length,
      bytes: scanned.bytes,
      files: scanned.files.map((f) => ({ path: f.path, bytes: f.bytes, script: f.script })),
      scripts: scanned.files.filter((f) => f.script).map((f) => f.path),
      bodyPreview: trunc ? scanned.body.slice(0, SKILL_PREVIEW_CHARS) : scanned.body,
      bodyTruncated: trunc
    }
  }

  /** El nombre no puede pisar una habilidad incluida ni una ya instalada (nunca se sobrescribe: primero «Quitar»). */
  const checkAvailable = (name: string): void => {
    if (name.startsWith('_') || bundledSkillIds(deps.bundledDir()).includes(name)) throw new SkillFolderError('reserved')
    const st = deps.store.read()
    if (name in st.userSkills || existsSync(join(deps.skillsDir(), name))) throw new SkillFolderError('exists')
  }

  const install = async ({ token }: { token: string }): Promise<SkillsState> => {
    const p = pending
    pending = null // un solo uso, salga bien o mal
    if (!p || p.token !== token || now() > p.expires) throw new SkillFolderError('changed')
    const scanned = scanSkillFolder(p.folder)
    if (scanned.digest !== p.digest || scanned.name !== p.name) throw new SkillFolderError('changed')
    checkAvailable(scanned.name)
    const root = deps.skillsDir()
    mkdirSync(root, { recursive: true })
    const stage = join(root, `.instalando-${randomBytes(6).toString('hex')}`)
    try {
      writeFiles(stage, scanned)
      renameSync(stage, join(root, scanned.name))
    } catch (err) {
      rmSync(stage, { recursive: true, force: true })
      throw err
    }
    const rec: UserSkillRecord = {
      installedAt: now(),
      description: scanned.description,
      fileCount: scanned.files.length,
      bytes: scanned.bytes,
      hasScripts: scanned.files.some((f) => f.script),
      digest: scanned.digest
    }
    try {
      deps.store.update((s) => {
        s.userSkills[scanned.name] = rec
      })
    } catch (err) {
      rmSync(join(root, scanned.name), { recursive: true, force: true })
      throw err
    }
    await changed()
    return list()
  }

  const remove = async ({ name }: { name: string }): Promise<SkillsState> => {
    const st = deps.store.read()
    if (!(name in st.userSkills)) throw new SkillFolderError('reserved') // las incluidas se apagan, no se quitan
    const dir = join(deps.skillsDir(), name)
    // Defensa: el destino es una carpeta normal (no un enlace) dentro de la copia de trabajo.
    if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) throw new SkillFolderError('symlink')
    rmSync(dir, { recursive: true, force: true })
    deps.store.update((s) => {
      delete s.userSkills[name]
    })
    await changed()
    return list()
  }

  return { list, setEnabled, pick, install, remove }
}

function writeFiles(stage: string, scanned: ScannedSkill): void {
  mkdirSync(stage, { recursive: true })
  for (const f of scanned.files) {
    if (!safeRelative(f.path)) throw new SkillFolderError('file-type')
    const target = join(stage, ...f.path.split('/'))
    mkdirSync(join(target, '..'), { recursive: true })
    // Nunca se copian permisos de ejecución: los programas de la habilidad se llaman con su intérprete.
    writeFileSync(target, f.data, { mode: 0o644 })
  }
}

/** ¿Lo instalado ya no coincide con lo que se instaló? Se vuelve a leer la carpeta con las mismas reglas. */
function isModified(dir: string, rec: UserSkillRecord): boolean {
  try {
    return scanSkillFolder(dir).digest !== rec.digest
  } catch {
    return true
  }
}
