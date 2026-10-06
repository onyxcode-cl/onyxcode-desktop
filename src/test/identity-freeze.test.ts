import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_ID, APP_SLUG, DISPLAY_NAME, INTERNAL_NAME } from '../shared/brand'
import { CLOUD_ORIGIN } from '../shared/remote/cloud'
import { APP_BUNDLE_NAME } from '../shared/update-install'

/**
 * Guardia de la identidad ÚNICA «Lazunox»: el nombre visible, el interno, el bundle, el slug, el userData, el Llavero, el
 * protocolo y las etiquetas criptográficas son el mismo nombre. Cambiar `INTERNAL_NAME`/`APP_ID` sin un plan de migración hace
 * perder datos o permisos en silencio (userData, Llavero, actualizador, TCC y vínculos del celular dependen de ellos).
 * Las excepciones con el nombre antiguo viven en `src/test/legacy-name-allowlist.ts`.
 */
const ROOT = resolve(__dirname, '../..')
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

const SHA1 = /\b[0-9a-f]{40}\b/

describe('identidad Lazunox', () => {
  it('package.json: name y productName', () => {
    const pkg = JSON.parse(read('package.json')) as { name: string; productName: string }
    expect(pkg.productName).toBe('Lazunox')
    expect(pkg.name).toBe('lazunox')
  })

  it('electron-builder.js: appId y productName, sin CFBundleName/CFBundleExecutable', () => {
    const src = read('electron-builder.js')
    expect(src).toContain("productName: 'Lazunox'")
    expect(src).toContain("appId: 'cl.bentec.lazunox'")
    expect(src).not.toContain('CFBundleName')
    expect(src).not.toContain('CFBundleExecutable')
  })

  it('brand.ts: nombre interno y visible son el mismo; IDs fijos', () => {
    expect(INTERNAL_NAME).toBe('Lazunox')
    expect(DISPLAY_NAME).toBe('Lazunox')
    expect(INTERNAL_NAME).toBe(DISPLAY_NAME)
    expect(APP_ID).toBe('cl.bentec.lazunox')
    expect(APP_SLUG).toBe('lazunox')
  })

  it('el proceso principal fija app.setName(INTERNAL_NAME) y nunca userData ni un nombre literal', () => {
    expect(read('src/main/index.ts')).toContain('app.setName(INTERNAL_NAME)')
    for (const f of walk(resolve(ROOT, 'src/main'))) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toContain("setPath('userData'")
      expect(src, f).not.toContain('setName(DISPLAY_NAME')
      expect(src, f).not.toMatch(/setName\(\s*['"]Lazunox/)
    }
  })

  it('constantes técnicas: bundle, protocolo y distro WSL', () => {
    expect(APP_BUNDLE_NAME).toBe('Lazunox.app')
    // Se leen como texto: src/test no puede importar archivos de src/main (tsconfig.web).
    expect(read('src/main/security/app-protocol.ts')).toContain('export const APP_SCHEME = APP_SLUG')
    expect(read('src/main/tasks/backends/wsl-spec.ts')).toContain("export const WSL_DISTRO = 'Lazunox-Tareas'")
  })

  it('etiquetas criptográficas del remoto: la sal es lazunox/remote/v3 en la PWA y en el Mac', () => {
    expect(read('pwa/src/keys.ts')).toContain("'lazunox/remote/v3'")
    for (const f of ['src/shared/remote/cloud.ts', 'src/shared/remote/handshake.ts']) expect(read(f), f).toContain("'lazunox/remote/v3'")
  })

  it('actualizador: swap.sh sigue exigiendo Lazunox.app', () => {
    expect(read('resources/updater/swap.sh')).toContain('*/Lazunox.app)')
  })

  it('pin del certificado: el mismo SHA-1 en install.sh, su test, make-cask, la cask y docs/INSTALAR.md', () => {
    const pin = /PINNED_CERT_SHA1="([0-9a-f]{40})"/.exec(read('scripts/install/install.sh'))?.[1]
    expect(pin).toBe('8446c25f2c710d66701c262f048390d8f6edba31')
    expect(/const PIN = '([0-9a-f]{40})'/.exec(read('scripts/install/install.test.mjs'))?.[1]).toBe(pin)
    for (const f of ['scripts/install/make-cask.mjs', 'packaging/homebrew-tap/Casks/lazunox.rb', 'docs/INSTALAR.md']) {
      const src = read(f)
      expect(src, f).toContain(`certificate leaf = H"${pin}"`)
      // ningún otro SHA-1 de certificado (p. ej. el de la identidad anterior) en esas líneas
      for (const line of src.split('\n').filter((l) => /certificate leaf/.test(l))) expect(SHA1.exec(line)?.[0], f).toBe(pin)
    }
  })

  it('dominio del remoto: SITE_ORIGIN (site-lib.mjs) === CLOUD_ORIGIN y wrangler ALLOWED_ORIGINS lo contiene', () => {
    const site = /export const SITE_ORIGIN = '([^']+)'/.exec(read('scripts/site-lib.mjs'))?.[1]
    expect(site).toBe(CLOUD_ORIGIN)
    const allowed = /"ALLOWED_ORIGINS":\s*"([^"]*)"/.exec(read('cloud/remoto-worker/wrangler.jsonc'))?.[1] ?? ''
    expect(allowed.split(',').map((o) => o.trim())).toContain(CLOUD_ORIGIN)
  })
})
