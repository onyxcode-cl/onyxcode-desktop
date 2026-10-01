import { describe, expect, it } from 'vitest'
import { IPC_EVENT_CHANNELS, IPC_INVOKE_CHANNELS } from '@shared/ipc'
import { CHANNEL_ROLES, IPC_SCHEMAS, missingSchemas } from './schemas'

describe('contrato IPC', () => {
  it('todos los canales de invoke tienen esquema', () => {
    expect(missingSchemas()).toEqual([])
  })
})

describe('settings:set', () => {
  it('acepta checkUpdates booleano y rechaza otros tipos', () => {
    const v = IPC_SCHEMAS['settings:set']
    expect(v({ checkUpdates: false })).toEqual({ checkUpdates: false })
    expect(() => v({ checkUpdates: 'no' })).toThrow()
  })
})

describe('canales de cuenta', () => {
  const CHANNELS = [
    'account:state',
    'account:google',
    'account:cancel',
    'account:retry',
    'account:emailStart',
    'account:emailVerify',
    'account:signOut',
    'account:delete',
    'account:export'
  ]

  it('existen en el contrato, tienen esquema y son solo de la ventana principal', () => {
    for (const c of CHANNELS) {
      expect(IPC_INVOKE_CHANNELS as readonly string[], c).toContain(c)
      expect(IPC_SCHEMAS[c], c).toBeTypeOf('function')
      for (const [role, set] of Object.entries(CHANNEL_ROLES)) expect(set.has(c), `${c} en ${role}`).toBe(false)
    }
    expect(IPC_EVENT_CHANNELS as readonly string[]).toContain('account:changed')
  })

  it('los canales sin datos no admiten payload', () => {
    for (const c of [
      'account:state',
      'account:google',
      'account:cancel',
      'account:retry',
      'account:signOut',
      'account:delete',
      'account:export'
    ]) {
      expect(IPC_SCHEMAS[c](undefined)).toBeUndefined()
      expect(() => IPC_SCHEMAS[c]({ x: 1 }), c).toThrow()
    }
  })

  it('account:emailStart: correo con forma mínima y máx. 254', () => {
    const v = IPC_SCHEMAS['account:emailStart']
    expect(v({ email: 'a@b.cl' })).toEqual({ email: 'a@b.cl' })
    for (const bad of [
      {},
      { email: 1 },
      { email: '' },
      { email: 'sin-arroba' },
      { email: 'a b@c.cl' },
      { email: 'a@b.cl', extra: 1 },
      { email: 'a'.repeat(250) + '@b.cl' }
    ]) {
      expect(() => v(bad), JSON.stringify(bad).slice(0, 40)).toThrow()
    }
  })

  it('account:emailVerify: código de exactamente 6 dígitos', () => {
    const v = IPC_SCHEMAS['account:emailVerify']
    expect(v({ email: 'a@b.cl', code: '012345' })).toEqual({ email: 'a@b.cl', code: '012345' })
    for (const code of ['', '12345', '1234567', '12345a', ' 12345', '12345\n', 123456]) {
      expect(() => v({ email: 'a@b.cl', code }), String(code)).toThrow()
    }
    expect(() => v({ email: 'a@b.cl' })).toThrow()
    expect(() => v({ code: '123456' })).toThrow()
  })
})

describe('canales de Probar clave y Diagnóstico', () => {
  const CHANNELS = ['app:testProviderKey', 'diag:logs', 'diag:copy', 'diag:export']

  it('existen en el contrato, tienen esquema y son solo de la ventana principal', () => {
    for (const c of CHANNELS) {
      expect(IPC_INVOKE_CHANNELS as readonly string[], c).toContain(c)
      expect(IPC_SCHEMAS[c], c).toBeTypeOf('function')
      for (const [role, set] of Object.entries(CHANNEL_ROLES)) expect(set.has(c), `${c} en ${role}`).toBe(false)
    }
  })

  it('app:testProviderKey: solo el id del proveedor (nunca una clave)', () => {
    const v = IPC_SCHEMAS['app:testProviderKey']
    expect(v({ providerID: 'openai' })).toEqual({ providerID: 'openai' })
    expect(v({ providerID: 'my.provider_2-x' })).toEqual({ providerID: 'my.provider_2-x' })
    for (const bad of [
      {},
      { providerID: '' },
      { providerID: 'a b' },
      { providerID: 'a/b' },
      { providerID: 'x'.repeat(201) },
      { providerID: 'openai', key: 'sk-1' },
      { providerID: 1 }
    ]) {
      expect(() => v(bad), JSON.stringify(bad).slice(0, 40)).toThrow()
    }
  })

  it('diag:logs / diag:copy: fuente de la lista y maxLines acotado', () => {
    const logs = IPC_SCHEMAS['diag:logs']
    expect(logs({ source: 'engine' })).toEqual({ source: 'engine' })
    expect(logs({ source: 'report', maxLines: 200 })).toEqual({ source: 'report', maxLines: 200 })
    for (const bad of [
      {},
      { source: 'sandbox' },
      { source: 'engine', maxLines: 0 },
      { source: 'engine', maxLines: 5001 },
      { source: 'engine', maxLines: 1.5 },
      { source: 'engine', path: '/etc/passwd' }
    ]) {
      expect(() => logs(bad), JSON.stringify(bad)).toThrow()
    }
    expect(IPC_SCHEMAS['diag:copy']({ source: 'engine-file' })).toEqual({ source: 'engine-file' })
    expect(() => IPC_SCHEMAS['diag:copy']({ source: 'otra' })).toThrow()
    expect(IPC_SCHEMAS['diag:export'](undefined)).toBeUndefined()
    expect(() => IPC_SCHEMAS['diag:export']({ x: 1 })).toThrow()
  })
})

describe('catálogo MCP (mcp:catalog, mcp:installCatalog)', () => {
  const ok = { id: 'github', name: 'github', inputs: { token: 'ghp_x' }, enable: true, askEachUse: true }

  it('existen, tienen esquema y son solo de la ventana principal', () => {
    for (const c of ['mcp:catalog', 'mcp:installCatalog']) {
      expect(IPC_SCHEMAS[c], c).toBeTypeOf('function')
      for (const [role, set] of Object.entries(CHANNEL_ROLES)) expect(set.has(c), `${c} en ${role}`).toBe(false)
    }
  })

  it('acepta una petición válida y rechaza id, nombre, entradas o booleanos malformados', () => {
    const v = IPC_SCHEMAS['mcp:installCatalog']
    expect(v(ok)).toEqual(ok)
    expect(v({ ...ok, inputs: {} })).toBeTruthy()
    for (const id of ['', 'GitHub', 'a/b', '../x', 'x'.repeat(65)]) expect(() => v({ ...ok, id }), id).toThrow()
    for (const name of ['', 'con espacio', 'a/b', 'x'.repeat(65)]) expect(() => v({ ...ok, name }), name).toThrow()
    expect(() => v({ ...ok, inputs: { token: 'x'.repeat(4097) } })).toThrow()
    expect(() => v({ ...ok, inputs: { token: 5 } })).toThrow()
    expect(() => v({ ...ok, inputs: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 'v'])) })).toThrow()
    expect(() => v({ ...ok, inputs: JSON.parse('{"__proto__":"x"}') })).toThrow()
    expect(() => v({ ...ok, enable: 'si' })).toThrow()
    expect(() => v({ ...ok, askEachUse: undefined })).toThrow()
    expect(() => v({ id: 'github', name: 'github' })).toThrow()
  })

  it('mcp:catalog no admite parámetros', () => {
    const v = IPC_SCHEMAS['mcp:catalog']
    expect(() => v(undefined)).not.toThrow()
    expect(() => v({ x: 1 })).toThrow()
  })
})
