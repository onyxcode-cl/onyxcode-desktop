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
  it('1.6.0: un settings.json antiguo con «todo apagado» enciende los ayudantes una vez y respeta que luego se apaguen', async () => {
    const dir = userData()
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ theme: 'dark', engineExperiments: { codeMode: OFF, backgroundSubagents: OFF } })
    )
    const store = await openStore(dir)
    expect(store.get().engineExperiments).toEqual({ codeMode: OFF, backgroundSubagents: ON })
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).engineBgMigrated).toBe(true)
    store.set({ engineExperiments: { codeMode: OFF, backgroundSubagents: OFF } })
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
