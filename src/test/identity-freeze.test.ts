import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_ID, APP_SLUG, DISPLAY_NAME, INTERNAL_NAME } from '../shared/brand'
import { APP_BUNDLE_NAME } from '../shared/update-install'

/**
 * Guardia de la Fase 1 del renombre a «Lazunox»: solo cambia el nombre VISIBLE. La identidad de
 * almacenamiento (userData, Llavero, bundle id, `Lazunox.app`, protocolo…) queda congelada; cambiarla
 * hace perder datos o permisos en silencio. Cualquier cambio aquí exige el plan de la Fase 2.
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

describe('identidad congelada (Fase 1 del renombre)', () => {
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

  it('brand.ts: nombre interno y visible distintos; IDs sin cambios', () => {
    expect(INTERNAL_NAME).toBe('Lazunox')
    expect(DISPLAY_NAME).not.toBe(INTERNAL_NAME)
    expect(APP_ID).toBe('cl.bentec.lazunox')
    expect(APP_SLUG).toBe('lazunox')
  })

  it('el proceso principal fija app.setName(INTERNAL_NAME) y nunca el nombre visible ni userData', () => {
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

  it('PWA: la sal criptográfica no cambia', () => {
    expect(read('pwa/src/keys.ts')).toContain("'lazunox/remote/v3'")
  })

  it('actualizador: swap.sh sigue exigiendo Lazunox.app', () => {
    expect(read('resources/updater/swap.sh')).toContain('*/Lazunox.app)')
  })
})
