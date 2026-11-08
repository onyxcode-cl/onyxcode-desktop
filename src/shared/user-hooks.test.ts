import { describe, expect, it } from 'vitest'
import {
  EMPTY_HOOKS_TEXT,
  ENV_HOOKS_FILE,
  ENV_HOOKS_SHA256,
  HOOK_EVENTS,
  HOOKS_EXAMPLE,
  HOOKS_MAX_COMMAND,
  HOOKS_MAX_FILE_BYTES,
  HOOKS_MAX_IF,
  HOOKS_MAX_MATCHER,
  HOOKS_MAX_PER_EVENT,
  isHooksSha256,
  leerConfig,
  normalizeHooksSha256,
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

describe('variables LAZUNOX_HOOKS_FILE y LAZUNOX_HOOKS_SHA256', () => {
  const FILE = '/u/hooks/hooks.json'
  const SHA = 'ab'.repeat(32)
  const on = { userHooksEnabled: true, userHooksSha256: SHA }
  it('apagado por defecto: ausente o cualquier cosa que no sea true exacto no pasa nada', () => {
    for (const v of [undefined, false, 'true', 1, null]) {
      expect(userHooksOn({ userHooksEnabled: v as boolean }), String(v)).toBe(false)
      expect(userHooksEnvFor({ userHooksEnabled: v as boolean, userHooksSha256: SHA }, FILE)).toEqual({})
    }
    expect(userHooksEnvFor({}, FILE)).toEqual({})
  })
  it('encendido y con huella pasa SOLO la ruta absoluta del archivo y la huella', () => {
    expect(userHooksEnvFor(on, FILE)).toEqual({ [ENV_HOOKS_FILE]: FILE, [ENV_HOOKS_SHA256]: SHA })
    expect(userHooksEnvFor(on, 'C:\\Users\\x\\hooks\\hooks.json')).toEqual({
      [ENV_HOOKS_FILE]: 'C:\\Users\\x\\hooks\\hooks.json',
      [ENV_HOOKS_SHA256]: SHA
    })
  })
  it('la huella se pasa en minúsculas (el motor acepta ambas, pero la app emite una sola forma)', () => {
    expect(userHooksEnvFor({ userHooksEnabled: true, userHooksSha256: SHA.toUpperCase() }, FILE)[ENV_HOOKS_SHA256]).toBe(SHA)
  })
  it('SIN huella válida no se pasa NADA, tampoco el archivo (un archivo sin huella sería uno que nadie aprobó)', () => {
    const malas = [undefined, null, '', 'xyz', SHA.slice(1), `${SHA}0`, `${SHA.slice(0, 63)}g`, ` ${SHA}`, `${SHA}\n`, 12345, {}, [SHA]]
    for (const h of malas) {
      expect(userHooksEnvFor({ userHooksEnabled: true, userHooksSha256: h as string }, FILE), JSON.stringify(h)).toEqual({})
    }
    expect(userHooksEnvFor({ userHooksEnabled: true }, FILE)).toEqual({})
  })
  it('sin ruta o con ruta relativa/rara no pasa nada', () => {
    for (const f of [undefined, null, '', 'hooks.json', '../x', '/a\0b']) expect(userHooksEnvFor(on, f)).toEqual({})
  })
  it('isHooksSha256 / normalizeHooksSha256: 64 hexadecimales exactos', () => {
    expect(isHooksSha256(SHA)).toBe(true)
    expect(isHooksSha256(SHA.toUpperCase())).toBe(true)
    expect(isHooksSha256(`${SHA}a`)).toBe(false)
    expect(normalizeHooksSha256('AB'.repeat(32))).toBe(SHA)
    expect(normalizeHooksSha256('no')).toBeNull()
    expect(normalizeHooksSha256(undefined)).toBeNull()
  })
  it('onlyUserHooksEnv deja solo el archivo y la huella, y exige ruta absoluta Y huella válida', () => {
    expect(onlyUserHooksEnv({ [ENV_HOOKS_FILE]: FILE, [ENV_HOOKS_SHA256]: SHA, OTRA: 'x', LAZUNOX_PERMISSION_PERSIST: '1' })).toEqual({
      [ENV_HOOKS_FILE]: FILE,
      [ENV_HOOKS_SHA256]: SHA
    })
    expect(onlyUserHooksEnv({ [ENV_HOOKS_FILE]: 'relativa.json', [ENV_HOOKS_SHA256]: SHA })).toEqual({})
    // El archivo sin huella (o con huella mal formada) no pasa; la huella sin archivo, tampoco.
    expect(onlyUserHooksEnv({ [ENV_HOOKS_FILE]: FILE })).toEqual({})
    expect(onlyUserHooksEnv({ [ENV_HOOKS_FILE]: FILE, [ENV_HOOKS_SHA256]: 'xyz' })).toEqual({})
    expect(onlyUserHooksEnv({ [ENV_HOOKS_SHA256]: SHA })).toEqual({})
    expect(onlyUserHooksEnv({})).toEqual({})
  })
  it('onlyUserHooksEnv NO deja pasar las variables de la «última milla» (búsqueda web, sugerencia, política)', () => {
    const env = {
      [ENV_HOOKS_FILE]: FILE,
      [ENV_HOOKS_SHA256]: SHA,
      OPENCODE_ENABLE_EXA: '1',
      LAZUNOX_SUGERENCIA_PERMISOS: '1',
      LAZUNOX_POLICY_FILE: '/Library/Application Support/Lazunox/motor-policy.json'
    }
    expect(Object.keys(onlyUserHooksEnv(env)).sort()).toEqual([ENV_HOOKS_FILE, ENV_HOOKS_SHA256].sort())
  })
})

describe('servidores de Tareas', () => {
  const env = { [ENV_HOOKS_FILE]: '/u/hooks/hooks.json', [ENV_HOOKS_SHA256]: 'cd'.repeat(32), LAZUNOX_PERMISSION_PERSIST: '1' }
  it('con sandbox nunca reciben ganchos, aunque el ajuste esté encendido', () => {
    expect(userHooksEnvForTasksServer(env, false)).toEqual({})
  })
  it('con Control total (sin sandbox) reciben solo el archivo y su huella', () => {
    expect(userHooksEnvForTasksServer(env, true)).toEqual({ [ENV_HOOKS_FILE]: '/u/hooks/hooks.json', [ENV_HOOKS_SHA256]: 'cd'.repeat(32) })
    expect(userHooksEnvForTasksServer({}, true)).toEqual({})
  })
})

/** Los 14 eventos de `leerConfig` del motor (`packages/opencode/src/plugin/lazunox-ganchos.ts`), en su orden. */
const EVENTOS_MOTOR = [
  'PreToolUse',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'Stop',
  'SessionStart',
  'UserPromptSubmit',
  'SubagentStop',
  'PostToolUseFailure',
  'PermissionDenied',
  'PermissionRequest',
  'SubagentStart',
  'Interrupt',
  'PostToolBatch'
]

describe('14 eventos del motor (W-A5)', () => {
  it('HOOK_EVENTS son exactamente los 14 eventos del motor, en su orden', () => {
    expect([...HOOK_EVENTS]).toEqual(EVENTOS_MOTOR)
  })

  it('el tope de «if» es el del motor (IF_MAX = 300)', () => {
    expect(HOOKS_MAX_IF).toBe(300)
  })

  it('cada uno de los 14 eventos se acepta al validar (ya no sale «evento desconocido»)', () => {
    const hooks = Object.fromEntries(EVENTOS_MOTOR.map((e) => [e, [hook()]]))
    expect(validateHooksText(doc(hooks))).toMatchObject({ ok: true, count: 14 })
  })

  it('paridad con el motor: un archivo con los 14 eventos, «if» y «onFailure» da lo mismo que el motor (resultado escrito a mano)', () => {
    const texto = doc({
      PreToolUse: [hook({ matcher: 'bash', timeout: 5, if: 'Bash(git *)', onFailure: 'block' })],
      PostToolUse: [hook({ matcher: 'edit', if: 'Edit(*.ts)' })],
      PreCompact: [hook()],
      PostCompact: [hook({ timeout: 60 })],
      Stop: [hook()],
      SessionStart: [hook()],
      UserPromptSubmit: [hook({ onFailure: 'block' })],
      SubagentStop: [hook()],
      PostToolUseFailure: [hook({ if: 'Bash' })],
      PermissionDenied: [hook()],
      PermissionRequest: [hook({ onFailure: 'block', if: 'Bash(rm *)' })],
      SubagentStart: [hook()],
      Interrupt: [hook()],
      PostToolBatch: [hook()]
    })
    expect(validateHooksText(texto)).toMatchObject({ ok: true, count: 14 })
    const cfg = leerConfig(texto)
    // Lo que el motor deja en cada lista (su `leerConfig` copia command, matcher, timeout, if y onFailure "block").
    expect(Object.keys(cfg)).toEqual(EVENTOS_MOTOR)
    expect(cfg.PreToolUse).toEqual([{ command: 'echo hola', matcher: 'bash', timeout: 5, if: 'Bash(git *)', onFailure: 'block' }])
    expect(cfg.PostToolUse).toEqual([{ command: 'echo hola', matcher: 'edit', if: 'Edit(*.ts)' }])
    expect(cfg.PostCompact).toEqual([{ command: 'echo hola', timeout: 60 }])
    expect(cfg.UserPromptSubmit).toEqual([{ command: 'echo hola', onFailure: 'block' }])
    expect(cfg.PostToolUseFailure).toEqual([{ command: 'echo hola', if: 'Bash' }])
    expect(cfg.PermissionRequest).toEqual([{ command: 'echo hola', onFailure: 'block', if: 'Bash(rm *)' }])
    for (const e of [
      'PreCompact',
      'Stop',
      'SessionStart',
      'SubagentStop',
      'PermissionDenied',
      'SubagentStart',
      'Interrupt',
      'PostToolBatch'
    ] as const) {
      expect(cfg[e], e).toEqual([{ command: 'echo hola' }])
    }
  })

  it('leerConfig descarta igual que el motor un «if» vacío o demasiado largo, y un «onFailure» distinto de «block»', () => {
    const cfg = leerConfig(
      doc({
        PreToolUse: [
          hook({ if: '   ' }),
          hook({ if: 'x'.repeat(HOOKS_MAX_IF + 1) }),
          hook({ if: 'x'.repeat(HOOKS_MAX_IF) }),
          hook({ onFailure: 'allow' })
        ]
      })
    )
    expect(cfg.PreToolUse.map((g) => g.if?.length)).toEqual([undefined, undefined, HOOKS_MAX_IF, undefined])
    expect(cfg.PreToolUse.map((g) => g.onFailure)).toEqual([undefined, undefined, undefined, undefined])
  })

  it('el validador rechaza un «if» que no es texto, vacío o demasiado largo (con código propio)', () => {
    expect(codes(doc({ PreToolUse: [hook({ if: 5 })] }))).toEqual(['badIf'])
    expect(codes(doc({ PreToolUse: [hook({ if: '   ' })] }))).toEqual(['badIf'])
    expect(codes(doc({ PreToolUse: [hook({ if: 'x'.repeat(HOOKS_MAX_IF + 1) })] }))).toEqual(['badIf'])
    expect(codes(doc({ PreToolUse: [hook({ if: 'x'.repeat(HOOKS_MAX_IF) })] }))).toEqual([])
    expect(codes(doc({ PreToolUse: [hook({ if: 'Bash(git *)' })] }))).toEqual([])
  })

  it('el validador solo acepta «onFailure» con el valor «block» (con código propio)', () => {
    expect(codes(doc({ PreToolUse: [hook({ onFailure: 'allow' })] }))).toEqual(['badOnFailure'])
    expect(codes(doc({ PreToolUse: [hook({ onFailure: true })] }))).toEqual(['badOnFailure'])
    expect(codes(doc({ PreToolUse: [hook({ onFailure: 'block' })] }))).toEqual([])
  })

  it('un evento desconocido sigue rechazándose', () => {
    expect(codes(doc({ Despues: [hook()] }))).toEqual(['unknownEvent'])
  })
})
