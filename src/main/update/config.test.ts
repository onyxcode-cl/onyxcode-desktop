import { describe, expect, it } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { resolveInstallConfig, resolveUpdateConfig } from './config'

const env = {
  ONYXCODE_TEST_RELEASES_API: 'http://127.0.0.1:4567',
  ONYXCODE_TEST_RELEASES_REPO: 'test-owner/test-repo',
  ONYXCODE_TEST_UPDATE_DELAY_MS: '200'
}

describe('resolveUpdateConfig', () => {
  it('empaquetada: GitHub y RELEASES_REPO, ignora el entorno', () => {
    const c = resolveUpdateConfig({ isPackaged: true, env, repo: 'o/r' })
    expect(c).toEqual({ configured: true, repo: 'o/r', apiBase: 'https://api.github.com', startDelayMs: 8000 })
  })
  it('empaquetada con repo vacío: sin configurar aunque haya entorno', () => {
    const c = resolveUpdateConfig({ isPackaged: true, env, repo: '' })
    expect(c.configured).toBe(false)
    expect(c.apiBase).toBe('https://api.github.com')
  })
  it('sin empaquetar y sin variables: apagado', () => {
    expect(resolveUpdateConfig({ isPackaged: false, env: {}, repo: 'o/r' }).configured).toBe(false)
  })
  it('sin empaquetar con servidor local de test', () => {
    const c = resolveUpdateConfig({ isPackaged: false, env, repo: '' })
    expect(c).toEqual({ configured: true, repo: 'test-owner/test-repo', apiBase: 'http://127.0.0.1:4567', startDelayMs: 200 })
  })
  it('retraso por defecto 500 y repo de RELEASES_REPO', () => {
    const c = resolveUpdateConfig({
      isPackaged: false,
      env: { ONYXCODE_TEST_RELEASES_API: 'http://127.0.0.1:1/' },
      repo: 'o/r'
    })
    expect(c).toMatchObject({ configured: true, repo: 'o/r', apiBase: 'http://127.0.0.1:1', startDelayMs: 500 })
  })
  it('sin repo válido: sin configurar', () => {
    expect(resolveUpdateConfig({ isPackaged: false, env: { ONYXCODE_TEST_RELEASES_API: 'http://127.0.0.1:1' }, repo: '' }).configured).toBe(
      false
    )
  })
  it('rechaza bases no permitidas', () => {
    for (const api of ['http://evil.example', 'http://localhost:1', 'http://127.0.0.1', 'ftp://x', 'https://u:p@x.com', 'basura'])
      expect(resolveUpdateConfig({ isPackaged: false, env: { ...env, ONYXCODE_TEST_RELEASES_API: api }, repo: '' }).configured, api).toBe(
        false
      )
  })
  it('acepta https', () => {
    expect(
      resolveUpdateConfig({ isPackaged: false, env: { ...env, ONYXCODE_TEST_RELEASES_API: 'https://example.test' }, repo: '' }).apiBase
    ).toBe('https://example.test')
  })
})

describe('resolveInstallConfig', () => {
  const KEY = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
  const inst = (o: { isPackaged: boolean; env?: Record<string, string>; repo?: string; key?: string; platform?: string }) => {
    const env = o.env ?? {}
    const repo = o.repo ?? 'o/r'
    const update = resolveUpdateConfig({ isPackaged: o.isPackaged, env, repo })
    return resolveInstallConfig({
      isPackaged: o.isPackaged,
      env,
      repo,
      update,
      updateKey: o.key ?? '',
      updateKeyId: 'k1',
      platform: o.platform ?? 'darwin'
    })
  }
  it('empaquetada: activa solo con repo + clave + macOS; https://github.com; ignora el entorno', () => {
    const c = inst({
      isPackaged: true,
      key: KEY,
      env: { ONYXCODE_TEST_UPDATE_PUBKEY: 'otra', ONYXCODE_TEST_UPDATE_INSTALL_DIR: '/tmp/x', ...env }
    })
    expect(c).toEqual({
      enabled: true,
      downloadBase: 'https://github.com',
      allowLoopbackHttp: false,
      keys: [{ id: 'k1', key: KEY }],
      testInstallDir: null
    })
  })
  it('empaquetada: sin clave, sin repo o fuera de macOS queda desactivada', () => {
    expect(inst({ isPackaged: true, key: '' }).enabled).toBe(false)
    expect(inst({ isPackaged: true, key: KEY, repo: '' }).enabled).toBe(false)
    expect(inst({ isPackaged: true, key: KEY, platform: 'linux' }).enabled).toBe(false)
    expect(inst({ isPackaged: true, key: 'no-es-una-clave' }).enabled).toBe(false)
  })
  it('sin empaquetar: clave y carpeta de instalación de pruebas, descarga del servidor local', () => {
    const c = inst({
      isPackaged: false,
      env: { ...env, ONYXCODE_TEST_UPDATE_PUBKEY: KEY, ONYXCODE_TEST_UPDATE_INSTALL_DIR: '/tmp/onyx-x' },
      repo: ''
    })
    expect(c).toMatchObject({
      enabled: true,
      downloadBase: 'http://127.0.0.1:4567',
      allowLoopbackHttp: true,
      testInstallDir: '/tmp/onyx-x'
    })
  })
  it('sin empaquetar y sin variables: desactivada; ruta relativa no vale', () => {
    expect(inst({ isPackaged: false, env }).enabled).toBe(false)
    expect(
      inst({ isPackaged: false, env: { ...env, ONYXCODE_TEST_UPDATE_PUBKEY: KEY, ONYXCODE_TEST_UPDATE_INSTALL_DIR: 'rel' } }).testInstallDir
    ).toBeNull()
  })
})
