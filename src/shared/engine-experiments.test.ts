import { describe, expect, it } from 'vitest'
import {
  ENGINE_EXPERIMENTS_DEFAULTS,
  engineExperimentsFor,
  engineFlagEnvFor,
  engineFlagEnvForMainSidecar,
  migrateBackgroundSubagentsDefault,
  normalizeEngineExperiments
} from './engine-experiments'
import { DEFAULT_SETTINGS, type EngineExperiments } from './types'

const off = { chat: false, code: false, tasks: false }
const on = { chat: true, code: true, tasks: true }
const mk = (codeMode: Partial<typeof off>, backgroundSubagents: Partial<typeof off> = {}): { engineExperiments: EngineExperiments } => ({
  engineExperiments: { codeMode: { ...off, ...codeMode }, backgroundSubagents: { ...off, ...backgroundSubagents } }
})
const CM = 'OPENCODE_EXPERIMENTAL_CODE_MODE'
const BG = 'OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS'

describe('engine-experiments: valores por defecto', () => {
  it('Modo código apagado y subagentes en segundo plano encendidos en los tres modos; DEFAULT_SETTINGS usa la constante única', () => {
    expect(ENGINE_EXPERIMENTS_DEFAULTS).toEqual({ codeMode: off, backgroundSubagents: on })
    expect(DEFAULT_SETTINGS.engineExperiments).toBe(ENGINE_EXPERIMENTS_DEFAULTS)
  })
})

describe('normalizeEngineExperiments', () => {
  it('falta o basura -> defaults, sin lanzar', () => {
    for (const bad of [undefined, null, 5, 'x', [], { codeMode: 'si' }, { codeMode: { chat: 'true', code: 1 } }])
      expect(normalizeEngineExperiments(bad)).toEqual(ENGINE_EXPERIMENTS_DEFAULTS)
  })
  it('conserva booleanos válidos y descarta claves extra', () => {
    const r = normalizeEngineExperiments({ codeMode: { chat: true, code: 'x', tasks: false, extra: true }, otro: 1 })
    expect(r).toEqual({ codeMode: { chat: true, code: false, tasks: false }, backgroundSubagents: on })
  })
})

describe('engineExperimentsFor', () => {
  it('lee el modo pedido', () => {
    const s = mk({ code: true }, { tasks: true })
    expect(engineExperimentsFor(s, 'code')).toEqual({ codeMode: true, backgroundSubagents: false })
    expect(engineExperimentsFor(s, 'tasks')).toEqual({ codeMode: false, backgroundSubagents: true })
    expect(engineExperimentsFor(s, 'chat')).toEqual({ codeMode: false, backgroundSubagents: false })
  })
  it('tolera ajustes sin el campo', () => {
    expect(engineExperimentsFor({} as never, 'code')).toEqual({ codeMode: false, backgroundSubagents: true })
  })
})

describe('engineFlagEnvFor', () => {
  it('objeto vacío si nada está encendido', () => {
    expect(engineFlagEnvFor(mk({}), 'code')).toEqual({})
    expect(engineFlagEnvFor(DEFAULT_SETTINGS, 'tasks')).toEqual({ [BG]: 'true' })
  })
  it('solo las variables encendidas, valor exacto "true"', () => {
    expect(engineFlagEnvFor(mk({ tasks: true }), 'tasks')).toEqual({ [CM]: 'true' })
    expect(engineFlagEnvFor(mk({}, { tasks: true }), 'tasks')).toEqual({ [BG]: 'true' })
    expect(engineFlagEnvFor(mk({ tasks: true }, { tasks: true }), 'tasks')).toEqual({ [CM]: 'true', [BG]: 'true' })
  })
  it('nunca emite OPENCODE_EXPERIMENTAL a secas', () => {
    const all = mk({ chat: true, code: true, tasks: true }, { chat: true, code: true, tasks: true })
    for (const m of ['chat', 'code', 'tasks'] as const) expect(Object.keys(engineFlagEnvFor(all, m))).not.toContain('OPENCODE_EXPERIMENTAL')
    expect(Object.keys(engineFlagEnvForMainSidecar(all)).sort()).toEqual([BG, CM])
  })
})

describe('engineFlagEnvForMainSidecar (Chat y Code comparten sidecar)', () => {
  it('chat=true code=false -> encendida', () => {
    expect(engineFlagEnvForMainSidecar(mk({ chat: true }))).toEqual({ [CM]: 'true' })
  })
  it('chat=false code=true -> encendida', () => {
    expect(engineFlagEnvForMainSidecar(mk({ code: true }))).toEqual({ [CM]: 'true' })
  })
  it('combina cada función por separado', () => {
    expect(engineFlagEnvForMainSidecar(mk({ chat: true }, { code: true }))).toEqual({ [CM]: 'true', [BG]: 'true' })
  })
  it('tasks no enciende el sidecar principal', () => {
    expect(engineFlagEnvForMainSidecar(mk({ tasks: true }, { tasks: true }))).toEqual({})
  })
  it('todo apagado -> vacío', () => {
    expect(engineFlagEnvForMainSidecar(DEFAULT_SETTINGS)).toEqual({ [BG]: 'true' })
  })
})

describe('onlyExperimentalEngineEnv (defensa en profundidad del entorno extra de Tareas)', () => {
  it('deja pasar solo las dos variables experimentales con valor «true»', async () => {
    const { onlyExperimentalEngineEnv } = await import('./engine-experiments')
    expect(
      onlyExperimentalEngineEnv({
        OPENCODE_EXPERIMENTAL_CODE_MODE: 'true',
        OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: 'true',
        HOME: '/tmp/x',
        XDG_CONFIG_HOME: '/tmp/x',
        HTTP_PROXY: 'http://evil',
        OPENCODE_EXPERIMENTAL: 'true',
        OPENCODE_SERVER_PASSWORD: 'x'
      })
    ).toEqual({ OPENCODE_EXPERIMENTAL_CODE_MODE: 'true', OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: 'true' })
  })
  it('descarta valores distintos de «true» y devuelve vacío sin entrada', async () => {
    const { onlyExperimentalEngineEnv } = await import('./engine-experiments')
    expect(
      onlyExperimentalEngineEnv({ OPENCODE_EXPERIMENTAL_CODE_MODE: '1', OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: 'false' })
    ).toEqual({})
    expect(onlyExperimentalEngineEnv({})).toEqual({})
  })
})

describe('migrateBackgroundSubagentsDefault (1.6.0)', () => {
  const guardadoApagado = { codeMode: off, backgroundSubagents: off }
  it('quien tenía «todo apagado» guardado recibe los ayudantes encendidos, una vez', () => {
    const r = migrateBackgroundSubagentsDefault(guardadoApagado, undefined)
    expect(r.value.backgroundSubagents).toEqual(on)
    expect(r.value.codeMode).toEqual(off)
    expect(r.migrated).toBe(true)
    expect(r.changed).toBe(true)
  })
  it('ya migrado: no toca lo que la persona dejó (apagado a propósito)', () => {
    const r = migrateBackgroundSubagentsDefault(guardadoApagado, true)
    expect(r.value.backgroundSubagents).toEqual(off)
    expect(r.changed).toBe(false)
  })
  it('si ya tenía algún modo encendido se respeta tal cual', () => {
    const raw = { codeMode: off, backgroundSubagents: { chat: true, code: false, tasks: false } }
    const r = migrateBackgroundSubagentsDefault(raw, undefined)
    expect(r.value.backgroundSubagents).toEqual(raw.backgroundSubagents)
    expect(r.changed).toBe(true)
  })
  it('sin nada guardado: valores por defecto nuevos; el Modo código sigue apagado', () => {
    const r = migrateBackgroundSubagentsDefault(undefined, undefined)
    expect(r.value).toEqual({ codeMode: off, backgroundSubagents: on })
  })
})
