import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { findLocalItem } from '@shared/mcp-catalog'
import { posixOnly } from '../../test/platform'

const userData = mkdtempSync(join(tmpdir(), 'lazunox-localconn-'))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

import { LOCK_FILE_TEXT } from './local-connector-files'
import {
  buildLocalEntry,
  installLocalFiles,
  localPermissions,
  localReadiness,
  normalizeGoogleClientFile,
  removeLocalFiles,
  verifiedLockFiles,
  type LocalDeps,
  type Runner
} from './local-connectors'
import { CatalogProvenanceStore, installLocalFromCatalog, removeLocalFromCatalog } from './mcp-catalog-install'
import { appOpencodeConfigPath, readAppMcpConfig } from './mcp-config'

afterAll(() => rmSync(userData, { recursive: true, force: true }))

const google = findLocalItem('google-workspace')!
const microsoft = findLocalItem('microsoft-365')!
const base = join(userData, 'conectores-locales')
const FAKE_SECRET = 'GOCSPX-' + 'x'.repeat(20)
const goodClient = JSON.stringify({
  installed: {
    client_id: '123456789012-abcdefghijklmnop.apps.googleusercontent.com',
    client_secret: FAKE_SECRET,
    token_uri: 'https://evil.example.com/token',
    auth_uri: 'https://evil.example.com/auth'
  }
})

beforeEach(() => {
  rmSync(base, { recursive: true, force: true })
  rmSync(join(userData, 'opencode'), { recursive: true, force: true })
  rmSync(join(userData, 'mcp-catalog-installs.json'), { force: true })
})

interface Call {
  file: string
  args: string[]
  env: Record<string, string>
  cwd: string
}

/** Ejecutor falso: anota cada llamada y, al terminar «uv pip install»/«npm ci», deja los archivos que la instalación real crearía. */
function fakeRunner(calls: Call[], opts: { fail?: boolean; wrongVersion?: boolean } = {}): Runner {
  return async (file, args, o) => {
    calls.push({ file, args, env: o.env, cwd: o.cwd })
    if (opts.fail) return { code: 1, output: 'boom: no hay red' }
    const last = args.includes('install') || args[0] === 'ci'
    if (last) {
      const v = opts.wrongVersion ? '9.9.9' : undefined
      if (file.endsWith('uv')) {
        mkdirSync(join(o.cwd, 'venv', 'bin'), { recursive: true })
        writeFileSync(join(o.cwd, 'venv', 'bin', 'workspace-mcp'), '#!/bin/sh\n')
        mkdirSync(join(o.cwd, 'venv', 'lib', 'python3.12', 'site-packages', `workspace_mcp-${v ?? google.runtime.version}.dist-info`), {
          recursive: true
        })
      } else {
        const pkgDir = join(o.cwd, 'node_modules', '@softeria', 'ms-365-mcp-server')
        mkdirSync(join(pkgDir, 'dist'), { recursive: true })
        writeFileSync(join(pkgDir, 'dist', 'index.js'), '')
        writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ version: v ?? microsoft.runtime.version }))
      }
    }
    return { code: 0, output: '' }
  }
}

const deps = (calls: Call[], extra: Partial<LocalDeps> = {}, runOpts = {}): LocalDeps => ({
  baseDir: base,
  platform: 'darwin',
  files: LOCK_FILE_TEXT,
  run: fakeRunner(calls, runOpts),
  find: (n) => (['uv', 'npm', 'node'].includes(n) ? `/opt/fake/bin/${n}` : null),
  now: () => 1_000,
  ...extra
})

describe('archivos de bloqueo', () => {
  it('los empaquetados coinciden con el SHA-256 de la ficha', () => {
    for (const item of [google, microsoft]) expect(verifiedLockFiles(item, LOCK_FILE_TEXT).length).toBe(item.runtime.files.length)
  })
  it('uno alterado o ausente se rechaza ANTES de tocar el disco', async () => {
    const tampered = {
      ...LOCK_FILE_TEXT,
      'google-workspace/requirements.lock': LOCK_FILE_TEXT['google-workspace/requirements.lock'] + '\nevil==1.0 --hash=sha256:00\n'
    }
    expect(() => verifiedLockFiles(google, tampered)).toThrow(/no es el que revisó/)
    expect(() => verifiedLockFiles(google, {})).toThrow(/Falta un archivo/)
    const calls: Call[] = []
    await expect(installLocalFiles(deps(calls, { files: tampered }), google, 'g', null)).rejects.toThrow(/no es el que revisó/)
    expect(calls).toEqual([])
    expect(existsSync(base)).toBe(false)
  })
})

describe('requisitos de este equipo', () => {
  it('plataforma y gestor', () => {
    expect(localReadiness(google, { platform: 'darwin', find: () => '/x' })).toEqual({
      platformOk: true,
      manager: 'uv',
      managerFound: true
    })
    expect(localReadiness(google, { platform: 'win32', find: () => '/x' }).platformOk).toBe(false)
    expect(localReadiness(google, { platform: 'darwin', find: () => null }).managerFound).toBe(false)
    expect(localReadiness(microsoft, { platform: 'darwin', find: (n) => (n === 'npm' ? '/x' : null) })).toMatchObject({
      manager: 'npm',
      managerFound: false
    })
  })
})

describe('archivo del cliente de Google', () => {
  it('se normaliza con las direcciones de Google FIJAS (un archivo manipulado no desvía el token)', () => {
    const n = normalizeGoogleClientFile(goodClient)
    const parsed = JSON.parse(n.json)
    expect(parsed.installed.token_uri).toBe('https://oauth2.googleapis.com/token')
    expect(parsed.installed.auth_uri).toBe('https://accounts.google.com/o/oauth2/auth')
    expect(n.json).not.toContain('evil.example.com')
    expect(n.hint).not.toContain(FAKE_SECRET)
    expect(n.hint.length).toBeLessThan(12)
  })
  it('rechaza JSON roto, cliente web, formato de id o de clave inválido', () => {
    expect(() => normalizeGoogleClientFile('{no')).toThrow(/JSON/)
    expect(() => normalizeGoogleClientFile('{"web":{"client_id":"x"}}')).toThrow(/Aplicación web/)
    expect(() => normalizeGoogleClientFile('[]')).toThrow()
    expect(() => normalizeGoogleClientFile(JSON.stringify({ installed: { client_id: 'x', client_secret: FAKE_SECRET } }))).toThrow(
      /identificador/
    )
    expect(() =>
      normalizeGoogleClientFile(
        JSON.stringify({ installed: { client_id: '123456789012-abcdefghijklmnop.apps.googleusercontent.com', client_secret: 'a b' } })
      )
    ).toThrow(/clave secreta/)
  })
})

describe('entrada de opencode.json', () => {
  it('Google: ejecutable del entorno, --read-only, carpeta propia como cwd y SIN el secreto en variables', () => {
    const e = buildLocalEntry(google, '/u/d/g', null)
    expect(e.command).toEqual(['/u/d/g/venv/bin/workspace-mcp', '--tools', 'gmail', 'calendar', 'drive', '--read-only'])
    expect(e.cwd).toBe('/u/d/g')
    expect(e.environment?.GOOGLE_CLIENT_SECRET_PATH).toBe('/u/d/g/client_secret.json')
    expect(e.environment?.WORKSPACE_MCP_CREDENTIALS_DIR).toBe('/u/d/g/credenciales')
    expect(JSON.stringify(e)).not.toMatch(/client_secret"|GOCSPX|client_id/)
  })
  it('Microsoft: node con el script del paquete, solo cuentas personales y acceso en la carpeta', () => {
    const e = buildLocalEntry(microsoft, '/u/d/m', '/opt/node')
    expect(e.command.slice(0, 2)).toEqual(['/opt/node', '/u/d/m/node_modules/@softeria/ms-365-mcp-server/dist/index.js'])
    expect(e.command).toContain('--read-only')
    expect(e.environment?.MS365_MCP_TENANT_ID).toBe('consumers')
    expect(e.environment?.MS365_MCP_TOKEN_CACHE_PATH).toBe('/u/d/m/credenciales/token-cache.json')
  })
  it('permisos: «preguntar» primero y después una negación por herramienta bloqueada (gana la última)', () => {
    const p = localPermissions('google', google, true)
    const keys = Object.keys(p)
    expect(keys[0]).toBe('google_*')
    expect(p['google_*']).toBe('ask')
    expect(keys.slice(1)).toEqual(google.runtime.tools.blocked.map((t) => `google_${t}`))
    expect(
      Object.values(p)
        .slice(1)
        .every((v) => v === 'deny')
    ).toBe(true)
    expect(p['google_send_gmail_message']).toBe('deny')
    expect(Object.keys(localPermissions('google', google, false))[0]).not.toBe('google_*')
  })
})

describe('instalación', () => {
  it('uv: sin shell, hashes obligatorios, solo ruedas, entorno mínimo, todo dentro de la carpeta', async () => {
    const calls: Call[] = []
    const client = { ...normalizeGoogleClientFile(goodClient), at: 1_000 }
    const r = await installLocalFiles(deps(calls), google, 'google', client)
    expect(r.dir).toBe(join(base, 'google'))
    expect(calls.map((c) => c.file)).toEqual(['/opt/fake/bin/uv', '/opt/fake/bin/uv'])
    for (const c of calls) {
      expect(c.file).not.toMatch(/(^|\/)(sh|bash|zsh)$/)
      expect(c.args).toContain('--no-config')
      expect(c.cwd).toBe(r.dir)
      expect(c.env.UV_PYTHON_INSTALL_DIR?.startsWith(r.dir)).toBe(true)
      expect(Object.keys(c.env).some((k) => /^(OPENCODE_|LAZUNOX_)/.test(k))).toBe(false)
    }
    const pip = calls[1].args
    expect(pip).toEqual(expect.arrayContaining(['--require-hashes', '--only-binary', ':all:', '--no-deps', '-r']))
    expect(readFileSync(join(r.dir, 'requirements.lock'), 'utf8')).toBe(LOCK_FILE_TEXT['google-workspace/requirements.lock'])
    expect(JSON.parse(readFileSync(join(r.dir, 'client_secret.json'), 'utf8')).installed.token_uri).toBe(
      'https://oauth2.googleapis.com/token'
    )
    if (posixOnly) {
      expect(lstatSync(join(r.dir, 'client_secret.json')).mode & 0o777).toBe(0o600)
      expect(lstatSync(r.dir).mode & 0o777).toBe(0o700)
    }
  })

  it('npm: ci con --ignore-scripts, registro oficial, .npmrc vacío y la caché se borra', async () => {
    const calls: Call[] = []
    const r = await installLocalFiles(deps(calls), microsoft, 'microsoft', null)
    expect(calls).toHaveLength(1)
    expect(calls[0].file).toBe('/opt/fake/bin/npm')
    expect(calls[0].args.slice(0, 2)).toEqual(['ci', '--ignore-scripts'])
    expect(calls[0].args).toEqual(expect.arrayContaining(['--registry', 'https://registry.npmjs.org/', '--userconfig']))
    expect(existsSync(join(r.dir, '.npm-cache'))).toBe(false)
    // npm rechaza el mismo archivo para «user» y «global» (fallo real que dio la prueba con npm de verdad)
    const a = calls[0].args
    expect(a[a.indexOf('--userconfig') + 1]).not.toBe(a[a.indexOf('--globalconfig') + 1])
    expect(r.bin).toBe('/opt/fake/bin/node')
    expect(r.entry.command[0]).toBe('/opt/fake/bin/node')
  })

  it('si falla, no queda NADA en disco', async () => {
    const calls: Call[] = []
    const client = { ...normalizeGoogleClientFile(goodClient), at: 1_000 }
    await expect(installLocalFiles(deps(calls, {}, { fail: true }), google, 'google', client)).rejects.toThrow(/falló en «uv venv»: boom/)
    expect(existsSync(join(base, 'google'))).toBe(false)
  })

  it('una versión distinta de la fijada se rechaza y se borra todo', async () => {
    const calls: Call[] = []
    await expect(installLocalFiles(deps(calls, {}, { wrongVersion: true }), microsoft, 'microsoft', null)).rejects.toThrow(
      /versión 0\.157\.2/
    )
    expect(existsSync(join(base, 'microsoft'))).toBe(false)
  })

  it('exige el archivo del cliente, el gestor, la plataforma y un nombre válido; no pisa una carpeta existente', async () => {
    const calls: Call[] = []
    await expect(installLocalFiles(deps(calls), google, 'google', null)).rejects.toThrow(/archivo del cliente/)
    const client = { ...normalizeGoogleClientFile(goodClient), at: 1_000 }
    await expect(installLocalFiles(deps(calls, { now: () => 1_000 + 31 * 60_000 }), google, 'google', client)).rejects.toThrow(
      /archivo del cliente/
    )
    await expect(installLocalFiles(deps(calls, { find: () => null }), google, 'google', client)).rejects.toThrow(/uv/)
    await expect(
      installLocalFiles(deps(calls, { find: (n) => (n === 'npm' ? '/x' : null) }), microsoft, 'microsoft', null)
    ).rejects.toThrow(/Node/)
    await expect(installLocalFiles(deps(calls, { platform: 'win32' }), google, 'google', client)).rejects.toThrow(
      /todavía no está disponible/
    )
    for (const bad of ['../x', 'a/b', 'a b', '', '.', '..'])
      await expect(installLocalFiles(deps(calls), microsoft, bad, null)).rejects.toThrow()
    mkdirSync(join(base, 'microsoft'), { recursive: true })
    await expect(installLocalFiles(deps(calls), microsoft, 'microsoft', null)).rejects.toThrow(/Ya existe/)
    expect(calls).toEqual([])
  })
})

describe('quitar', () => {
  it('borra la carpeta entera, cuenta los archivos y no sale de su base', () => {
    const dir = join(base, 'x')
    mkdirSync(join(dir, 'credenciales'), { recursive: true })
    writeFileSync(join(dir, 'credenciales', 't.json'), '{}')
    writeFileSync(join(dir, 'a'), '')
    expect(removeLocalFiles(base, dir)).toBe(2)
    expect(existsSync(dir)).toBe(false)
    const outside = join(userData, 'otra')
    mkdirSync(outside)
    writeFileSync(join(outside, 'v'), '')
    expect(removeLocalFiles(base, outside)).toBe(0)
    expect(existsSync(join(outside, 'v'))).toBe(true)
    expect(removeLocalFiles(base, base)).toBe(0)
    expect(removeLocalFiles(base, join(base, '..'))).toBe(0)
  })
})

describe('instalar y quitar desde el catálogo (opencode.json, permisos y procedencia)', () => {
  const store = new CatalogProvenanceStore(join(userData, 'mcp-catalog-installs.json'))
  const rawCfg = (): { permission?: Record<string, string> } => JSON.parse(readFileSync(appOpencodeConfigPath(), 'utf8'))

  it('instala, deja solo-consulta en los permisos y quitar deja 0 archivos y 0 entradas', async () => {
    const calls: Call[] = []
    await installLocalFromCatalog(store, deps(calls), { id: 'microsoft-365', name: 'microsoft', askEachUse: true }, null)
    const cfg = readAppMcpConfig()
    expect(cfg.servers.microsoft?.type).toBe('local')
    const perm = rawCfg().permission ?? {}
    expect(perm['microsoft_*']).toBe('ask')
    for (const t of microsoft.runtime.tools.blocked) expect(perm[`microsoft_${t}`], t).toBe('deny')
    for (const t of microsoft.runtime.tools.allowed) expect(perm[`microsoft_${t}`], t).toBeUndefined()
    expect(store.isLocal('microsoft')).toBe(true)
    expect(existsSync(join(base, 'microsoft'))).toBe(true)

    const res = await removeLocalFromCatalog(store, base, 'microsoft')
    expect(res.files).toBeGreaterThan(0)
    expect(existsSync(join(base, 'microsoft'))).toBe(false)
    expect(readAppMcpConfig().servers.microsoft).toBeUndefined()
    expect(Object.keys(rawCfg().permission ?? {}).filter((k) => k.startsWith('microsoft_'))).toEqual([])
    expect(store.read().microsoft).toBeUndefined()
  })

  it('una regla propia de la persona sobre ese servidor no se toca al quitar si no es de las nuestras', async () => {
    const calls: Call[] = []
    await installLocalFromCatalog(store, deps(calls), { id: 'microsoft-365', name: 'microsoft', askEachUse: false }, null)
    expect(rawCfg().permission?.['microsoft_*']).toBeUndefined()
  })

  it('si falla la instalación no queda servidor, ni permisos, ni procedencia', async () => {
    const calls: Call[] = []
    await expect(
      installLocalFromCatalog(store, deps(calls, {}, { fail: true }), { id: 'microsoft-365', name: 'microsoft', askEachUse: true }, null)
    ).rejects.toThrow()
    expect(readAppMcpConfig().servers.microsoft).toBeUndefined()
    expect(store.read()).toEqual({})
    expect(existsSync(join(base, 'microsoft'))).toBe(false)
  })

  it('un id que no es local no se instala por esta vía', async () => {
    await expect(installLocalFromCatalog(store, deps([]), { id: 'github', name: 'gh', askEachUse: true }, null)).rejects.toThrow(/catálogo/)
  })
})
