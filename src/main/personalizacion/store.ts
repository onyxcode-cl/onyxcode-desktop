/**
 * Estado de Personalización (F8-B180): qué habilidades incluidas están apagadas y cuáles instaló la persona desde una carpeta.
 * Vive en `userData/personalizacion.json`, sin secretos. Sin dependencias de Electron: lo leen también `opencode-config.ts`
 * (para no borrar las habilidades propias al refrescar las incluidas) y las pruebas.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { SKILL_NAME_RE } from '@shared/skill-proposal'

export interface UserSkillRecord {
  installedAt: number
  description: string
  fileCount: number
  bytes: number
  hasScripts: boolean
  /** Huella del contenido instalado (para saber si alguien lo tocó a mano). */
  digest: string
}

export interface PersonalizacionState {
  disabledSkills: string[]
  userSkills: Record<string, UserSkillRecord>
}

export const EMPTY_STATE = (): PersonalizacionState => ({ disabledSkills: [], userSkills: {} })

const validName = (n: unknown): n is string => typeof n === 'string' && n.length > 0 && n.length <= 64 && SKILL_NAME_RE.test(n)

/** Lee el archivo; cualquier cosa rara se ignora (nunca lanza). */
export function readPersonalizacionState(path: string): PersonalizacionState {
  try {
    if (!existsSync(path)) return EMPTY_STATE()
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_STATE()
    const o = raw as Record<string, unknown>
    const out = EMPTY_STATE()
    if (Array.isArray(o.disabledSkills)) out.disabledSkills = [...new Set(o.disabledSkills.filter(validName))]
    if (o.userSkills && typeof o.userSkills === 'object' && !Array.isArray(o.userSkills)) {
      for (const [name, v] of Object.entries(o.userSkills as Record<string, unknown>)) {
        if (!validName(name) || !v || typeof v !== 'object') continue
        const r = v as Record<string, unknown>
        if (typeof r.installedAt !== 'number' || typeof r.description !== 'string' || typeof r.digest !== 'string') continue
        out.userSkills[name] = {
          installedAt: r.installedAt,
          description: r.description.slice(0, 1024),
          fileCount: typeof r.fileCount === 'number' ? r.fileCount : 0,
          bytes: typeof r.bytes === 'number' ? r.bytes : 0,
          hasScripts: r.hasScripts === true,
          digest: r.digest
        }
      }
    }
    return out
  } catch {
    return EMPTY_STATE()
  }
}

export class PersonalizacionStore {
  constructor(readonly path: string) {}

  read(): PersonalizacionState {
    return readPersonalizacionState(this.path)
  }

  write(state: PersonalizacionState): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8')
    renameSync(tmp, this.path)
  }

  update(fn: (s: PersonalizacionState) => void): PersonalizacionState {
    const s = this.read()
    fn(s)
    this.write(s)
    return s
  }
}
