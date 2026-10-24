// F8-B42: el modelo elegido sobrevive a normalize, a escrituras de otros ajustes y a reabrir (releer settings.json).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const dirs: string[] = []
const userData = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'lazunox-store-model-'))
  dirs.push(d)
  return d
}
async function openStore(dir: string) {
  vi.resetModules()
  vi.doMock('electron', () => ({ app: { getPath: () => dir } }))
  return (await import('./store')).settingsStore
}

afterEach(() => {
  vi.doUnmock('electron')
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const LUNA = { providerID: 'opencode-go', modelID: 'gpt-5.6-luna' }

describe('settings: defaultModel (modelo de Chat)', () => {
  it('se guarda tal cual aunque no sea el predeterminado de fábrica ni esté en ninguna lista', async () => {
    const dir = userData()
    const store = await openStore(dir)
    store.set({ defaultModel: LUNA })
    expect(store.get().defaultModel).toEqual(LUNA)
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).defaultModel).toEqual(LUNA)
  })

  it('otros ajustes (tema, carpetas recientes, asistente) no lo tocan', async () => {
    const dir = userData()
    const store = await openStore(dir)
    store.set({ defaultModel: LUNA })
    store.set({ theme: 'dark' })
    store.addRecentFolder('/tmp/x')
    store.set({ onboarded: true, language: 'en', checkUpdates: false })
    expect(store.get().defaultModel).toEqual(LUNA)
  })

  it('reabrir la app (releer settings.json) conserva el modelo', async () => {
    const dir = userData()
    const first = await openStore(dir)
    first.set({ defaultModel: LUNA })
    const second = await openStore(dir)
    expect(second.get().defaultModel).toEqual(LUNA)
  })

  it('un settings.json con el modelo bien formado no se reemplaza; uno corrupto sí vuelve al de fábrica', async () => {
    const dir = userData()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ defaultModel: LUNA }))
    expect((await openStore(dir)).get().defaultModel).toEqual(LUNA)
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ defaultModel: { providerID: 1 } }))
    expect((await openStore(dir)).get().defaultModel.providerID).toBe('opencode-go')
  })
})

describe('settings: codeTrustedMcp', () => {
  it('sin el campo en disco -> vacío (ningún conector de confianza: Code pregunta)', async () => {
    const dir = userData()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ theme: 'dark' }))
    expect((await openStore(dir)).get().codeTrustedMcp).toEqual([])
  })
  it('basura en disco -> se limpia sin lanzar', async () => {
    const dir = userData()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ codeTrustedMcp: ['gmail', 7, 'a b', 'gmail', 'browser', { x: 1 }] }))
    expect((await openStore(dir)).get().codeTrustedMcp).toEqual(['gmail'])
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ codeTrustedMcp: 'todos' }))
    expect((await openStore(dir)).get().codeTrustedMcp).toEqual([])
  })
  it('se guarda y relee de disco', async () => {
    const dir = userData()
    const store = await openStore(dir)
    store.set({ codeTrustedMcp: ['crm'] })
    store.set({ theme: 'dark' })
    expect((await openStore(dir)).get().codeTrustedMcp).toEqual(['crm'])
  })
})

describe('settings: engineExperiments', () => {
  const OFF = { chat: false, code: false, tasks: false }
  const ON = { chat: true, code: true, tasks: true }
  it('sin el campo en disco -> todo apagado', async () => {
    const dir = userData()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ theme: 'dark' }))
    const store = await openStore(dir)
    expect(store.get().engineExperiments).toEqual({ codeMode: OFF, backgroundSubagents: ON })
  })
  it('basura en disco -> defaults, sin lanzar', async () => {
    const dir = userData()
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ engineExperiments: { codeMode: 'x', backgroundSubagents: { chat: 'si', code: 1 } } })
    )
    const store = await openStore(dir)
    expect(store.get().engineExperiments).toEqual({ codeMode: OFF, backgroundSubagents: ON })
  })
  it('1.6.0: un settings.json antiguo con «todo apagado» enciende los ayudantes (sin escribir al leer) y respeta que luego se apaguen', async () => {
    const dir = userData()
    const antiguo = JSON.stringify({ theme: 'dark', engineExperiments: { codeMode: OFF, backgroundSubagents: OFF } })
    writeFileSync(join(dir, 'settings.json'), antiguo)
    const store = await openStore(dir)
    expect(store.get().engineExperiments).toEqual({ codeMode: OFF, backgroundSubagents: ON })
    // Leer NO toca el archivo (las migraciones de datos viejos lo necesitan intacto).
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toBe(antiguo)
    // Una escritura normal guarda el marcador, y a partir de ahí lo que la persona apague se respeta.
    store.set({ engineExperiments: { codeMode: OFF, backgroundSubagents: OFF } })
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).engineBgMigrated).toBe(true)
    const reopened = await openStore(dir)
    expect(reopened.get().engineExperiments.backgroundSubagents).toEqual(OFF)
  })
  it('se guarda, sobrevive a otras escrituras y relee de disco', async () => {
    const dir = userData()
    const store = await openStore(dir)
    store.set({ engineExperiments: { codeMode: { ...OFF, code: true }, backgroundSubagents: OFF } })
    store.set({ theme: 'dark' })
    expect(store.get().engineExperiments.codeMode.code).toBe(true)
    const reopened = await openStore(dir)
    expect(reopened.get().engineExperiments).toEqual({ codeMode: { ...OFF, code: true }, backgroundSubagents: OFF })
  })
})

describe('settings: engineLimits', () => {
  it('un settings.json antiguo sin el campo recibe los defectos (objeto vacío)', async () => {
    const dir = userData()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ theme: 'dark' }))
    const store = await openStore(dir)
    expect(store.get().engineLimits).toEqual({})
  })
  it('basura y valores fuera de rango o iguales al defecto en disco se descartan', async () => {
    const dir = userData()
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ engineLimits: { codeTimeoutMin: 9999, codeMaxCalls: '5', codeMaxCells: 3, shellLifeMin: 45, extra: 1 } })
    )
    const store = await openStore(dir)
    expect(store.get().engineLimits).toEqual({ shellLifeMin: 45 })
    const bad = userData()
    writeFileSync(join(bad, 'settings.json'), JSON.stringify({ engineLimits: 'x' }))
    expect((await openStore(bad)).get().engineLimits).toEqual({})
  })
  it('se guarda solo lo cambiado, sobrevive a otras escrituras y «restablecer» lo borra', async () => {
    const dir = userData()
    const store = await openStore(dir)
    store.set({ engineLimits: { codeTimeoutMin: 20, codeMaxCells: 3 } })
    store.set({ theme: 'dark' })
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).engineLimits).toEqual({ codeTimeoutMin: 20 })
    expect((await openStore(dir)).get().engineLimits).toEqual({ codeTimeoutMin: 20 })
    const again = await openStore(dir)
    again.set({ engineLimits: {} })
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).engineLimits).toEqual({})
  })
})

describe('settings: rememberAlways (recordar «siempre»)', () => {
  it('un settings.json anterior sin el campo lo recibe ENCENDIDO (sin migración: campo nuevo, no cambia valores guardados)', async () => {
    const dir = userData()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ theme: 'dark' }))
    expect((await openStore(dir)).get().rememberAlways).toBe(true)
  })
  it('sin settings.json también encendido', async () => {
    expect((await openStore(userData())).get().rememberAlways).toBe(true)
  })
  it('solo `false` exacto lo apaga; basura en disco = encendido', async () => {
    for (const raw of ['no', 0, null, 'false']) {
      const dir = userData()
      writeFileSync(join(dir, 'settings.json'), JSON.stringify({ rememberAlways: raw }))
      expect((await openStore(dir)).get().rememberAlways, String(raw)).toBe(true)
    }
    const dir = userData()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ rememberAlways: false }))
    expect((await openStore(dir)).get().rememberAlways).toBe(false)
  })
  it('se guarda, sobrevive a otras escrituras y relee de disco', async () => {
    const dir = userData()
    const store = await openStore(dir)
    store.set({ rememberAlways: false })
    store.set({ theme: 'dark' })
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).rememberAlways).toBe(false)
    expect((await openStore(dir)).get().rememberAlways).toBe(false)
  })
})

describe('settings: userHooksEnabled (ganchos de usuario)', () => {
  it('apagado por defecto, con y sin settings.json', async () => {
    expect((await openStore(userData())).get().userHooksEnabled).toBe(false)
    const dir = userData()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ theme: 'dark' }))
    expect((await openStore(dir)).get().userHooksEnabled).toBe(false)
  })
  it('solo `true` exacto lo enciende; basura en disco = apagado', async () => {
    for (const raw of ['true', 1, 'yes', {}, null]) {
      const dir = userData()
      writeFileSync(join(dir, 'settings.json'), JSON.stringify({ userHooksEnabled: raw }))
      expect((await openStore(dir)).get().userHooksEnabled, String(raw)).toBe(false)
    }
    const dir = userData()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ userHooksEnabled: true }))
    expect((await openStore(dir)).get().userHooksEnabled).toBe(true)
  })
  it('se guarda y relee de disco', async () => {
    const dir = userData()
    const store = await openStore(dir)
    store.set({ userHooksEnabled: true })
    store.set({ theme: 'dark' })
    expect((await openStore(dir)).get().userHooksEnabled).toBe(true)
  })
})
