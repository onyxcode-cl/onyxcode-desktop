/** Consentimiento de la beta de Tareas en Windows: archivo propio, versionado, falla cerrado, armado de 600 ms. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createTasksWinBetaController,
  createTasksWinBetaStore,
  readTasksWinBetaConsent,
  TASKS_WIN_BETA_CONSENT_FILE,
  TASKS_WIN_BETA_CONSENT_VERSION,
  tasksWinBetaConsentPath
} from './tasks-win-beta-consent'
import { resolveTasksWin } from './tasks-win-flag'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lazunox-beta-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const file = (): string => join(dir, TASKS_WIN_BETA_CONSENT_FILE)
const put = (raw: string): void => writeFileSync(file(), raw)

describe('lectura (falla cerrado)', () => {
  it('archivo ausente: sin consentimiento', () => {
    expect(readTasksWinBetaConsent(dir)).toBe(false)
  })
  it('corrupto o de forma rara: sin consentimiento', () => {
    for (const raw of [
      '',
      '{',
      'null',
      '[]',
      '"si"',
      '{"version":1}',
      '{"at":5}',
      '{"version":"1","at":5}',
      '{"version":1,"at":0}',
      '{"version":1.5,"at":5}'
    ]) {
      put(raw)
      expect(readTasksWinBetaConsent(dir), raw).toBe(false)
    }
  })
  it('versión vigente válida: con consentimiento', () => {
    put(JSON.stringify({ version: TASKS_WIN_BETA_CONSENT_VERSION, at: 1000 }))
    expect(readTasksWinBetaConsent(dir)).toBe(true)
  })
  it('versión vieja o futura: sin consentimiento; subir la versión vigente invalida el guardado', () => {
    put(JSON.stringify({ version: TASKS_WIN_BETA_CONSENT_VERSION - 1, at: 1000 }))
    expect(readTasksWinBetaConsent(dir)).toBe(false)
    put(JSON.stringify({ version: TASKS_WIN_BETA_CONSENT_VERSION + 1, at: 1000 }))
    expect(readTasksWinBetaConsent(dir)).toBe(false)
    put(JSON.stringify({ version: TASKS_WIN_BETA_CONSENT_VERSION, at: 1000 }))
    expect(readTasksWinBetaConsent(dir, TASKS_WIN_BETA_CONSENT_VERSION + 1)).toBe(false)
  })
  it('un directorio donde debería haber un archivo, o una ruta imposible: sin consentimiento y sin lanzar', () => {
    expect(readTasksWinBetaConsent(join(dir, 'no', 'existe'))).toBe(false)
  })
})

describe('controlador (casilla + armado 600 ms + revocación)', () => {
  const mk = (): { c: ReturnType<typeof createTasksWinBetaController>; tick: (ms: number) => void } => {
    let t = 10_000
    return { c: createTasksWinBetaController(createTasksWinBetaStore(dir), () => t), tick: (ms) => void (t += ms) }
  }
  it('sin mostrar ni marcar no concede nada', () => {
    const { c, tick } = mk()
    tick(5000)
    expect(c.confirm()).toBe(false)
    expect(existsSync(file())).toBe(false)
  })
  it('armado antes de 600 ms: no concede; con casilla y tras 600 ms sí', () => {
    const { c, tick } = mk()
    c.show()
    c.setChecked(true)
    tick(599)
    expect(c.armed()).toBe(false)
    expect(c.confirm()).toBe(false)
    expect(readTasksWinBetaConsent(dir)).toBe(false)
    tick(1)
    expect(c.armed()).toBe(true)
    expect(c.confirm()).toBe(true)
    expect(readTasksWinBetaConsent(dir)).toBe(true)
  })
  it('sin casilla no concede aunque pase el tiempo; desmarcar desarma', () => {
    const { c, tick } = mk()
    c.show()
    tick(5000)
    expect(c.confirm()).toBe(false)
    c.setChecked(true)
    c.setChecked(false)
    expect(c.confirm()).toBe(false)
  })
  it('mostrar de nuevo reinicia el armado y desmarca la casilla', () => {
    const { c, tick } = mk()
    c.show()
    c.setChecked(true)
    tick(1000)
    c.show()
    expect(c.armed()).toBe(false)
    expect(c.confirm()).toBe(false)
  })
  it('concede una sola vez por armado (tras confirmar hay que volver a mostrar)', () => {
    const { c, tick } = mk()
    c.show()
    c.setChecked(true)
    tick(700)
    expect(c.confirm()).toBe(true)
    expect(c.confirm()).toBe(false)
  })
  it('guarda {version, at} con modo 0600 y sin archivo temporal', () => {
    const { c, tick } = mk()
    c.show()
    c.setChecked(true)
    tick(700)
    c.confirm()
    const saved = JSON.parse(readFileSync(file(), 'utf8')) as { version: number; at: number }
    expect(saved).toEqual({ version: TASKS_WIN_BETA_CONSENT_VERSION, at: 10_700 })
    if (process.platform !== 'win32') expect(statSync(file()).mode & 0o777).toBe(0o600)
    expect(existsSync(`${file()}.tmp`)).toBe(false)
    expect(tasksWinBetaConsentPath(dir)).toBe(file())
  })
  it('revocar es inmediato y la lectura siguiente ya da false', () => {
    const { c, tick } = mk()
    c.show()
    c.setChecked(true)
    tick(700)
    c.confirm()
    expect(readTasksWinBetaConsent(dir)).toBe(true)
    c.revoke()
    expect(readTasksWinBetaConsent(dir)).toBe(false)
    expect(existsSync(file())).toBe(false)
    expect(c.view().consent).toBe(false)
  })
  it('un consentimiento de otra versión se ve como «stale» y no vale', () => {
    put(JSON.stringify({ version: 0 + TASKS_WIN_BETA_CONSENT_VERSION + 1, at: 5 }))
    const { c } = mk()
    expect(c.view()).toMatchObject({ consent: false, stale: true, version: TASKS_WIN_BETA_CONSENT_VERSION })
  })
})

describe('el renderer no puede fabricar el consentimiento', () => {
  const base = { platform: 'win32', build: true, env: {}, isPackaged: true, policy: null }
  it('settings.tasksWinBeta=true SOLO no enciende nada: optIn viene solo del archivo de main', () => {
    // El ajuste legado queda en settings.json (que el renderer escribe); main solo mira el archivo propio.
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ tasksWinBeta: true }))
    expect(resolveTasksWin({ ...base, optIn: readTasksWinBetaConsent(dir) })).toBe(false)
  })
  it('con el archivo vigente de main sí; revocado, otra vez no', () => {
    put(JSON.stringify({ version: TASKS_WIN_BETA_CONSENT_VERSION, at: 1 }))
    expect(resolveTasksWin({ ...base, optIn: readTasksWinBetaConsent(dir) })).toBe(true)
    rmSync(file())
    expect(resolveTasksWin({ ...base, optIn: readTasksWinBetaConsent(dir) })).toBe(false)
  })
  it('la política disableWslTasks gana sobre el consentimiento', () => {
    put(JSON.stringify({ version: TASKS_WIN_BETA_CONSENT_VERSION, at: 1 }))
    expect(resolveTasksWin({ ...base, optIn: readTasksWinBetaConsent(dir), policy: { disableWslTasks: true } })).toBe(false)
  })
})
