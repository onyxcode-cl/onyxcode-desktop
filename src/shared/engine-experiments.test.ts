import { describe, expect, it } from 'vitest'
import {
  ENGINE_ENV_MCP_ELICITATION,
  ENGINE_EXPERIMENTS_DEFAULTS,
  engineExperimentsFor,
  engineFlagEnvFor,
  engineFlagEnvForMainSidecar,
  migrateBackgroundSubagentsDefault,
  normalizeEngineExperiments,
  onlyExperimentalEngineEnv
} from './engine-experiments'
import { DEFAULT_SETTINGS, type EngineExperiments, type ToolSearchFlags } from './types'

const off = { chat: false, code: false, tasks: false }
const on = { chat: true, code: true, tasks: true }
const TS_DEFAULT: ToolSearchFlags = { chat: 'auto', code: 'auto', tasks: 'off' }
const formsDefault = { chat: true, code: true, tasks: false }
const extrasOff = { goal: false, budget: false, review: false }
const mk = (
  codeMode: Partial<typeof off>,
  backgroundSubagents: Partial<typeof off> = {},
  toolSearch: ToolSearchFlags = TS_DEFAULT,
  mcpElicitation: Partial<typeof off> = {}
): { engineExperiments: EngineExperiments } => ({
  engineExperiments: {
    codeMode: { ...off, ...codeMode },
    backgroundSubagents: { ...off, ...backgroundSubagents },
    toolSearch,
    mcpElicitation: { ...off, ...mcpElicitation },
    codeExtras: extrasOff
  }
})
const EL = 'LAZUNOX_MCP_ELICITATION'
const TSE = 'LAZUNOX_TOOL_SEARCH'
const TSK = 'LAZUNOX_TOOL_SEARCH_KEEP'
const KEEP = 'browser,computer,bgshell'
const CM = 'OPENCODE_EXPERIMENTAL_CODE_MODE'
const BG = 'OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS'

describe('engine-experiments: valores por defecto', () => {
  it('Modo código apagado y subagentes en segundo plano encendidos en los tres modos; DEFAULT_SETTINGS usa la constante única', () => {
    expect(ENGINE_EXPERIMENTS_DEFAULTS).toEqual({
      codeMode: off,
      backgroundSubagents: on,
      toolSearch: TS_DEFAULT,
      mcpElicitation: formsDefault,
      codeExtras: extrasOff
    })
    expect(DEFAULT_SETTINGS.engineExperiments).toBe(ENGINE_EXPERIMENTS_DEFAULTS)
  })
})

describe('codeExtras (objetivo, presupuesto y revisión)', () => {
  it('apagados por defecto y NO producen variables de entorno ni reinicio del motor', () => {
    expect(ENGINE_EXPERIMENTS_DEFAULTS.codeExtras).toEqual(extrasOff)
    const allOn = { engineExperiments: { ...mk({}).engineExperiments, codeExtras: { goal: true, budget: true, review: true } } }
    expect(engineFlagEnvFor(allOn, 'code')).toEqual(engineFlagEnvFor(mk({}), 'code'))
    expect(engineFlagEnvForMainSidecar(allOn)).toEqual(engineFlagEnvForMainSidecar(mk({})))
    expect(onlyExperimentalEngineEnv({ LAZUNOX_GOAL: '1' })).toEqual({})
  })
  it('normaliza: conserva booleanos, ignora basura y claves extra, completa lo que falta apagado', () => {
    expect(normalizeEngineExperiments({ codeExtras: { goal: true, budget: 'x', review: 1, extra: true } }).codeExtras).toEqual({
      goal: true,
      budget: false,
      review: false
    })
    for (const bad of [undefined, null, 5, 'x', [], { codeExtras: 'si' }, { codeExtras: [] }])
      expect(normalizeEngineExperiments(bad).codeExtras).toEqual(extrasOff)
    expect(normalizeEngineExperiments({ codeExtras: { goal: true, budget: true, review: true } }).codeExtras).toEqual({
      goal: true,
      budget: true,
      review: true
    })
  })
})

describe('normalizeEngineExperiments', () => {
  it('falta o basura -> defaults, sin lanzar', () => {
    for (const bad of [undefined, null, 5, 'x', [], { codeMode: 'si' }, { codeMode: { chat: 'true', code: 1 } }])
      expect(normalizeEngineExperiments(bad)).toEqual(ENGINE_EXPERIMENTS_DEFAULTS)
  })
  it('conserva booleanos válidos y descarta claves extra', () => {
    const r = normalizeEngineExperiments({ codeMode: { chat: true, code: 'x', tasks: false, extra: true }, otro: 1 })
    expect(r).toEqual({
      codeMode: { chat: true, code: false, tasks: false },
      backgroundSubagents: on,
      toolSearch: TS_DEFAULT,
      mcpElicitation: formsDefault,
      codeExtras: extrasOff
    })
  })
  it('búsqueda de herramientas: un settings.json viejo sin la clave recibe el valor por defecto (auto en Chat y Code, off en Overdrive)', () => {
    const viejo = { codeMode: { chat: true, code: false, tasks: false }, backgroundSubagents: off }
    expect(normalizeEngineExperiments(viejo).toolSearch).toEqual(TS_DEFAULT)
    expect(normalizeEngineExperiments(viejo).codeMode.chat).toBe(true)
  })
  it('búsqueda de herramientas: solo «auto»/«off»; basura -> defecto; Overdrive siempre «off»', () => {
    expect(normalizeEngineExperiments({ toolSearch: { chat: 'off', code: 'on', tasks: 'auto' } }).toolSearch).toEqual({
      chat: 'off',
      code: 'auto',
      tasks: 'off'
    })
    for (const bad of ['auto', 5, null, [], { chat: true, code: 1 }])
      expect(normalizeEngineExperiments({ toolSearch: bad }).toolSearch).toEqual(TS_DEFAULT)
  })
})

describe('engineExperimentsFor', () => {
  it('lee el modo pedido', () => {
    const s = mk({ code: true }, { tasks: true })
    expect(engineExperimentsFor(s, 'code')).toEqual({ codeMode: true, backgroundSubagents: false, mcpElicitation: false })
    expect(engineExperimentsFor(s, 'tasks')).toEqual({ codeMode: false, backgroundSubagents: true, mcpElicitation: false })
    expect(engineExperimentsFor(s, 'chat')).toEqual({ codeMode: false, backgroundSubagents: false, mcpElicitation: false })
  })
  it('tolera ajustes sin el campo', () => {
    expect(engineExperimentsFor({} as never, 'code')).toEqual({ codeMode: false, backgroundSubagents: true, mcpElicitation: true })
  })
})

describe('engineFlagEnvFor', () => {
  it('objeto vacío si nada está encendido', () => {
    expect(engineFlagEnvFor(mk({}), 'code')).toEqual({})
    expect(engineFlagEnvFor(DEFAULT_SETTINGS, 'tasks')).toEqual({ [BG]: 'true' })
    // Overdrive nunca recibe las variables de la búsqueda de herramientas, ni con Chat y Code en «auto».
    for (const m of ['chat', 'code', 'tasks'] as const) {
      expect(Object.keys(engineFlagEnvFor(DEFAULT_SETTINGS, m))).not.toContain(TSE)
      expect(Object.keys(engineFlagEnvFor(DEFAULT_SETTINGS, m))).not.toContain(TSK)
    }
  })
  it('solo las variables encendidas, valor exacto "true"', () => {
    expect(engineFlagEnvFor(mk({ tasks: true }), 'tasks')).toEqual({ [CM]: 'true' })
    expect(engineFlagEnvFor(mk({}, { tasks: true }), 'tasks')).toEqual({ [BG]: 'true' })
    expect(engineFlagEnvFor(mk({ tasks: true }, { tasks: true }), 'tasks')).toEqual({ [CM]: 'true', [BG]: 'true' })
  })
  it('nunca emite OPENCODE_EXPERIMENTAL a secas', () => {
    const all = mk({ chat: true, code: true, tasks: true }, { chat: true, code: true, tasks: true })
    for (const m of ['chat', 'code', 'tasks'] as const) expect(Object.keys(engineFlagEnvFor(all, m))).not.toContain('OPENCODE_EXPERIMENTAL')
    expect(Object.keys(engineFlagEnvForMainSidecar(all)).sort()).toEqual([BG, CM, TSK, TSE].sort())
  })
})

describe('engineFlagEnvForMainSidecar (Chat y Code comparten sidecar)', () => {
  it('chat=true code=false -> encendida', () => {
    expect(engineFlagEnvForMainSidecar(mk({ chat: true }))).toEqual({ [CM]: 'true', [TSE]: 'auto', [TSK]: KEEP })
  })
  it('chat=false code=true -> encendida', () => {
    expect(engineFlagEnvForMainSidecar(mk({ code: true }))).toEqual({ [CM]: 'true', [TSE]: 'auto', [TSK]: KEEP })
  })
  it('combina cada función por separado', () => {
    expect(engineFlagEnvForMainSidecar(mk({ chat: true }, { code: true }))).toEqual({
      [CM]: 'true',
      [BG]: 'true',
      [TSE]: 'auto',
      [TSK]: KEEP
    })
  })
  it('tasks no enciende el sidecar principal', () => {
    expect(engineFlagEnvForMainSidecar(mk({ tasks: true }, { tasks: true }))).toEqual({ [TSE]: 'auto', [TSK]: KEEP })
  })
  it('valores por defecto: subagentes de fondo y búsqueda de herramientas en «auto»', () => {
    expect(engineFlagEnvForMainSidecar(DEFAULT_SETTINGS)).toEqual({ [BG]: 'true', [EL]: '1', [TSE]: 'auto', [TSK]: KEEP })
  })
  it('búsqueda de herramientas: «auto» si Chat O Code la tienen en auto; «off» explícito si las dos la apagan (el motor usa auto sin variable)', () => {
    const t = (chat: 'auto' | 'off', code: 'auto' | 'off'): ReturnType<typeof mk> => mk({}, {}, { chat, code, tasks: 'off' })
    expect(engineFlagEnvForMainSidecar(t('off', 'auto'))).toEqual({ [TSE]: 'auto', [TSK]: KEEP })
    expect(engineFlagEnvForMainSidecar(t('auto', 'off'))).toEqual({ [TSE]: 'auto', [TSK]: KEEP })
    expect(engineFlagEnvForMainSidecar(t('off', 'off'))).toEqual({ [TSE]: 'off' })
  })
  it('un ajuste guardado sin la clave nueva equivale al defecto', () => {
    const viejo = { engineExperiments: { codeMode: off, backgroundSubagents: off } } as never
    expect(engineFlagEnvForMainSidecar(viejo)).toEqual({ [EL]: '1', [TSE]: 'auto', [TSK]: KEEP })
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
    expect(r.value).toEqual({
      codeMode: off,
      backgroundSubagents: on,
      toolSearch: TS_DEFAULT,
      mcpElicitation: formsDefault,
      codeExtras: extrasOff
    })
  })
})

describe('Formularios de conectores (LAZUNOX_MCP_ELICITATION)', () => {
  it('nombre exacto de la variable y valor «1» (contrato del motor)', () => {
    expect(ENGINE_ENV_MCP_ELICITATION).toBe('LAZUNOX_MCP_ELICITATION')
    expect(engineFlagEnvFor(mk({}, {}, TS_DEFAULT, { code: true }), 'code')).toEqual({ [EL]: '1' })
  })
  it('por defecto: encendido en Chat y Code, apagado en Tareas', () => {
    expect(ENGINE_EXPERIMENTS_DEFAULTS.mcpElicitation).toEqual(formsDefault)
    expect(engineFlagEnvFor(DEFAULT_SETTINGS, 'chat')[EL]).toBe('1')
    expect(engineFlagEnvFor(DEFAULT_SETTINGS, 'code')[EL]).toBe('1')
    expect(engineFlagEnvFor(DEFAULT_SETTINGS, 'tasks')[EL]).toBeUndefined()
  })
  it('Tareas (Overdrive) NUNCA la recibe, ni forzando el ajuste a verdadero', () => {
    const forced = { engineExperiments: { ...DEFAULT_SETTINGS.engineExperiments, mcpElicitation: on } }
    expect(normalizeEngineExperiments(forced.engineExperiments).mcpElicitation.tasks).toBe(false)
    expect(engineFlagEnvFor(forced, 'tasks')[EL]).toBeUndefined()
    expect(engineExperimentsFor(forced, 'tasks').mcpElicitation).toBe(false)
  })
  it('el filtro de defensa del entorno de Tareas la descarta aunque alguien la pase', () => {
    expect(onlyExperimentalEngineEnv({ [EL]: '1', [CM]: 'true' })).toEqual({ [CM]: 'true' })
    expect(onlyExperimentalEngineEnv({ [EL]: 'true' })).toEqual({})
  })
  it('sidecar principal: se enciende si Chat O Code la tienen; apagada en ambos, no se pasa (y convive con la búsqueda de herramientas)', () => {
    expect(engineFlagEnvForMainSidecar(mk({}, {}, TS_DEFAULT, { chat: true }))).toEqual({ [EL]: '1', [TSE]: 'auto', [TSK]: KEEP })
    expect(engineFlagEnvForMainSidecar(mk({}, {}, TS_DEFAULT, { code: true }))).toEqual({ [EL]: '1', [TSE]: 'auto', [TSK]: KEEP })
    expect(engineFlagEnvForMainSidecar(mk({}, {}, { chat: 'off', code: 'off', tasks: 'off' }, {}))).toEqual({ [TSE]: 'off' })
  })
  it('migración: un settings.json de antes (sin la clave) recibe el defecto encendido; lo apagado a propósito se respeta', () => {
    const viejo = { codeMode: off, backgroundSubagents: on }
    expect(normalizeEngineExperiments(viejo).mcpElicitation).toEqual(formsDefault)
    expect(migrateBackgroundSubagentsDefault(viejo, true).value.mcpElicitation).toEqual(formsDefault)
    const apagado = { ...viejo, mcpElicitation: off }
    expect(normalizeEngineExperiments(apagado).mcpElicitation).toEqual(off)
    expect(migrateBackgroundSubagentsDefault(apagado, true).value.mcpElicitation).toEqual(off)
  })
  it('basura en la clave -> defecto; claves extra descartadas', () => {
    expect(normalizeEngineExperiments({ mcpElicitation: 'si' }).mcpElicitation).toEqual(formsDefault)
    expect(normalizeEngineExperiments({ mcpElicitation: { chat: false, code: 'x', tasks: true, extra: 1 } }).mcpElicitation).toEqual({
      chat: false,
      code: true,
      tasks: false
    })
  })
})
