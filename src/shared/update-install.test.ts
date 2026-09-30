import { describe, expect, it } from 'vitest'
import {
  IDLE_INSTALL,
  installErrorText,
  installPercent,
  isAllowedDownloadUrl,
  isSafeZipEntry,
  parseManifest,
  reduceInstall,
  validateInstallLocation,
  validateManifest,
  type InstallEvent,
  type InstallState,
  type UpdateManifest
} from './update-install'

const SHA = 'a'.repeat(64)
const manifest = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema: 1,
  appId: 'cl.bentec.onyxcode',
  version: '0.4.0',
  tag: 'v0.4.0',
  platform: 'darwin-arm64',
  keyId: 'k1',
  zip: { name: 'OnyxCode-0.4.0-arm64.zip', size: 1000, sha256: SHA },
  publishedAt: '2026-09-30T12:00:00Z',
  ...over
})
const ctx = { appId: 'cl.bentec.onyxcode', current: '0.3.0', tag: 'v0.4.0', keyId: 'k1' }
const parsed = (over: Record<string, unknown> = {}): UpdateManifest => parseManifest(manifest(over)) as UpdateManifest

describe('parseManifest', () => {
  it('acepta un manifiesto válido', () => {
    expect(parseManifest(manifest())).toMatchObject({ version: '0.4.0', zip: { size: 1000 } })
  })
  it.each([
    ['schema 2', { schema: 2 }],
    ['plataforma', { platform: 'darwin-x64' }],
    ['sha256 corto', { zip: { name: 'OnyxCode-0.4.0-arm64.zip', size: 1, sha256: 'abc' } }],
    ['sha256 en mayúsculas', { zip: { name: 'OnyxCode-0.4.0-arm64.zip', size: 1, sha256: 'A'.repeat(64) } }],
    ['tamaño 0', { zip: { name: 'OnyxCode-0.4.0-arm64.zip', size: 0, sha256: SHA } }],
    ['tamaño > 600 MB', { zip: { name: 'OnyxCode-0.4.0-arm64.zip', size: 601 * 1024 * 1024, sha256: SHA } }],
    ['tamaño fraccionario', { zip: { name: 'OnyxCode-0.4.0-arm64.zip', size: 1.5, sha256: SHA } }],
    ['versión no semver', { version: 'nueva' }],
    ['fecha inválida', { publishedAt: 'ayer' }],
    ['appId vacío', { appId: '' }]
  ])('rechaza %s', (_n, over) => {
    expect(parseManifest(manifest(over))).toBeNull()
  })
  it('rechaza lo que no es un objeto', () => {
    for (const v of [null, 3, 'x', [], undefined]) expect(parseManifest(v)).toBeNull()
  })
})

describe('validateManifest', () => {
  it('acepta una versión mayor con todo coherente', () => {
    expect(validateManifest(parsed(), ctx)).toEqual({ ok: true })
  })
  it('appId distinto', () => {
    expect(validateManifest(parsed({ appId: 'otro.app' }), ctx)).toMatchObject({ ok: false, code: 'manifest' })
  })
  it('keyId que no es el de la clave que firmó', () => {
    expect(validateManifest(parsed({ keyId: 'k2' }), ctx)).toMatchObject({ ok: false, code: 'manifest' })
  })
  it('tag distinto al de la release', () => {
    expect(
      validateManifest(parsed({ tag: 'v0.4.1', version: '0.4.1', zip: { name: 'OnyxCode-0.4.1-arm64.zip', size: 1, sha256: SHA } }), ctx)
    ).toMatchObject({
      ok: false,
      code: 'manifest'
    })
  })
  it('version distinta al tag sin la v', () => {
    expect(validateManifest(parsed({ version: '0.4.1' }), ctx)).toMatchObject({ ok: false, code: 'manifest' })
  })
  it('anti-downgrade: igual o menor que la actual', () => {
    expect(validateManifest(parsed(), { ...ctx, current: '0.4.0' })).toMatchObject({ ok: false, code: 'downgrade' })
    expect(validateManifest(parsed(), { ...ctx, current: '1.0.0' })).toMatchObject({ ok: false, code: 'downgrade' })
    expect(validateManifest(parsed(), { ...ctx, current: '0.3.9' })).toEqual({ ok: true })
  })
  it('nombre de ZIP distinto del esperado', () => {
    for (const name of [
      '../OnyxCode-0.4.0-arm64.zip',
      'OnyxCode-0.4.0-x64.zip',
      'OnyxCode-0.3.0-arm64.zip',
      'evil.zip',
      'OnyxCode-0.4.0-arm64.zip/x'
    ]) {
      expect(validateManifest(parsed({ zip: { name, size: 1, sha256: SHA } }), ctx)).toMatchObject({ ok: false, code: 'manifest' })
    }
  })
  it('sin v en el tag también es válido si coincide', () => {
    expect(validateManifest(parsed({ tag: '0.4.0' }), { ...ctx, tag: '0.4.0' })).toEqual({ ok: true })
  })
})

describe('isSafeZipEntry', () => {
  it.each([
    'OnyxCode.app/',
    'OnyxCode.app/Contents/Info.plist',
    'OnyxCode.app/Contents/Frameworks/Electron Framework.framework/Versions/A/X'
  ])('acepta %s', (e) => expect(isSafeZipEntry(e)).toBe(true))
  it.each([
    '',
    '../OnyxCode.app/x',
    'OnyxCode.app/../../etc/passwd',
    'OnyxCode.app/a/../../b',
    '/OnyxCode.app/x',
    '/etc/passwd',
    'OnyxCode.app\\x',
    'OnyxCode.app/x\0y',
    'Otra.app/Contents/x',
    '__MACOSX/OnyxCode.app/._x',
    'OnyxCode.app//x',
    'OnyxCode.app/./x',
    'OnyxCode.appx/y',
    'C:/Windows'
  ])('rechaza %j', (e) => expect(isSafeZipEntry(e)).toBe(false))
})

describe('validateInstallLocation', () => {
  const ok = { appPath: '/Applications/OnyxCode.app', inApplicationsFolder: true, parentWritable: true, appWritable: true }
  it('acepta /Applications y ~/Applications con permiso', () => {
    expect(validateInstallLocation(ok)).toEqual({ ok: true })
    expect(validateInstallLocation({ ...ok, appPath: '/Users/a/Applications/OnyxCode.app' })).toEqual({ ok: true })
  })
  it('rechaza translocación, /Volumes, fuera de Aplicaciones y sin permiso', () => {
    expect(validateInstallLocation({ ...ok, appPath: '/private/var/folders/x/AppTranslocation/ABC/d/OnyxCode.app' })).toEqual({
      ok: false,
      reason: 'translocated'
    })
    expect(validateInstallLocation({ ...ok, appPath: '/Volumes/OnyxCode/OnyxCode.app' })).toEqual({ ok: false, reason: 'volume' })
    expect(validateInstallLocation({ ...ok, appPath: '/Users/a/Downloads/OnyxCode.app', inApplicationsFolder: false })).toEqual({
      ok: false,
      reason: 'not-applications'
    })
    expect(validateInstallLocation({ ...ok, parentWritable: false })).toEqual({ ok: false, reason: 'not-writable' })
    expect(validateInstallLocation({ ...ok, appWritable: false })).toEqual({ ok: false, reason: 'not-writable' })
    expect(validateInstallLocation({ ...ok, appPath: '/Applications/Otra.app' })).toEqual({ ok: false, reason: 'not-bundle' })
    expect(validateInstallLocation({ ...ok, appPath: 'relativa/OnyxCode.app' })).toEqual({ ok: false, reason: 'not-bundle' })
  })
})

describe('isAllowedDownloadUrl', () => {
  it('acepta github.com y *.githubusercontent.com por https', () => {
    expect(isAllowedDownloadUrl('https://github.com/o/r/releases/download/v1/x.zip')).toBe(true)
    expect(isAllowedDownloadUrl('https://release-assets.githubusercontent.com/a/b?x=1')).toBe(true)
    expect(isAllowedDownloadUrl('https://objects.githubusercontent.com/a')).toBe(true)
  })
  it('rechaza hosts ajenos, http, credenciales, puertos y sufijos engañosos', () => {
    for (const u of [
      'https://evil.example/x',
      'http://github.com/x',
      'https://user:pw@github.com/x',
      'https://github.com:8443/x',
      'https://githubusercontent.com.evil.example/x',
      'https://evilgithub.com/x',
      'https://xgithubusercontent.com/x',
      'ftp://github.com/x',
      'no es url'
    ])
      expect(isAllowedDownloadUrl(u)).toBe(false)
  })
  it('el loopback http solo con la bandera de pruebas', () => {
    expect(isAllowedDownloadUrl('http://127.0.0.1:1234/x')).toBe(false)
    expect(isAllowedDownloadUrl('http://127.0.0.1:1234/x', true)).toBe(true)
    expect(isAllowedDownloadUrl('http://localhost:1234/x', true)).toBe(false)
  })
})

describe('reduceInstall', () => {
  const run = (events: InstallEvent[], from: InstallState = IDLE_INSTALL): InstallState => events.reduce(reduceInstall, from)
  it('camino feliz hasta restarting', () => {
    const s = run([
      { type: 'start', version: '0.4.0' },
      { type: 'progress', received: 50, total: 100 }
    ])
    expect(s).toMatchObject({ phase: 'downloading', version: '0.4.0', received: 50, total: 100 })
    expect(installPercent(s)).toBe(50)
    expect(run([{ type: 'verifying' }, { type: 'ready' }, { type: 'install' }, { type: 'restarting' }], s).phase).toBe('restarting')
  })
  it('transiciones inválidas se ignoran', () => {
    expect(run([{ type: 'ready' }]).phase).toBe('idle')
    expect(run([{ type: 'install' }]).phase).toBe('idle')
    expect(run([{ type: 'start', version: '1.0.0' }, { type: 'ready' }]).phase).toBe('downloading')
    expect(
      run([
        { type: 'start', version: '1.0.0' },
        { type: 'start', version: '2.0.0' }
      ]).version
    ).toBe('1.0.0')
  })
  it('error conserva el código y permite reintentar', () => {
    const e = run([
      { type: 'start', version: '1.0.0' },
      { type: 'fail', code: 'hash' }
    ])
    expect(e).toMatchObject({ phase: 'error', code: 'hash' })
    expect(run([{ type: 'start', version: '1.0.0' }], e)).toMatchObject({ phase: 'downloading', code: null, received: 0 })
    expect(run([{ type: 'reset' }], e)).toEqual(IDLE_INSTALL)
  })
  it('cancelar solo en descarga o verificación; después se puede empezar de nuevo', () => {
    const c = run([{ type: 'start', version: '1.0.0' }, { type: 'cancel' }])
    expect(c.phase).toBe('cancelled')
    expect(run([{ type: 'start', version: '1.0.0' }], c).phase).toBe('downloading')
    expect(run([{ type: 'start', version: '1.0.0' }, { type: 'verifying' }, { type: 'ready' }, { type: 'cancel' }]).phase).toBe('ready')
  })
  it('descartar una actualización lista la devuelve a idle; en plena instalación no', () => {
    const ready = run([{ type: 'start', version: '1.0.0' }, { type: 'verifying' }, { type: 'ready' }])
    expect(run([{ type: 'reset' }], ready)).toEqual(IDLE_INSTALL)
    expect(run([{ type: 'install' }, { type: 'reset' }], ready).phase).toBe('installing')
  })
  it('porcentaje: null sin total, acotado a 100', () => {
    expect(installPercent(IDLE_INSTALL)).toBeNull()
    expect(installPercent({ ...IDLE_INSTALL, received: 500, total: 100 })).toBe(100)
  })
  it('todos los códigos tienen texto en español', () => {
    expect(installErrorText('hash')).toMatch(/descart/)
    expect(installErrorText(null)).toBe('No se pudo actualizar.')
    expect(installErrorText('rolled-back')).toMatch(/anterior/)
  })
})
