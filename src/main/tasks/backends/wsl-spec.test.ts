import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BridgeProtocolError, FrameDecoder, FrameType } from './bridge-protocol'
import {
  LANDLOCK_ACCESS,
  LANDLOCK_RIGHTS,
  LANDLOCK_SYSTEM_RULES,
  WSL_CONF,
  WSL_DISTRO,
  WSL_ENV_ALLOWED,
  WslSpecError,
  assertAllowedWslArgs,
  assertPlaceholderAuth,
  buildWslInit,
  buildWslSpawn,
  drvfsOptions,
  wslArgs,
  wslEnv,
  type WslCommand,
  type WslLaunchInput
} from './wsl-spec'

const KEY = '0123456789abcdef'
const base = (over: Partial<WslLaunchInput> = {}): WslLaunchInput => ({
  folder: 'C:\\lazunox\\tareas\\a',
  configDir: 'C:\\Users\\Ben\\AppData\\Roaming\\Lazunox\\opencode-config',
  allowDelete: false,
  sandboxKey: KEY,
  serverPort: 51000,
  serveArgs: ['serve', '--port', '51000', '--hostname', '127.0.0.1'],
  env: {
    OPENCODE_SERVER_USERNAME: 'tasks',
    OPENCODE_SERVER_PASSWORD: 'pw',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    HTTP_PROXY: 'http://tok@127.0.0.1:52000',
    NO_PROXY: '127.0.0.1,localhost'
  },
  relayPorts: [52000, 52001],
  ...over
})
const throwsReason = (fn: () => unknown): string | undefined => {
  try {
    fn()
  } catch (e) {
    return e instanceof WslSpecError ? e.reason : e instanceof BridgeProtocolError ? e.code : `otro:${String(e)}`
  }
  return undefined
}

describe('wsl.exe: comandos de lista cerrada', () => {
  const cmds: WslCommand[] = [
    { kind: 'launch' },
    { kind: 'probe' },
    { kind: 'install' },
    { kind: 'export-home' },
    { kind: 'import-home' },
    { kind: 'terminate' },
    { kind: 'unregister' },
    { kind: 'import', installDir: 'C:\\lazunox\\wsl', rootfsTar: 'C:\\lazunox\\rootfs.tar.gz' },
    { kind: 'list' },
    { kind: 'status' },
    { kind: 'version' }
  ]
  it('todos pasan la barrera y los que llevan distro apuntan SOLO a Lazunox-Tareas', () => {
    for (const c of cmds) {
      const args = wslArgs(c)
      expect(() => assertAllowedWslArgs(args)).not.toThrow()
      const i = args.findIndex((a) => a === '-d' || a === '--terminate' || a === '--unregister' || a === '--import')
      if (i >= 0) expect(args[i + 1]).toBe(WSL_DISTRO)
    }
  })
  it('NUNCA --shutdown (ni ninguna variante peligrosa) en ningún comando', () => {
    for (const c of cmds) {
      const joined = wslArgs(c).join(' ')
      expect(joined).not.toMatch(/--shutdown|-t\b(?! )|--mount|--update|--install|--set-default|--export(?!-home)|--set-version|--system/)
      expect(joined).not.toContain('shutdown')
    }
    for (const bad of [
      ['--shutdown'],
      ['--shutdown', WSL_DISTRO],
      ['-d', 'Ubuntu'],
      ['--terminate', 'Ubuntu'],
      ['--unregister', 'Ubuntu'],
      ['--mount', 'x'],
      ['--update'],
      ['-e', 'cmd.exe'],
      []
    ]) {
      expect(
        throwsReason(() => assertAllowedWslArgs(bad)),
        bad.join(' ')
      ).toBe('wsl-args-not-allowed')
    }
  })
  it('el lanzador va por --exec como root, sin shell y con --cd /', () => {
    expect(wslArgs({ kind: 'launch' })).toEqual(['-d', WSL_DISTRO, '-u', 'root', '--cd', '/', '--exec', '/opt/lazunox/launcher.py'])
  })
  it('install, export-home e import-home: plantillas exactas, sin argumentos extra', () => {
    expect(wslArgs({ kind: 'install' })).toEqual(['-d', WSL_DISTRO, '-u', 'root', '--cd', '/', '--exec', '/usr/local/sbin/lazunox-install'])
    expect(wslArgs({ kind: 'export-home' })).toEqual([...wslArgs({ kind: 'launch' }), '--export-home'])
    expect(wslArgs({ kind: 'import-home' })).toEqual([...wslArgs({ kind: 'launch' }), '--import-home'])
    for (const c of ['install', 'export-home', 'import-home'] as const) {
      const a = wslArgs({ kind: c })
      expect(throwsReason(() => assertAllowedWslArgs([...a, 'extra']))).toBe('wsl-args-not-allowed')
      expect(throwsReason(() => assertAllowedWslArgs([...a, '--rm']))).toBe('wsl-args-not-allowed')
      expect(throwsReason(() => assertAllowedWslArgs(a.map((x) => (x === 'root' ? 'lazunox' : x))))).toBe('wsl-args-not-allowed')
    }
    expect(throwsReason(() => assertAllowedWslArgs([...wslArgs({ kind: 'launch' }), '--du', '0123456789abcdef']))).toBe(
      'wsl-args-not-allowed'
    )
    expect(throwsReason(() => assertAllowedWslArgs(['-d', WSL_DISTRO, '-u', 'root', '--cd', '/', '--exec', '/usr/local/sbin/otro']))).toBe(
      'wsl-args-not-allowed'
    )
  })
  it('--import: solo rutas Windows válidas (sin UNC, .., ADS ni comillas)', () => {
    for (const p of ['\\\\srv\\x', 'C:\\a\\..\\b', 'C:\\a:b', 'rel', 'C:\\a"b']) {
      expect(
        throwsReason(() => wslArgs({ kind: 'import', installDir: p, rootfsTar: 'C:\\r.tar' })),
        p
      ).toBe('bad-path')
      expect(
        throwsReason(() => wslArgs({ kind: 'import', installDir: 'C:\\w', rootfsTar: p })),
        p
      ).toBe('bad-path')
    }
    expect(throwsReason(() => assertAllowedWslArgs(['--import', WSL_DISTRO, 'C:\\a:b', 'C:\\r.tar', '--version', '2']))).toBe(
      'wsl-args-not-allowed'
    )
    expect(throwsReason(() => assertAllowedWslArgs(['--import', 'Otra', 'C:\\w', 'C:\\r.tar', '--version', '2']))).toBe(
      'wsl-args-not-allowed'
    )
    expect(throwsReason(() => assertAllowedWslArgs(['--import', WSL_DISTRO, 'C:\\w', 'C:\\r.tar', '--version', '1']))).toBe(
      'wsl-args-not-allowed'
    )
  })
  it('fuzz de argumentos sueltos con semilla fija: ninguno que no sea una plantilla pasa la barrera', () => {
    const pool = [
      '-d',
      '-u',
      '--exec',
      '--shutdown',
      'root',
      WSL_DISTRO,
      '--cd',
      '/',
      '--terminate',
      '-l',
      '-v',
      'x',
      '--probe',
      '--export-home',
      '--import-home',
      '/usr/local/sbin/lazunox-install',
      '--import',
      '--version',
      '2'
    ]
    let s = 7
    const rnd = (): number => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const valid = new Set(cmds.filter((c) => c.kind !== 'import').map((c) => wslArgs(c).join('\u0001')))
    for (let i = 0; i < 400; i++) {
      const args = Array.from({ length: Math.floor(rnd() * 9) }, () => pool[Math.floor(rnd() * pool.length)]!)
      const ok = throwsReason(() => assertAllowedWslArgs(args)) === undefined
      expect(ok, args.join(' ')).toBe(valid.has(args.join('\u0001')))
      if (args.includes('--shutdown')) expect(ok).toBe(false)
    }
  })
})

describe('wsl.exe: entorno y spawn', () => {
  const host = {
    Path: 'C:\\Windows\\System32;C:\\Evil',
    USERPROFILE: 'C:\\Users\\Ben',
    APPDATA: 'C:\\Users\\Ben\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\Ben\\AppData\\Local',
    SystemRoot: 'C:\\Windows',
    TEMP: 'C:\\Temp',
    WSLENV: 'USERPROFILE/p:PATH/l',
    OPENCODE_API_KEY: 'sk-secreto-1234567890',
    HTTP_PROXY: 'http://x',
    PATHEXT: '.EXE',
    SYSTEMDRIVE: 'C:'
  }
  it('lista cerrada, WSLENV vacío y WSL_UTF8=1', () => {
    const env = wslEnv(host)
    expect(env.WSLENV).toBe('')
    expect(env.WSL_UTF8).toBe('1')
    expect(Object.keys(env).sort()).toEqual(['LOCALAPPDATA', 'SystemDrive', 'SystemRoot', 'TEMP', 'WSLENV', 'WSL_UTF8'])
    for (const k of ['Path', 'USERPROFILE', 'APPDATA', 'OPENCODE_API_KEY', 'HTTP_PROXY', 'PATHEXT']) expect(env).not.toHaveProperty(k)
  })
  it('propiedad: la salida siempre cae en la lista permitida (claves cualesquiera)', () => {
    let s = 99
    const rnd = (): number => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const names = ['PATH', 'Path', 'USERPROFILE', 'SystemRoot', 'systemroot', 'TEMP', 'X', 'HOME', 'AWS_SECRET', 'WSLENV', 'WSL_UTF8']
    for (let i = 0; i < 100; i++) {
      const e: Record<string, string> = {}
      for (let j = 0; j < 6; j++) e[names[Math.floor(rnd() * names.length)]!] = `v${j}`
      for (const k of Object.keys(wslEnv(e))) expect([...WSL_ENV_ALLOWED, 'WSLENV', 'WSL_UTF8']).toContain(k)
    }
  })
  it('spawn: ruta absoluta de wsl.exe, sin shell, ventana oculta y sin detach', () => {
    const sp = buildWslSpawn({ kind: 'launch' }, host)
    expect(sp.command).toBe('C:\\Windows\\System32\\wsl.exe')
    expect(sp.options).toEqual({ windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], detached: false })
    expect(sp.env.WSLENV).toBe('')
    expect(buildWslSpawn({ kind: 'status' }, {}).command).toBe('C:\\Windows\\System32\\wsl.exe')
  })
})

describe('wsl.conf', () => {
  it('texto exacto: sin automontaje, sin interop, sin systemd, usuario lazunox', () => {
    expect(WSL_CONF).toBe(`[automount]
enabled=false
mountFsTab=false

[interop]
enabled=false
appendWindowsPath=false

[user]
default=lazunox

[boot]
systemd=false
`)
  })
})

describe('resources/wsl/wsl.conf', () => {
  it('el archivo del recurso es exactamente WSL_CONF', () => {
    expect(readFileSync(join(process.cwd(), 'resources/wsl/wsl.conf'), 'utf8')).toBe(WSL_CONF)
  })
})

describe('trama inicial', () => {
  const decode = (frame: Buffer): { type: number; json: ReturnType<typeof buildWslInit>['init'] } => {
    const [f] = new FrameDecoder().push(frame)
    return { type: f!.type, json: JSON.parse(f!.data.toString('utf8')) }
  }
  it('INIT con montajes, puertos, scratch por defecto y reglas Landlock', () => {
    const { init, frame, mounts } = buildWslInit(base({ allowDelete: true }))
    const d = decode(frame)
    expect(d.type).toBe(FrameType.INIT)
    expect(d.json).toEqual(init)
    expect(init.mounts[0]).toEqual({ win: 'C:\\lazunox\\tareas\\a', linux: '/win/c/lazunox/tareas/a', mode: 'rw' })
    expect(init.mounts[1]).toMatchObject({ linux: '/win/c/Users/Ben/AppData/Roaming/Lazunox/opencode-config', mode: 'ro' })
    expect(mounts.map((m) => m.linux)).toEqual(init.mounts.map((m) => m.linux))
    expect(init.relayPorts).toEqual([52000, 52001])
    expect(init.cwd).toBe('/win/c/lazunox/tareas/a')
    expect(init.env.LAZUNOX_TASKS_FOLDER).toBe('/win/c/lazunox/tareas/a')
    expect(init.env.OPENCODE_CONFIG_DIR).toBe('/win/c/Users/Ben/AppData/Roaming/Lazunox/opencode-config')
    expect(init.landlock.rules).toContainEqual({ path: '/win/c/lazunox/tareas/a/.lazunox/trabajo', access: 'rw-delete' })
    expect(init.landlock.rules).toContainEqual({ path: `/home/lazunox/xdg/${KEY}`, access: 'private' })
    expect(init.landlock.minAbi).toBe(2)
  })
  it('allowDelete=false ⇒ la carpeta principal es rw-nodelete (sin REMOVE_*/REFER); true ⇒ rw-delete', () => {
    const rule = (allow: boolean) =>
      buildWslInit(base({ allowDelete: allow })).init.landlock.rules.find((r) => r.path === '/win/c/lazunox/tareas/a')!
    expect(rule(false).access).toBe('rw-nodelete')
    expect(rule(true).access).toBe('rw-delete')
    const none = LANDLOCK_ACCESS['rw-nodelete']
    for (const r of ['REMOVE_FILE', 'REMOVE_DIR', 'REFER'] as const) expect(none).not.toContain(r)
    for (const r of ['REMOVE_FILE', 'REMOVE_DIR', 'REFER'] as const) expect(LANDLOCK_ACCESS['rw-delete']).toContain(r)
  })
  it('carpetas adicionales: rw sin borrado (siempre), ro solo lectura; duplicados (incluso con otras mayúsculas) se descartan', () => {
    const { init } = buildWslInit(
      base({
        allowDelete: true,
        extraFolders: [
          { path: 'D:\\datos', mode: 'rw' },
          { path: 'D:\\Ref', mode: 'ro' },
          { path: 'C:\\LAZUNOX\\tareas\\A', mode: 'ro' }
        ]
      })
    )
    expect(init.mounts.map((m) => [m.linux, m.mode])).toEqual([
      ['/win/c/lazunox/tareas/a', 'rw'],
      ['/win/d/datos', 'rw'],
      ['/win/d/Ref', 'ro'],
      ['/win/c/Users/Ben/AppData/Roaming/Lazunox/opencode-config', 'ro']
    ])
    const rules = init.landlock.rules
    expect(rules.find((r) => r.path === '/win/d/datos')!.access).toBe('rw-nodelete')
    expect(rules.find((r) => r.path === '/win/d/Ref')!.access).toBe('ro')
  })
  it('scratch solo dentro de la carpeta principal', () => {
    expect(throwsReason(() => buildWslInit(base({ scratchDirs: ['C:\\lazunox\\tareas\\OTRA\\x'] })))).toBe('scratch-outside')
    expect(throwsReason(() => buildWslInit(base({ scratchDirs: ['C:\\lazunox\\tareas\\a\\..\\b'] })))).toBe('bad-path')
    const { init } = buildWslInit(base({ scratchDirs: ['C:\\lazunox\\tareas\\a\\tmp1', 'C:\\lazunox\\tareas\\a\\tmp2'] }))
    expect(init.landlock.rules.filter((r) => r.access === 'rw-delete').map((r) => r.path)).toEqual([
      '/win/c/lazunox/tareas/a/tmp1',
      '/win/c/lazunox/tareas/a/tmp2'
    ])
  })
  it('rutas inválidas, clave y puertos: falla cerrado', () => {
    expect(throwsReason(() => buildWslInit(base({ folder: '\\\\srv\\x' })))).toBe('bad-path')
    expect(throwsReason(() => buildWslInit(base({ extraFolders: [{ path: 'C:\\a\\nul', mode: 'rw' }] })))).toBe('bad-path')
    expect(throwsReason(() => buildWslInit(base({ configDir: 'rel' })))).toBe('bad-path')
    expect(throwsReason(() => buildWslInit(base({ sandboxKey: '../x' })))).toBe('bad-key')
    expect(throwsReason(() => buildWslInit(base({ serverPort: 0 })))).toBe('bad-port')
    expect(throwsReason(() => buildWslInit(base({ relayPorts: [70000] })))).toBe('bad-port')
  })
  it('entorno: solo prefijos permitidos; sin XDG_*, HOME, Path ni rutas del anfitrión', () => {
    const { init } = buildWslInit(
      base({
        env: {
          ...base().env,
          XDG_DATA_HOME: 'C:\\Users\\Ben\\AppData',
          OPENCODE_CONFIG_DIR: 'C:\\Users\\Ben\\x',
          LAZUNOX_TASKS_FOLDER: 'C:\\otra',
          HOME: 'C:\\Users\\Ben',
          Path: 'C:\\Windows',
          TMPDIR: 'C:\\t',
          AWS_SECRET_ACCESS_KEY: 'x'
        }
      })
    )
    expect(Object.keys(init.env).sort()).toEqual([
      'HTTP_PROXY',
      'LAZUNOX_TASKS_FOLDER',
      'NO_PROXY',
      'OPENCODE_CONFIG_DIR',
      'OPENCODE_DISABLE_AUTOUPDATE',
      'OPENCODE_SERVER_PASSWORD',
      'OPENCODE_SERVER_USERNAME'
    ])
    expect(init.env.LAZUNOX_TASKS_FOLDER).toBe('/win/c/lazunox/tareas/a')
    expect(JSON.stringify(init)).not.toContain('C:\\\\Users\\\\Ben\\\\x')
  })
})

describe('la clave real NUNCA va en la trama inicial', () => {
  const placeholder = JSON.stringify({ 'opencode-go': { type: 'api', key: 'sandboxed-placeholder-0123456789abcdef' } })
  it('con el centinela pasa; con una clave real (o algo más en la entrada) se rechaza', () => {
    expect(() => assertPlaceholderAuth('{}')).not.toThrow()
    expect(() => assertPlaceholderAuth(placeholder)).not.toThrow()
    for (const bad of [
      JSON.stringify({ 'opencode-go': { type: 'api', key: 'sk-real-1234567890' } }),
      JSON.stringify({ x: { type: 'api', key: 'sandboxed-placeholder-0123456789abcdef', extra: 'sk-1' } }),
      JSON.stringify({ x: { type: 'oauth', key: 'sandboxed-placeholder-0123456789abcdef' } }),
      JSON.stringify({ x: { type: 'api', key: 'sandboxed-placeholder-XYZ' } }),
      JSON.stringify({ x: 'sk-real' }),
      JSON.stringify([]),
      'no json'
    ]) {
      expect(
        throwsReason(() => assertPlaceholderAuth(bad)),
        bad
      ).toBe('init_secret')
    }
  })
  it('propiedad con claves aleatorias: la clave no aparece en el frame ni aunque se pase en el entorno como valor ajeno', () => {
    let s = 4242
    const rnd = (): number => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (let i = 0; i < 60; i++) {
      const key = 'sk-' + Math.floor(rnd() * 1e15).toString(36) + Math.floor(rnd() * 1e15).toString(36)
      const ok = buildWslInit(base({ env: { ...base().env, OPENCODE_AUTH_CONTENT: placeholder } }), [key])
      expect(ok.frame.toString('utf8')).not.toContain(key)
      // Si alguien pasa la clave real por una variable permitida, la defensa extra la corta.
      expect(throwsReason(() => buildWslInit(base({ env: { ...base().env, OPENCODE_API_KEY: key } }), [key]))).toBe('init_secret')
      expect(
        throwsReason(() =>
          buildWslInit(base({ env: { ...base().env, OPENCODE_AUTH_CONTENT: JSON.stringify({ 'opencode-go': { type: 'api', key } }) } }), [
            key
          ])
        )
      ).toBe('init_secret')
    }
  })
  it('el módulo no importa nada que lea credenciales', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(__dirname + '/wsl-spec.ts', 'utf8')
    expect(src).not.toMatch(/readProviderAuth|appAuthFile|sandbox'|from '\.\.\/sandbox/)
  })
})

describe('montajes y política: invariantes', () => {
  it('drvfs siempre noexec,nosuid,nodev,case=off; las ro llevan ro', () => {
    expect(drvfsOptions('rw')).toBe('noexec,nosuid,nodev,case=off,uid=1000,gid=1000')
    expect(drvfsOptions('ro')).toBe('noexec,nosuid,nodev,case=off,ro,uid=1000,gid=1000')
  })
  it('ningún nivel de acceso de carpetas de Windows crea enlaces ni dispositivos; todo derecho es conocido', () => {
    for (const a of ['rw-nodelete', 'rw-delete'] as const) {
      for (const r of ['MAKE_SYM', 'MAKE_FIFO', 'MAKE_SOCK', 'MAKE_CHAR', 'MAKE_BLOCK', 'EXECUTE'] as const)
        expect(LANDLOCK_ACCESS[a]).not.toContain(r)
    }
    for (const rights of Object.values(LANDLOCK_ACCESS)) for (const r of rights) expect(LANDLOCK_RIGHTS).toContain(r)
    expect(LANDLOCK_ACCESS.ro).not.toContain('WRITE_FILE')
  })
})

describe('vectores compartidos con el lanzador de Python (resources/wsl/vectors.json)', () => {
  const vectors = JSON.parse(readFileSync(join(process.cwd(), 'resources/wsl/vectors.json'), 'utf8'))
  it('las tablas Landlock coinciden con las de protocol.py', () => {
    expect(vectors.landlock.access).toEqual(LANDLOCK_ACCESS)
    expect(vectors.landlock.system_rules.map(([path, access]: [string, string]) => ({ path, access }))).toEqual(LANDLOCK_SYSTEM_RULES)
    expect(vectors.landlock.rights).toEqual([...LANDLOCK_RIGHTS])
  })
  it('la trama INIT del vector es exactamente la que construye buildWslInit (Python la valida)', () => {
    const { init } = buildWslInit({
      folder: 'C:\\lazunox\\tareas\\a',
      extraFolders: [{ path: 'D:\\Ref', mode: 'ro' }],
      configDir: 'C:\\Users\\Ben\\AppData\\Roaming\\Lazunox\\opencode-config',
      allowDelete: false,
      sandboxKey: KEY,
      serverPort: 51000,
      serveArgs: ['serve', '--port', '51000', '--hostname', '127.0.0.1'],
      env: {
        OPENCODE_SERVER_USERNAME: 'tasks',
        HTTP_PROXY: 'http://tok@127.0.0.1:52000',
        OPENCODE_AUTH_CONTENT: JSON.stringify({ 'opencode-go': { type: 'api', key: 'sandboxed-placeholder-0123456789abcdef' } })
      },
      relayPorts: [52000, 52001]
    })
    expect(vectors.init).toEqual(init)
  })
})
