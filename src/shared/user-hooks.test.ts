import { describe, expect, it } from 'vitest'
import {
  EMPTY_HOOKS_TEXT,
  ENV_HOOKS_FILE,
  HOOKS_EXAMPLE,
  HOOKS_MAX_COMMAND,
  HOOKS_MAX_FILE_BYTES,
  HOOKS_MAX_MATCHER,
  HOOKS_MAX_PER_EVENT,
  leerConfig,
  onlyUserHooksEnv,
  userHooksEnvFor,
  userHooksEnvForTasksServer,
  userHooksOn,
  validateHooksText
} from './user-hooks'

const hook = (over: Record<string, unknown> = {}) => ({ command: 'echo hola', ...over })
const doc = (hooks: unknown): string => JSON.stringify({ hooks })
const codes = (text: string): string[] => {
  const v = validateHooksText(text)
  return v.ok ? [] : v.issues.map((i) => i.code)
}

describe('validateHooksText', () => {
  it('el ejemplo de ayuda es válido y el motor lo conserva entero', () => {
    const v = validateHooksText(HOOKS_EXAMPLE)
    expect(v).toMatchObject({ ok: true, count: 1 })
    const cfg = leerConfig(HOOKS_EXAMPLE)
    expect(cfg.PreToolUse).toHaveLength(1)
    expect(cfg.PreToolUse[0]).toMatchObject({ matcher: 'bash', timeout: 10 })
  })

  it('texto vacío = sin ganchos (se guarda el archivo vacío de siempre)', () => {
    expect(validateHooksText('   \n')).toEqual({ ok: true, text: EMPTY_HOOKS_TEXT, count: 0 })
    expect(validateHooksText('{"hooks":{}}')).toMatchObject({ ok: true, count: 0 })
  })

  it('JSON roto o sin objeto «hooks»', () => {
    expect(codes('{')).toEqual(['badJson'])
    expect(codes('[]')).toEqual(['noHooks'])
    expect(codes('{"hooks":[]}')).toEqual(['noHooks'])
    expect(codes('{"otra":1}')).toEqual(['noHooks'])
    expect(codes('null')).toEqual(['noHooks'])
  })

  it('evento desconocido o que no es lista', () => {
    expect(codes(doc({ Despues: [hook()] }))).toEqual(['unknownEvent'])
    expect(codes(doc({ PreToolUse: hook() }))).toEqual(['notList'])
  })

  it('cotas del motor: 20 por evento, comando ≤ 2000, matcher ≤ 300 y que compile, timeout entero 1–60', () => {
    expect(codes(doc({ Stop: Array.from({ length: HOOKS_MAX_PER_EVENT }, () => hook()) }))).toEqual([])
    expect(codes(doc({ Stop: Array.from({ length: HOOKS_MAX_PER_EVENT + 1 }, () => hook()) }))).toEqual(['tooMany'])
    expect(codes(doc({ Stop: [hook({ command: 'x'.repeat(HOOKS_MAX_COMMAND) })] }))).toEqual([])
    expect(codes(doc({ Stop: [hook({ command: 'x'.repeat(HOOKS_MAX_COMMAND + 1) })] }))).toEqual(['commandTooLong'])
    expect(codes(doc({ Stop: [hook({ command: '   ' })] }))).toEqual(['noCommand'])
    expect(codes(doc({ Stop: [{}] }))).toEqual(['noCommand'])
    expect(codes(doc({ Stop: [5] }))).toEqual(['notObject'])
    expect(codes(doc({ PreToolUse: [hook({ matcher: 'a'.repeat(HOOKS_MAX_MATCHER) })] }))).toEqual([])
    expect(codes(doc({ PreToolUse: [hook({ matcher: 'a'.repeat(HOOKS_MAX_MATCHER + 1) })] }))).toEqual(['matcherTooLong'])
    expect(codes(doc({ PreToolUse: [hook({ matcher: '(' })] }))).toEqual(['matcherInvalid'])
    expect(codes(doc({ PreToolUse: [hook({ matcher: 3 })] }))).toEqual(['matcherType'])
    expect(codes(doc({ PreToolUse: [hook({ matcher: 'bash|edit' }), hook({ matcher: '*' })] }))).toEqual([])
    for (const timeout of [1, 60]) expect(codes(doc({ Stop: [hook({ timeout })] }))).toEqual([])
    for (const timeout of [0, 61, 1.5, -3, '10', null])
      expect(codes(doc({ Stop: [hook({ timeout })] })), String(timeout)).toEqual(['badTimeout'])
  })

  it('archivo de más de 64 KB (en bytes) se rechaza', () => {
    const big = doc({
      Stop: [hook({ command: 'ñ'.repeat(HOOKS_MAX_COMMAND) })],
      PreCompact: [hook({ command: 'ñ'.repeat(HOOKS_MAX_COMMAND) })]
    })
    expect(validateHooksText(big).ok).toBe(true)
    const relleno = JSON.stringify({ hooks: {}, nota: 'ñ'.repeat(HOOKS_MAX_FILE_BYTES / 2) })
    expect(codes(relleno)).toEqual(['tooBig'])
  })

  it('los errores nunca llevan el texto del comando ni del matcher', () => {
    const v = validateHooksText(doc({ PreToolUse: [hook({ command: 'secreto-xyz', matcher: '(secreto-xyz' })] }))
    expect(v.ok).toBe(false)
    expect(JSON.stringify(v)).not.toContain('secreto-xyz')
  })

  it('acota la cantidad de problemas que reporta', () => {
    const v = validateHooksText(doc({ Stop: Array.from({ length: 20 }, () => ({})) }))
    expect(!v.ok && v.issues.length).toBeLessThanOrEqual(8)
  })

  it('lo que la app acepta, el motor lo conserva sin recortar ni descartar (coincidencia con leerConfig)', () => {
    const texto = doc({
      PreToolUse: [hook({ matcher: 'bash|edit', timeout: 5 })],
      PostToolUse: [hook()],
      PreCompact: [hook({ timeout: 60 })],
      PostCompact: [hook({ timeout: 30 })],
      Stop: [hook({ matcher: '*' })]
    })
    const v = validateHooksText(texto)
    expect(v).toMatchObject({ ok: true, count: 5 })
    const cfg = leerConfig(texto)
    expect(cfg.PreToolUse).toEqual([{ command: 'echo hola', matcher: 'bash|edit', timeout: 5 }])
    expect(cfg.PostToolUse).toEqual([{ command: 'echo hola', matcher: undefined, timeout: undefined }])
    expect(cfg.PreCompact[0].timeout).toBe(60)
    expect(cfg.PostCompact[0].timeout).toBe(30)
    expect(cfg.Stop[0].matcher).toBe('*')
  })
})

describe('leerConfig (réplica del motor)', () => {
  it('nunca lanza y descarta lo inválido', () => {
    expect(leerConfig('no json').PreToolUse).toEqual([])
    expect(leerConfig('{"hooks":5}').Stop).toEqual([])
    expect(leerConfig(doc({ Stop: [hook({ command: 'x'.repeat(2001) }), hook()] })).Stop).toHaveLength(1)
  })
  it('recorta el timeout al rango 1–60 y ignora un matcher demasiado largo', () => {
    const cfg = leerConfig(doc({ Stop: [hook({ timeout: 500 }), hook({ timeout: 0.2 }), hook({ matcher: 'a'.repeat(301) })] }))
    expect(cfg.Stop.map((g) => g.timeout)).toEqual([60, 1, undefined])
    expect(cfg.Stop[2].matcher).toBeUndefined()
  })
  it('máximo 20 por evento', () => {
    expect(leerConfig(doc({ Stop: Array.from({ length: 30 }, () => hook()) })).Stop).toHaveLength(20)
  })
})

describe('variable LAZUNOX_HOOKS_FILE', () => {
  const FILE = '/u/hooks/hooks.json'
  it('apagado por defecto: ausente o cualquier cosa que no sea true exacto no pasa nada', () => {
    for (const v of [undefined, false, 'true', 1, null]) {
      expect(userHooksOn({ userHooksEnabled: v as boolean }), String(v)).toBe(false)
      expect(userHooksEnvFor({ userHooksEnabled: v as boolean }, FILE)).toEqual({})
    }
    expect(userHooksEnvFor({}, FILE)).toEqual({})
  })
  it('encendido pasa SOLO la ruta absoluta del archivo', () => {
    expect(userHooksEnvFor({ userHooksEnabled: true }, FILE)).toEqual({ [ENV_HOOKS_FILE]: FILE })
    expect(userHooksEnvFor({ userHooksEnabled: true }, 'C:\\Users\\x\\hooks\\hooks.json')).toEqual({
      [ENV_HOOKS_FILE]: 'C:\\Users\\x\\hooks\\hooks.json'
    })
  })
  it('sin ruta o con ruta relativa/rara no pasa nada', () => {
    for (const f of [undefined, null, '', 'hooks.json', '../x', '/a\0b']) expect(userHooksEnvFor({ userHooksEnabled: true }, f)).toEqual({})
  })
  it('onlyUserHooksEnv deja solo esa clave y exige ruta absoluta', () => {
    expect(onlyUserHooksEnv({ [ENV_HOOKS_FILE]: FILE, OTRA: 'x', LAZUNOX_PERMISSION_PERSIST: '1' })).toEqual({ [ENV_HOOKS_FILE]: FILE })
    expect(onlyUserHooksEnv({ [ENV_HOOKS_FILE]: 'relativa.json' })).toEqual({})
    expect(onlyUserHooksEnv({})).toEqual({})
  })
})

describe('servidores de Tareas', () => {
  const env = { [ENV_HOOKS_FILE]: '/u/hooks/hooks.json', LAZUNOX_PERMISSION_PERSIST: '1' }
  it('con sandbox nunca reciben ganchos, aunque el ajuste esté encendido', () => {
    expect(userHooksEnvForTasksServer(env, false)).toEqual({})
  })
  it('con Control total (sin sandbox) reciben solo el archivo', () => {
    expect(userHooksEnvForTasksServer(env, true)).toEqual({ [ENV_HOOKS_FILE]: '/u/hooks/hooks.json' })
    expect(userHooksEnvForTasksServer({}, true)).toEqual({})
  })
})
