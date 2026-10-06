/**
 * GUARDIA de la puerta de compilación de Tareas en Windows (corre en `npm test`, en macOS, sin PC).
 *
 * Con `TASKS_WIN_BUILD = false` solo comprueba que los informes que existan cumplan el esquema. Con `true` exige
 * `docs/evidence/tasks-win-report.{elevated,normal}.json` en verde, de las dos sesiones, cuyos hashes de los
 * archivos de aislamiento coincidan con el código ACTUAL (frescura por contenido: cambia un byte de `launcher.py`
 * y falla), con `rootfsSha`/`opencodeVersion` iguales a los pines. La lógica vive en `tasks-win-report.ts`
 * (probada con dobles); aquí se aplica al repositorio real.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TASKS_WIN_BUILD } from '@shared/feature-flags'
import { gateProblems, ISOLATION_FILES, type EvaluateDeps } from './tasks-win-report'

const ROOT = join(__dirname, '../../..')
const EVIDENCE = join(ROOT, 'docs/evidence')

/** sha256 del contenido con CRLF → LF (un checkout de Windows con autocrlf no debe invalidar el informe). */
function hashOf(rel: string): string | null {
  const f = join(ROOT, rel)
  if (!existsSync(f)) return null
  const text = readFileSync(f)
  const norm = Buffer.from(text.toString('latin1').replace(/\r\n/g, '\n'), 'latin1')
  return createHash('sha256').update(norm).digest('hex')
}

function readJson(name: string): unknown {
  const f = join(EVIDENCE, name)
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : undefined
}

function lastTouchedAt(): Date | null {
  if (!existsSync(join(ROOT, '.git'))) return null
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', ...ISOLATION_FILES], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 10_000
    }).trim()
    return out ? new Date(out) : null
  } catch {
    return null
  }
}

function pins(): EvaluateDeps['pin'] {
  const pin = JSON.parse(readFileSync(join(ROOT, 'resources/opencode-bin/pin.json'), 'utf8')) as Record<string, unknown>
  const rootfs = pin['wsl-rootfs'] as { sha256?: unknown } | undefined
  return {
    rootfsSha: typeof rootfs?.sha256 === 'string' ? rootfs.sha256 : null,
    opencodeVersion: typeof pin.version === 'string' ? pin.version : null
  }
}

describe('guardia del informe de Tareas en Windows', () => {
  it('aplica la puerta con la bandera real (apagada: solo esquema; encendida: informe en verde y al día)', () => {
    const problems = gateProblems(
      TASKS_WIN_BUILD,
      { elevated: readJson('tasks-win-report.elevated.json'), normal: readJson('tasks-win-report.normal.json') },
      { hashOf, pin: pins(), lastTouchedAt: TASKS_WIN_BUILD ? lastTouchedAt() : null }
    )
    expect(problems).toEqual([])
  })

  it('si alguien pusiera la bandera en true HOY, la guardia fallaría (no hay informes en verde del PC)', () => {
    const problems = gateProblems(
      true,
      { elevated: readJson('tasks-win-report.elevated.json'), normal: readJson('tasks-win-report.normal.json') },
      { hashOf, pin: pins(), lastTouchedAt: null }
    )
    expect(problems.length).toBeGreaterThan(0)
  })

  it('TASKS_WIN_BUILD es un LITERAL booleano (no se deriva de entorno ni de otra variable)', () => {
    const src = readFileSync(join(ROOT, 'src/shared/feature-flags.ts'), 'utf8')
    expect(src).toMatch(/^export const TASKS_WIN_BUILD = (?:true|false)$/m)
    expect(src.match(/TASKS_WIN_BUILD\s*=/g)).toHaveLength(1)
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/process\.env|import\.meta|require\(|\bapp\./)
  })

  it('TASKS_WIN_BUILD no se reasigna ni se reexporta con otro valor en ningún sitio del código', () => {
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n)
        if (statSync(p).isDirectory()) {
          if (n !== 'node_modules') walk(p)
        } else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) && p !== join(ROOT, 'src/shared/feature-flags.ts')) {
          const s = readFileSync(p, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '')
          if (/TASKS_WIN_BUILD\s*(?:=[^=]|as\s)|(?:let|var)\s+TASKS_WIN_BUILD|TASKS_WIN_BUILD\s*:\s*boolean/.test(s))
            offenders.push(relative(ROOT, p))
        }
      }
    }
    walk(join(ROOT, 'src'))
    expect(offenders).toEqual([])
  })

  it('LAZUNOX_TASKS_WIN solo se lee en tasks-win-flag.ts y exige isPackaged === false', () => {
    const readers: string[] = []
    const walk = (dir: string): void => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n)
        if (statSync(p).isDirectory()) {
          if (n !== 'node_modules') walk(p)
        } else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) {
          const s = readFileSync(p, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '')
          if (s.includes('LAZUNOX_TASKS_WIN')) readers.push(relative(ROOT, p))
        }
      }
    }
    walk(join(ROOT, 'src'))
    expect(readers).toEqual(['src/main/tasks/tasks-win-flag.ts'])
    const flag = readFileSync(join(ROOT, 'src/main/tasks/tasks-win-flag.ts'), 'utf8')
    expect(flag).toMatch(/env\.LAZUNOX_TASKS_WIN === '1' && isPackaged === false/)
  })

  it('los archivos de aislamiento que exige el informe existen (una renombrada no debe pasar inadvertida)', () => {
    // Los que aún no existen son los de la Parte A pendiente: se listan para que aparezcan al revisar.
    const missing = ISOLATION_FILES.filter((f) => hashOf(f) === null)
    expect(missing).toEqual([])
  })
})
