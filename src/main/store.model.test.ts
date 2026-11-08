// F8-B42: el modelo elegido sobrevive a normalize, a escrituras de otros ajustes y a reabrir (releer settings.json).
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HOOKS_MAX_FILE_BYTES } from '@shared/user-hooks'

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

describe('settings: modoPlan (bandera experimental, apagada)', () => {
  it('sin el campo, con basura o con algo que no es true exacto -> apagado', async () => {
    const dir = userData()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ theme: 'dark' }))
    expect((await openStore(dir)).get().modoPlan).toBe(false)
    for (const v of ['true', 1, {}, null, 'si']) {
      writeFileSync(join(dir, 'settings.json'), JSON.stringify({ modoPlan: v }))
      expect((await openStore(dir)).get().modoPlan, JSON.stringify(v)).toBe(false)
    }
  })
  it('true exacto la enciende y se guarda', async () => {
    const dir = userData()
    const store = await openStore(dir)
    store.set({ modoPlan: true })
    expect((await openStore(dir)).get().modoPlan).toBe(true)
  })
})

describe('settings: engineExperiments', () => {
  const OFF = { chat: false, code: false, tasks: false }
  const ON = { chat: true, code: true, tasks: true }
  const TS = { chat: 'auto', code: 'auto', tasks: 'off' }
  /** «Formularios de conectores»: encendido en Chat y Code por defecto; Tareas nunca. */
  const FORMS = { chat: true, code: true, tasks: false }
  /** Objetivo, presupuesto y revisión: apagados por defecto. */
  const EXTRAS_OFF = { goal: false, budget: false, review: false }
  it('sin el campo en disco -> todo apagado', async () => {
    const dir = userData()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ theme: 'dark' }))
    const store = await openStore(dir)
    expect(store.get().engineExperiments).toEqual({
      codeMode: OFF,
      backgroundSubagents: ON,
      toolSearch: TS,
      mcpElicitation: FORMS,
      codeExtras: EXTRAS_OFF
    })
  })
  it('búsqueda de herramientas: un settings.json anterior a la clave la recibe con el defecto y lo apagado a propósito se respeta', async () => {
    const dir = userData()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ engineExperiments: { codeMode: OFF, backgroundSubagents: ON } }))
    const store = await openStore(dir)
    expect(store.get().engineExperiments.toolSearch).toEqual(TS)
    store.set({
      engineExperiments: {
        codeMode: OFF,
        backgroundSubagents: ON,
        toolSearch: { chat: 'off', code: 'auto', tasks: 'off' },
        mcpElicitation: FORMS,
        codeExtras: EXTRAS_OFF
      }
    })
    expect((await openStore(dir)).get().engineExperiments.toolSearch).toEqual({ chat: 'off', code: 'auto', tasks: 'off' })
  })
  it('basura en disco -> defaults, sin lanzar', async () => {
    const dir = userData()
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ engineExperiments: { codeMode: 'x', backgroundSubagents: { chat: 'si', code: 1 } } })
    )
    const store = await openStore(dir)
    expect(store.get().engineExperiments).toEqual({
      codeMode: OFF,
      backgroundSubagents: ON,
      toolSearch: TS,
      mcpElicitation: FORMS,
      codeExtras: EXTRAS_OFF
    })
  })
  it('1.6.0: un settings.json antiguo con «todo apagado» enciende los ayudantes (sin escribir al leer) y respeta que luego se apaguen', async () => {
    const dir = userData()
    const antiguo = JSON.stringify({ theme: 'dark', engineExperiments: { codeMode: OFF, backgroundSubagents: OFF } })
    writeFileSync(join(dir, 'settings.json'), antiguo)
    const store = await openStore(dir)
    expect(store.get().engineExperiments).toEqual({
      codeMode: OFF,
      backgroundSubagents: ON,
      toolSearch: TS,
      mcpElicitation: FORMS,
      codeExtras: EXTRAS_OFF
    })
    // Leer NO toca el archivo (las migraciones de datos viejos lo necesitan intacto).
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toBe(antiguo)
    // Una escritura normal guarda el marcador, y a partir de ahí lo que la persona apague se respeta.
    store.set({
      engineExperiments: { codeMode: OFF, backgroundSubagents: OFF, toolSearch: TS as never, mcpElicitation: FORMS, codeExtras: EXTRAS_OFF }
    })
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).engineBgMigrated).toBe(true)
    const reopened = await openStore(dir)
    expect(reopened.get().engineExperiments.backgroundSubagents).toEqual(OFF)
  })
  it('se guarda, sobrevive a otras escrituras y relee de disco', async () => {
    const dir = userData()
    const store = await openStore(dir)
    store.set({
      engineExperiments: {
        codeMode: { ...OFF, code: true },
        backgroundSubagents: OFF,
        toolSearch: TS as never,
        mcpElicitation: OFF,
        codeExtras: EXTRAS_OFF
      }
    })
    store.set({ theme: 'dark' })
    expect(store.get().engineExperiments.codeMode.code).toBe(true)
    const reopened = await openStore(dir)
    expect(reopened.get().engineExperiments).toEqual({
      codeMode: { ...OFF, code: true },
      backgroundSubagents: OFF,
      toolSearch: TS,
      mcpElicitation: OFF,
      codeExtras: EXTRAS_OFF
    })
  })
  it('formularios de conectores: un settings.json de antes (sin la clave) los recibe ENCENDIDOS sin tocar el archivo; apagarlos se respeta; Tareas siempre apagado', async () => {
    const dir = userData()
    const antiguo = JSON.stringify({ engineBgMigrated: true, engineExperiments: { codeMode: OFF, backgroundSubagents: ON } })
    writeFileSync(join(dir, 'settings.json'), antiguo)
    const store = await openStore(dir)
    expect(store.get().engineExperiments.mcpElicitation).toEqual(FORMS)
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toBe(antiguo)
    // La persona los apaga en Code: se guarda y sobrevive al reabrir; un `tasks: true` colado se normaliza a false.
    store.set({
      engineExperiments: {
        codeMode: OFF,
        backgroundSubagents: ON,
        toolSearch: TS as never,
        mcpElicitation: { chat: true, code: false, tasks: true },
        codeExtras: EXTRAS_OFF
      }
    })
    const reopened = await openStore(dir)
    expect(reopened.get().engineExperiments.mcpElicitation).toEqual({ chat: true, code: false, tasks: false })
  })
  it('objetivo, presupuesto y revisión: un settings.json anterior los recibe APAGADOS sin tocar el archivo; encenderlos se guarda y la basura se ignora', async () => {
    const dir = userData()
    const antiguo = JSON.stringify({ engineBgMigrated: true, engineExperiments: { codeMode: OFF, backgroundSubagents: ON } })
    writeFileSync(join(dir, 'settings.json'), antiguo)
    const store = await openStore(dir)
    expect(store.get().engineExperiments.codeExtras).toEqual(EXTRAS_OFF)
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toBe(antiguo)
    store.set({
      engineExperiments: {
        codeMode: OFF,
        backgroundSubagents: ON,
        toolSearch: TS as never,
        mcpElicitation: FORMS,
        codeExtras: { goal: true, budget: false, review: true }
      }
    })
    const reopened = await openStore(dir)
    expect(reopened.get().engineExperiments.codeExtras).toEqual({ goal: true, budget: false, review: true })
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ engineExperiments: { codeExtras: { goal: 'si', budget: 1, extra: true } } }))
    expect((await openStore(dir)).get().engineExperiments.codeExtras).toEqual(EXTRAS_OFF)
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

describe('settings: ajustes nuevos de la 1.8.12 (búsqueda web, sugerencia, huella de ganchos)', () => {
  const SHA = 'ab'.repeat(32)
  it('un settings.json viejo SIN las claves arranca con los valores por defecto (apagado, sin huella)', async () => {
    const dir = userData()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ theme: 'dark', rememberAlways: true }))
    const s = (await openStore(dir)).get()
    expect(s.webSearchAnyProvider).toBe(false)
    expect(s.permissionSuggestions).toBe(false)
    expect(s.userHooksSha256).toBeNull()
    expect(s.userHooksReview).toBe(false)
    expect(s.theme).toBe('dark')
  })
  it('sin settings.json tampoco rompe', async () => {
    const s = (await openStore(userData())).get()
    expect([s.webSearchAnyProvider, s.permissionSuggestions, s.userHooksSha256, s.userHooksReview]).toEqual([false, false, null, false])
  })
  it('búsqueda web y sugerencia: solo `true` exacto las enciende', async () => {
    for (const raw of ['true', 1, 'yes', {}, null, []]) {
      const dir = userData()
      writeFileSync(join(dir, 'settings.json'), JSON.stringify({ webSearchAnyProvider: raw, permissionSuggestions: raw }))
      const s = (await openStore(dir)).get()
      expect([s.webSearchAnyProvider, s.permissionSuggestions], String(raw)).toEqual([false, false])
    }
    const dir = userData()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ webSearchAnyProvider: true, permissionSuggestions: true }))
    const s = (await openStore(dir)).get()
    expect([s.webSearchAnyProvider, s.permissionSuggestions]).toEqual([true, true])
  })
  it('se guardan y releen de disco', async () => {
    const dir = userData()
    const store = await openStore(dir)
    store.set({ webSearchAnyProvider: true, permissionSuggestions: true })
    store.set({ theme: 'dark' })
    const s = (await openStore(dir)).get()
    expect([s.webSearchAnyProvider, s.permissionSuggestions]).toEqual([true, true])
  })
  it('la huella solo se acepta con 64 hexadecimales (se normaliza a minúsculas); basura = null', async () => {
    for (const raw of ['xyz', SHA.slice(1), `${SHA}0`, 5, {}, ` ${SHA}`]) {
      const dir = userData()
      writeFileSync(join(dir, 'settings.json'), JSON.stringify({ userHooksEnabled: true, userHooksSha256: raw, userHooksReview: true }))
      const s = (await openStore(dir)).get()
      expect(s.userHooksSha256, String(raw)).toBeNull()
      expect(s.userHooksReview, 'el aviso no tiene sentido sin huella').toBe(false)
    }
    const dir = userData()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ userHooksEnabled: true, userHooksSha256: SHA.toUpperCase() }))
    expect((await openStore(dir)).get().userHooksSha256).toBe(SHA)
  })
})

describe('settings: migración de la huella de ganchos (1.8.12, decisión D11 = a)', () => {
  const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')
  const HOOKS = '{"hooks":{"Stop":[{"command":"echo hola"}]}}\n'
  function conGanchos(settings: Record<string, unknown>, contenido: string | Buffer | null = HOOKS): string {
    const dir = userData()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings))
    if (contenido !== null) {
      mkdirSync(join(dir, 'hooks'), { recursive: true })
      writeFileSync(join(dir, 'hooks', 'hooks.json'), contenido)
    }
    return dir
  }

  it('ganchos ACTIVOS, sin la clave de huella y con archivo: se guarda la huella del archivo de hoy y se enciende el aviso «Revisa tus ganchos»', async () => {
    const dir = conGanchos({ userHooksEnabled: true })
    const s = (await openStore(dir)).get()
    expect(s.userHooksSha256).toBe(sha(HOOKS))
    expect(s.userHooksReview).toBe(true)
    // Persistida YA (si no, cada arranque volvería a confiar en el archivo de ese momento).
    const disco = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
    expect(disco.userHooksSha256).toBe(sha(HOOKS))
    expect(disco.userHooksReview).toBe(true)
  })

  it('la migración guarda el JSON crudo: no pierde claves que otras migraciones de datos viejos aún necesiten leer', async () => {
    const dir = conGanchos({ userHooksEnabled: true, claveDeUnaVersionVieja: { a: 1 }, theme: 'dark' })
    await openStore(dir).then((st) => st.get())
    const disco = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
    expect(disco.claveDeUnaVersionVieja).toEqual({ a: 1 })
    expect(disco.theme).toBe('dark')
    expect(disco.userHooksSha256).toBe(sha(HOOKS))
  })

  it('UNA sola vez: si el archivo cambia después, el siguiente arranque NO vuelve a confiar en él', async () => {
    const dir = conGanchos({ userHooksEnabled: true })
    const primera = (await openStore(dir)).get().userHooksSha256
    writeFileSync(join(dir, 'hooks', 'hooks.json'), '{"hooks":{"Stop":[{"command":"echo cambiado"}]}}\n')
    const segunda = (await openStore(dir)).get().userHooksSha256
    expect(primera).toBe(sha(HOOKS))
    expect(segunda).toBe(primera)
    expect(segunda).not.toBe(sha('{"hooks":{"Stop":[{"command":"echo cambiado"}]}}\n'))
  })

  it('ganchos activos pero SIN archivo: no hay nada que aprobar (huella null, sin aviso)', async () => {
    const s = (await openStore(conGanchos({ userHooksEnabled: true }, null))).get()
    expect(s.userHooksSha256).toBeNull()
    expect(s.userHooksReview).toBe(false)
  })

  it('ganchos APAGADOS: no se aprueba nada (enciende los ganchos después y tendrá que guardar desde la pantalla)', async () => {
    const dir = conGanchos({ userHooksEnabled: false })
    const s = (await openStore(dir)).get()
    expect(s.userHooksSha256).toBeNull()
    expect(s.userHooksReview).toBe(false)
    const store = await openStore(dir)
    store.set({ userHooksEnabled: true })
    expect((await openStore(dir)).get().userHooksSha256).toBeNull()
  })

  it('si el settings.json ya tiene la clave (aunque sea null) no se migra de nuevo', async () => {
    const dir = conGanchos({ userHooksEnabled: true, userHooksSha256: null })
    expect((await openStore(dir)).get().userHooksSha256).toBeNull()
    const otra = 'cd'.repeat(32)
    const dir2 = conGanchos({ userHooksEnabled: true, userHooksSha256: otra, userHooksReview: false })
    const s = (await openStore(dir2)).get()
    expect(s.userHooksSha256).toBe(otra)
    expect(s.userHooksReview).toBe(false)
  })

  it('si no se puede guardar la migración, la huella queda en null (no se vuelve a confiar en el archivo)', async () => {
    if (process.platform === 'win32') return
    const dir = conGanchos({ userHooksEnabled: true })
    chmodSync(dir, 0o500) // sin permiso de escritura: el renombrado del settings.json falla
    try {
      const s = (await openStore(dir)).get()
      expect(s.userHooksSha256).toBeNull()
      expect(s.userHooksReview).toBe(false)
    } finally {
      chmodSync(dir, 0o700)
    }
  })

  it('un archivo de ganchos que pesa más que el tope del motor (64 KB) no se aprueba', async () => {
    const s = (await openStore(conGanchos({ userHooksEnabled: true }, Buffer.alloc(HOOKS_MAX_FILE_BYTES + 1, 0x20)))).get()
    expect(s.userHooksSha256).toBeNull()
  })

  it('un enlace simbólico en lugar del archivo no se sigue (no se aprueba)', async () => {
    if (process.platform === 'win32') return
    const dir = conGanchos({ userHooksEnabled: true }, null)
    const fuera = userData()
    writeFileSync(join(fuera, 'otro.json'), HOOKS)
    mkdirSync(join(dir, 'hooks'), { recursive: true })
    symlinkSync(join(fuera, 'otro.json'), join(dir, 'hooks', 'hooks.json'))
    expect((await openStore(dir)).get().userHooksSha256).toBeNull()
  })

  it('una carpeta `hooks` que es un enlace a otro sitio tampoco se sigue', async () => {
    if (process.platform === 'win32') return
    const dir = conGanchos({ userHooksEnabled: true }, null)
    const fuera = userData()
    writeFileSync(join(fuera, 'hooks.json'), HOOKS)
    symlinkSync(fuera, join(dir, 'hooks'))
    expect((await openStore(dir)).get().userHooksSha256).toBeNull()
  })

  it('un settings.json ilegible no migra nada ni rompe el arranque', async () => {
    const dir = userData()
    writeFileSync(join(dir, 'settings.json'), '{no es json')
    const s = (await openStore(dir)).get()
    expect(s.userHooksSha256).toBeNull()
    expect(s.userHooksEnabled).toBe(false)
  })
})
