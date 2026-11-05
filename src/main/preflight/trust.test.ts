import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  CODESIGN_BIN,
  PINNED_CERT_SHA1,
  SECURITY_BIN,
  addTrustArgs,
  appBundleOf,
  certDer,
  certSha1,
  isTrustedIn,
  leafIsPinned,
  removeTrustArgs,
  trustCertificate,
  trustState,
  untrustCertificate,
  type RunResult,
  type TrustDeps
} from './trust'

const CERT = join(__dirname, '../../../resources/signing/LazunoxLocalSigning.cer')
const pem = readFileSync(CERT, 'utf8')
const APP = '/Applications/Lazunox.app'
const EXEC = `${APP}/Contents/MacOS/Lazunox`
const DR = `designated => identifier "cl.bentec.lazunox" and certificate leaf = H"${PINNED_CERT_SHA1.toUpperCase()}"`
const trustedPlist = JSON.stringify({
  trustList: {
    [PINNED_CERT_SHA1.toUpperCase()]: { trustSettings: [{ kSecTrustSettingsPolicyName: 'CodeSigning', kSecTrustSettingsResult: 1 }] }
  }
})

/** Simula `security`/`codesign`/`plutil` sin tocar el llavero real: nada de esto ejecuta `add-trusted-cert` de verdad. */
function fake(opts: { trusted?: boolean; dr?: string; addResult?: RunResult; platform?: string; certText?: string | null } = {}) {
  const state = { trusted: opts.trusted ?? false }
  const calls: Array<[string, string[]]> = []
  const run = vi.fn(async (file: string, args: readonly string[]): Promise<RunResult> => {
    calls.push([file, [...args]])
    const ok = (stdout = ''): RunResult => ({ code: 0, stdout, stderr: '' })
    if (file === CODESIGN_BIN) return { code: 0, stdout: '', stderr: opts.dr ?? DR }
    if (file === SECURITY_BIN && args[0] === 'trust-settings-export') return ok()
    if (file === '/usr/bin/plutil') return ok(state.trusted ? trustedPlist : JSON.stringify({ trustList: {} }))
    if (file === SECURITY_BIN && args[0] === 'add-trusted-cert') {
      const r = opts.addResult ?? ok()
      if (r.code === 0) state.trusted = true
      return r
    }
    if (file === SECURITY_BIN && args[0] === 'remove-trusted-cert') {
      state.trusted = false
      return ok()
    }
    throw new Error(`comando inesperado ${file}`)
  })
  const deps: TrustDeps = {
    platform: opts.platform ?? 'darwin',
    execPath: EXEC,
    certPath: opts.certText === null ? null : '/Applications/Lazunox.app/Contents/Resources/signing/LazunoxLocalSigning.cer',
    run,
    readFile: async () => opts.certText ?? pem,
    tempFile: async () => ({ path: '/tmp/x/ajustes.plist', cleanup: async () => undefined })
  }
  return { deps, calls, state }
}

describe('certificado público empaquetado', () => {
  it('su huella SHA-1 es la fijada en install.sh y NO contiene llave privada', () => {
    expect(certSha1(pem)).toBe(PINNED_CERT_SHA1)
    expect(pem).not.toMatch(/PRIVATE KEY/)
    expect(certDer(pem)).not.toBeNull()
    const sh = readFileSync(join(__dirname, '../../../scripts/install/install.sh'), 'utf8')
    expect(sh).toContain(`PINNED_CERT_SHA1="${PINNED_CERT_SHA1}"`)
  })
  it('rechaza archivos con llave privada, vacíos o con más de un certificado', () => {
    expect(certDer(`${pem}\n${['-----BEGIN', 'PRIVATE KEY-----'].join(' ')}\nAAAA`)).toBeNull()
    expect(certDer('')).toBeNull()
    expect(certDer(pem + pem)).toBeNull()
  })
})

describe('empaquetado del certificado público', () => {
  it('va por extraResources de macOS (Contents/Resources/signing), fuera del .asar, y real.ts busca ese mismo nombre', () => {
    const cfg = readFileSync(join(__dirname, '../../../electron-builder.js'), 'utf8')
    expect(cfg).toContain("from: 'resources/signing'")
    expect(cfg).toContain("filter: ['LazunoxLocalSigning.cer']")
    expect(cfg).toContain("'!resources/signing/**'")
    expect(readFileSync(join(__dirname, 'real.ts'), 'utf8')).toContain("'LazunoxLocalSigning.cer'")
  })
  it('la extensión .cer no es de secretos, y la guarda de secretos sigue marcando .pem/.p12/.key reales', () => {
    const re =
      /(^|\/)\.env(\..+)?$|\.(pem|p12|pfx|key|keystore)$|(^|\/)id_(rsa|ed25519|ecdsa)$|(^|\/)\.(npmrc|netrc)$|settings\.local\.json$/i
    const guard = readFileSync(join(__dirname, '../../test/no-secrets.test.ts'), 'utf8')
    expect(guard).toContain(String.raw`\.(pem|p12|pfx|key|keystore)$`)
    for (const f of ['a/b.pem', 'x.p12', 'k.key', 'resources/signing/otro.pem']) expect(re.test(f)).toBe(true)
    expect(re.test('resources/signing/LazunoxLocalSigning.cer')).toBe(false)
  })
})

describe('qué pieza se ofrece (decisión de mostrar/ocultar)', () => {
  it('app firmada con el certificado fijado y sin confianza → «untrusted» (se ofrece)', async () => {
    expect(await trustState(fake().deps)).toBe('untrusted')
  })
  it('ya confiado (lectura de solo lectura, sin contraseña) → «trusted» (la fila dice Listo)', async () => {
    const f = fake({ trusted: true })
    expect(await trustState(f.deps)).toBe('trusted')
    expect(f.calls.some(([, a]) => a[0] === 'add-trusted-cert')).toBe(false)
  })
  it('no macOS → oculta, sin ejecutar nada', async () => {
    const f = fake({ platform: 'win32' })
    expect(await trustState(f.deps)).toBe('hidden')
    expect(f.calls).toEqual([])
  })
  it('build de desarrollo, ad-hoc o firmada por otro certificado → oculta', async () => {
    expect(await trustState(fake({ dr: 'designated => cdhash H"abcd"' }).deps)).toBe('hidden')
    expect(await trustState(fake({ dr: 'designated => certificate leaf = H"0000000000000000000000000000000000000000"' }).deps)).toBe(
      'hidden'
    )
  })
  it('sin certificado empaquetado, ilegible o con otra huella → oculta', async () => {
    expect(await trustState(fake({ certText: null }).deps)).toBe('hidden')
    expect(await trustState(fake({ certText: 'basura' }).deps)).toBe('hidden')
  })
  it('lee la huella aunque venga en minúsculas y descarta resultados de «desconfiar»', () => {
    expect(leafIsPinned(`certificate leaf = H"${PINNED_CERT_SHA1}"`)).toBe(true)
    expect(isTrustedIn(JSON.parse(trustedPlist))).toBe(true)
    expect(
      isTrustedIn({
        trustList: {
          [PINNED_CERT_SHA1.toUpperCase()]: { trustSettings: [{ kSecTrustSettingsPolicyName: 'CodeSigning', kSecTrustSettingsResult: 3 }] }
        }
      })
    ).toBe(true)
    expect(
      isTrustedIn({
        trustList: {
          [PINNED_CERT_SHA1.toUpperCase()]: { trustSettings: [{ kSecTrustSettingsPolicyName: 'CodeSigning', kSecTrustSettingsResult: 4 }] }
        }
      })
    ).toBe(false)
    expect(
      isTrustedIn({
        trustList: {
          [PINNED_CERT_SHA1.toUpperCase()]: { trustSettings: [{ kSecTrustSettingsPolicyName: 'SSL', kSecTrustSettingsResult: 1 }] }
        }
      })
    ).toBe(false)
    expect(isTrustedIn(null)).toBe(false)
  })
  it('appBundleOf', () => {
    expect(appBundleOf(EXEC)).toBe(APP)
    expect(appBundleOf('/usr/local/bin/electron')).toBeNull()
  })
})

describe('confiar: argumentos exactos, sin shell', () => {
  it('dominio de usuario (sin -d), raíz de confianza, solo firma de código, ruta absoluta del certificado empaquetado', async () => {
    const f = fake()
    expect(await trustCertificate(f.deps)).toEqual({ ok: true })
    const add = f.calls.find(([, a]) => a[0] === 'add-trusted-cert')!
    expect(add[0]).toBe('/usr/bin/security')
    expect(add[1]).toEqual(['add-trusted-cert', '-r', 'trustRoot', '-p', 'codeSign', f.deps.certPath])
    expect(add[1]).not.toContain('-d')
    expect(add[1]).not.toContain('-k')
    expect(addTrustArgs('/x.pem')).toEqual(['add-trusted-cert', '-r', 'trustRoot', '-p', 'codeSign', '/x.pem'])
    expect(f.calls.every(([file]) => ['/usr/bin/security', '/usr/bin/codesign', '/usr/bin/plutil'].includes(file))).toBe(true)
    expect(f.calls.some(([file]) => /sudo|sh$|osascript/.test(file))).toBe(false)
  })
  it('ya confiado: no vuelve a pedir nada', async () => {
    const f = fake({ trusted: true })
    expect(await trustCertificate(f.deps)).toEqual({ ok: true })
    expect(f.calls.some(([, a]) => a[0] === 'add-trusted-cert')).toBe(false)
  })
  it('cancelar el aviso de contraseña = «cancelled» (no es un error)', async () => {
    const f = fake({
      addResult: { code: 1, stdout: '', stderr: 'SecTrustSettingsSetTrustSettings: The authorization was canceled by the user. (-60006)' }
    })
    expect(await trustCertificate(f.deps)).toEqual({ ok: false, error: 'cancelled' })
    expect(f.state.trusted).toBe(false)
  })
  it('otro fallo de macOS = «failed» con el motivo, y se puede reintentar', async () => {
    const f = fake({ addResult: { code: 1, stdout: '', stderr: 'no user interaction was possible' } })
    expect((await trustCertificate(f.deps)).error).toBe('cancelled')
    const g = fake({ addResult: { code: 1, stdout: '', stderr: 'algo salió mal' } })
    expect(await trustCertificate(g.deps)).toEqual({ ok: false, error: 'failed', message: 'algo salió mal' })
    g.state.trusted = false
  })
  it('éxito de security pero sin efecto real → «failed» (no se miente)', async () => {
    const f = fake({ addResult: { code: 0, stdout: '', stderr: '' } })
    f.deps.run = vi.fn(async (file, args) => {
      if (file === '/usr/bin/plutil') return { code: 0, stdout: JSON.stringify({ trustList: {} }), stderr: '' }
      if (file === CODESIGN_BIN) return { code: 0, stdout: '', stderr: DR }
      return { code: 0, stdout: '', stderr: args[0] === 'x' ? '' : '' }
    })
    expect((await trustCertificate(f.deps)).error).toBe('failed')
  })
  it('donde la pieza no corresponde, no ejecuta nada', async () => {
    const f = fake({ platform: 'linux' })
    expect(await trustCertificate(f.deps)).toEqual({ ok: false, error: 'unavailable' })
    expect(f.calls).toEqual([])
  })
})

describe('quitar la confianza (Ajustes)', () => {
  it('ejecuta remove-trusted-cert con la ruta del certificado y comprueba el resultado', async () => {
    const f = fake({ trusted: true })
    expect(await untrustCertificate(f.deps)).toEqual({ ok: true })
    const rm = f.calls.find(([, a]) => a[0] === 'remove-trusted-cert')!
    expect(rm[1]).toEqual(['remove-trusted-cert', f.deps.certPath])
    expect(removeTrustArgs('/x.pem')).toEqual(['remove-trusted-cert', '/x.pem'])
  })
  it('si ya no confía, no hace nada', async () => {
    const f = fake({ trusted: false })
    expect(await untrustCertificate(f.deps)).toEqual({ ok: true })
    expect(f.calls.some(([, a]) => a[0] === 'remove-trusted-cert')).toBe(false)
  })
})
