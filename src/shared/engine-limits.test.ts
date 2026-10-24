import { describe, expect, it } from 'vitest'
import {
  ENGINE_LIMIT_ENV_NAMES,
  ENGINE_LIMIT_SPECS,
  effectiveEngineLimits,
  engineLimitEnvFor,
  normalizeEngineLimits,
  onlyEngineLimitEnv
} from './engine-limits'

describe('normalizeEngineLimits', () => {
  it('sin el campo, vacío o basura -> objeto vacío (todo por defecto), sin lanzar', () => {
    for (const raw of [undefined, null, {}, [], 'x', 5, true, { otro: 5 }]) expect(normalizeEngineLimits(raw)).toEqual({})
  })
  it('conserva solo enteros dentro del rango y distintos del defecto', () => {
    expect(normalizeEngineLimits({ codeTimeoutMin: 20, codeMaxCalls: 50, codeOutputMb: 8, codeYieldSec: 10, codeMaxCells: 5 })).toEqual({
      codeTimeoutMin: 20,
      codeMaxCalls: 50,
      codeOutputMb: 8,
      codeYieldSec: 10,
      codeMaxCells: 5
    })
  })
  it('descarta fuera de rango, decimales, texto, NaN e Infinity', () => {
    for (const s of ENGINE_LIMIT_SPECS) {
      for (const bad of [s.min - 1, s.max + 1, 0, -3, 2.5, '7', NaN, Infinity, null, {}]) {
        expect(normalizeEngineLimits({ [s.key]: bad }), `${s.key}=${String(bad)}`).toEqual({})
      }
      expect(normalizeEngineLimits({ [s.key]: s.min === s.def ? s.max : s.min })).toEqual({ [s.key]: s.min === s.def ? s.max : s.min })
      expect(normalizeEngineLimits({ [s.key]: s.max === s.def ? s.min : s.max })).not.toEqual({})
    }
  })
  it('un valor igual al defecto no se guarda (así un cambio futuro de defecto no queda clavado)', () => {
    const all = Object.fromEntries(ENGINE_LIMIT_SPECS.map((s) => [s.key, s.def]))
    expect(normalizeEngineLimits(all)).toEqual({})
  })
  it('ignora claves desconocidas', () => {
    expect(normalizeEngineLimits({ codeMaxCells: 4, evil: 9, __proto__: { x: 1 } })).toEqual({ codeMaxCells: 4 })
  })
})

describe('engineLimitEnvFor', () => {
  it('sin cambios no pasa ninguna variable', () => {
    expect(engineLimitEnvFor({})).toEqual({})
    expect(engineLimitEnvFor({ engineLimits: {} })).toEqual({})
    expect(engineLimitEnvFor({ engineLimits: { codeTimeoutMin: 10 } })).toEqual({})
  })
  it('pasa solo las que difieren, en las unidades del motor', () => {
    expect(engineLimitEnvFor({ engineLimits: { codeTimeoutMin: 30, shellLifeMin: 60 } })).toEqual({
      LAZUNOX_CODE_MODE_TIMEOUT_MS: '1800000',
      LAZUNOX_SHELL_BG_MAX_MS: '3600000'
    })
    expect(
      engineLimitEnvFor({ engineLimits: { codeMaxCalls: 20, codeOutputMb: 7, codeYieldSec: 8, codeMaxCells: 2, shellOutputMb: 12 } })
    ).toEqual({
      LAZUNOX_CODE_MODE_MAX_TOOL_CALLS: '20',
      LAZUNOX_CODE_MODE_MAX_OUTPUT_BYTES: '7000000',
      LAZUNOX_CODE_MODE_YIELD_MS: '8000',
      LAZUNOX_CODE_MODE_MAX_CELLS: '2',
      LAZUNOX_SHELL_BG_MAX_OUTPUT: '12582912'
    })
  })
  it('ayudantes en segundo plano: LAZUNOX_MAX_SUBAGENTS en el rango 1-64, defecto 8 (no se pasa)', () => {
    expect(engineLimitEnvFor({ engineLimits: { maxSubagents: 8 } })).toEqual({})
    expect(engineLimitEnvFor({ engineLimits: { maxSubagents: 20 } })).toEqual({ LAZUNOX_MAX_SUBAGENTS: '20' })
    expect(engineLimitEnvFor({ engineLimits: { maxSubagents: 1 } })).toEqual({ LAZUNOX_MAX_SUBAGENTS: '1' })
    expect(engineLimitEnvFor({ engineLimits: { maxSubagents: 64 } })).toEqual({ LAZUNOX_MAX_SUBAGENTS: '64' })
    for (const bad of [0, 65, 1.5, '8x']) expect(engineLimitEnvFor({ engineLimits: { maxSubagents: bad } as never })).toEqual({})
    expect(onlyEngineLimitEnv({ LAZUNOX_MAX_SUBAGENTS: '20', LAZUNOX_MAX_SUBAGENTS_X: '1' })).toEqual({ LAZUNOX_MAX_SUBAGENTS: '20' })
  })
  it('un valor corrupto en memoria no llega al entorno', () => {
    expect(engineLimitEnvFor({ engineLimits: { codeTimeoutMin: 99999, codeMaxCalls: -1 } as never })).toEqual({})
  })
  it('los defectos coinciden con los del motor (5 000 000 y 10 MiB)', () => {
    const d = effectiveEngineLimits({})
    expect(d.codeOutputMb * 1_000_000).toBe(5_000_000)
    expect(d.shellOutputMb * 1024 * 1024).toBe(10 * 1024 * 1024)
    expect(d.codeTimeoutMin * 60_000).toBe(600_000)
    expect(d.shellLifeMin * 60_000).toBe(1_800_000)
  })
  it('todas las variables que produce el motor aceptan (enteros positivos)', () => {
    for (const s of ENGINE_LIMIT_SPECS) {
      const env = engineLimitEnvFor({ engineLimits: { [s.key]: s.max === s.def ? s.min : s.max } })
      const v = Number(env[s.env])
      expect(Number.isInteger(v) && v > 0).toBe(true)
    }
  })
})

describe('onlyEngineLimitEnv', () => {
  it('deja pasar solo variables de límites con enteros positivos', () => {
    expect(
      onlyEngineLimitEnv({
        LAZUNOX_CODE_MODE_MAX_CELLS: '2',
        LAZUNOX_SHELL_BG_MAX_MS: '0',
        LAZUNOX_CODE_MODE_YIELD_MS: '1e3',
        LAZUNOX_CODE_MODE_TIMEOUT_MS: '600000',
        HOME: '/tmp',
        HTTP_PROXY: 'x'
      })
    ).toEqual({ LAZUNOX_CODE_MODE_MAX_CELLS: '2', LAZUNOX_CODE_MODE_TIMEOUT_MS: '600000' })
    expect(ENGINE_LIMIT_ENV_NAMES).toHaveLength(8)
  })
})
