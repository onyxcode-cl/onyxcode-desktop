import { describe, expect, it } from 'vitest'
import { IPC_EVENT_CHANNELS, IPC_INVOKE_CHANNELS } from '@shared/ipc'
import { CODE_INVOKE_CHANNELS } from '@shared/ipc-code'
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

  it('acepta language system/es/en y rechaza otros idiomas', () => {
    const v = IPC_SCHEMAS['settings:set']
    for (const language of ['system', 'es', 'en']) expect(v({ language })).toEqual({ language })
    expect(() => v({ language: 'fr' })).toThrow()
    expect(() => v({ language: 1 })).toThrow()
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

describe('canales git:discard y git:discardUndo (R2-A)', () => {
  const cwd = '/Users/x/repo'
  const uuid = '123e4567-e89b-12d3-a456-426614174000'

  it('existen, tienen esquema y son solo de la ventana principal', () => {
    for (const c of ['git:discard', 'git:discardUndo']) {
      expect(CODE_INVOKE_CHANNELS as readonly string[], c).toContain(c)
      expect(IPC_SCHEMAS[c], c).toBeTypeOf('function')
      for (const [role, set] of Object.entries(CHANNEL_ROLES)) expect(set.has(c), `${c} en ${role}`).toBe(false)
    }
  })

  it('git:discard exige cwd absoluto y una lista acotada de rutas no vacías', () => {
    const v = IPC_SCHEMAS['git:discard']
    expect(v({ cwd, paths: ['a.txt', 'src/b.txt'] })).toEqual({ cwd, paths: ['a.txt', 'src/b.txt'] })
    expect(() => v({ cwd: 'repo', paths: ['a'] })).toThrow()
    expect(() => v({ cwd, paths: 'a.txt' })).toThrow()
    expect(() => v({ cwd, paths: [''] })).toThrow()
    expect(() => v({ cwd, paths: [5] })).toThrow()
    expect(() => v({ cwd, paths: Array.from({ length: 201 }, (_, i) => `f${i}`) })).toThrow()
    expect(() => v({ cwd })).toThrow()
  })

  it('git:discardUndo solo admite ids con forma de uuid', () => {
    const v = IPC_SCHEMAS['git:discardUndo']
    expect(v({ cwd, undoId: uuid })).toEqual({ cwd, undoId: uuid })
    for (const undoId of ['', '../../etc', 'x'.repeat(36), `${uuid}/..`]) expect(() => v({ cwd, undoId }), undoId).toThrow()
  })
})

describe('canales de archivos del proyecto y «Abrir en…»', () => {
  const CHANNELS = [
    'files:watch',
    'files:setDirs',
    'files:unwatch',
    'files:create',
    'files:rename',
    'files:trash',
    'editors:list',
    'editors:open'
  ]
  const SUB = '0123456789abcdef'
  it('existen, tienen esquema y son solo de la ventana principal', () => {
    for (const c of CHANNELS) {
      expect(CODE_INVOKE_CHANNELS).toContain(c)
      expect(IPC_SCHEMAS[c], c).toBeTypeOf('function')
      for (const role of Object.keys(CHANNEL_ROLES) as Array<keyof typeof CHANNEL_ROLES>)
        expect(CHANNEL_ROLES[role].has(c), `${c} en ${role}`).toBe(false)
    }
  })
  it('files:watch: carpeta absoluta e id de suscripción con forma', () => {
    const v = IPC_SCHEMAS['files:watch']
    expect(v({ folder: '/tmp/p', subId: SUB })).toEqual({ folder: '/tmp/p', subId: SUB })
    for (const bad of [
      { folder: 'rel', subId: SUB },
      { folder: '/tmp/p', subId: 'x' },
      { folder: '/tmp/p', subId: 'a b c d e f g h' },
      { folder: '/tmp/p' },
      { folder: '/tmp/p', subId: SUB, extra: 1 }
    ])
      expect(() => v(bad)).toThrow()
  })
  it('files:setDirs acota la lista', () => {
    const v = IPC_SCHEMAS['files:setDirs']
    expect(v({ subId: SUB, dirs: ['.', 'src'] })).toEqual({ subId: SUB, dirs: ['.', 'src'] })
    expect(() => v({ subId: SUB, dirs: Array.from({ length: 101 }, () => 'a') })).toThrow()
    expect(() => v({ subId: SUB, dirs: [1] })).toThrow()
  })
  it('files:create / rename / trash: tipos estrictos', () => {
    expect(IPC_SCHEMAS['files:create']({ cwd: '/tmp/p', parent: '.', name: 'a.txt', kind: 'file' })).toBeTruthy()
    expect(() => IPC_SCHEMAS['files:create']({ cwd: '/tmp/p', parent: '.', name: 'a', kind: 'link' })).toThrow()
    expect(() => IPC_SCHEMAS['files:create']({ cwd: '/tmp/p', parent: '.', name: '', kind: 'dir' })).toThrow()
    expect(() => IPC_SCHEMAS['files:create']({ cwd: 'rel', parent: '.', name: 'a', kind: 'dir' })).toThrow()
    expect(IPC_SCHEMAS['files:rename']({ cwd: '/tmp/p', path: 'a.txt', name: 'b.txt' })).toBeTruthy()
    expect(() => IPC_SCHEMAS['files:rename']({ cwd: '/tmp/p', path: '', name: 'b' })).toThrow()
    expect(IPC_SCHEMAS['files:trash']({ cwd: '/tmp/p', path: 'a.txt' })).toBeTruthy()
    expect(() => IPC_SCHEMAS['files:trash']({ cwd: '/tmp/p', path: 'a.txt', force: true })).toThrow()
  })
  it('editors:open solo admite ids del catálogo (nunca rutas ni comandos)', () => {
    const v = IPC_SCHEMAS['editors:open']
    expect(v({ cwd: '/tmp/p', id: 'zed' })).toEqual({ cwd: '/tmp/p', id: 'zed' })
    for (const id of ['/usr/bin/vim', 'code --new-window', 'vim', '', 'ZED']) expect(() => v({ cwd: '/tmp/p', id })).toThrow()
  })
})

describe('remote:confirmAction', () => {
  it('esquema estricto y solo para la ventana principal', () => {
    const v = IPC_SCHEMAS['remote:confirmAction']
    expect(v({ requestId: 'abc123', accept: true })).toEqual({ requestId: 'abc123', accept: true })
    expect(() => v({ requestId: 'abc123' })).toThrow()
    expect(() => v({ requestId: 'a b', accept: true })).toThrow()
    expect(() => v({ requestId: 'abc', accept: true, extra: 1 })).toThrow()
    for (const [role, set] of Object.entries(CHANNEL_ROLES)) expect(set.has('remote:confirmAction'), role).toBe(false)
  })
})

describe('remote:setDeviceTtl y remote:revokeAll', () => {
  const id = 'a'.repeat(32)
  it('solo 30, 90, 365 o null; nada extra', () => {
    const v = IPC_SCHEMAS['remote:setDeviceTtl']
    for (const days of [30, 90, 365, null]) expect(v({ deviceId: id, days })).toEqual({ deviceId: id, days })
    for (const days of [0, 7, 366, '90', undefined]) expect(() => v({ deviceId: id, days })).toThrow()
    expect(() => v({ deviceId: 'x', days: 30 })).toThrow()
    expect(() => v({ deviceId: id, days: 30, extra: 1 })).toThrow()
  })
  it('solo la ventana principal', () => {
    for (const ch of ['remote:setDeviceTtl', 'remote:revokeAll'] as const) {
      for (const [role, set] of Object.entries(CHANNEL_ROLES)) expect(set.has(ch), `${role} ${ch}`).toBe(false)
    }
  })
})
