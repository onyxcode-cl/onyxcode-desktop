import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `xlsx` (SheetJS CE) NO se instala desde el registro de npm (Fase 3 del plan del visor): la versión
 * publicada ahí es la vieja con los CVE-2023-30533/CVE-2024-22363 ya corregidos en v0.20.3, pero el
 * registro npm no la tiene — solo está en `cdn.sheetjs.com`. Se vendoriza el tgz oficial en
 * `vendor/sheetjs/` y se fija su sha256 acá: si alguien corre `npm install xlsx@latest` por error, o el
 * archivo vendorizado se corrompe o se reemplaza, esta prueba falla antes de que llegue a producción.
 */
const ROOT = resolve(__dirname, '../..')
const PINNED_SHA256 = '8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8'
const TARBALL = resolve(ROOT, 'vendor/sheetjs/xlsx-0.20.3.tgz')

describe('xlsx (SheetJS CE) vendorizado, nunca desde el registro de npm', () => {
  it('package.json declara la dependencia como el archivo local vendorizado', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
    expect(pkg.dependencies.xlsx).toBe('file:vendor/sheetjs/xlsx-0.20.3.tgz')
  })

  it('package-lock.json resolvió xlsx contra el archivo local, no contra registry.npmjs.org', () => {
    const lock = JSON.parse(readFileSync(resolve(ROOT, 'package-lock.json'), 'utf8'))
    const entry = lock.packages['node_modules/xlsx']
    expect(entry).toBeTruthy()
    expect(entry.resolved).toBe('file:vendor/sheetjs/xlsx-0.20.3.tgz')
    expect(entry.resolved).not.toContain('registry.npmjs.org')
  })

  it('el tgz vendorizado tiene exactamente el sha256 fijado (detecta corrupción o reemplazo silencioso)', () => {
    const bytes = readFileSync(TARBALL)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(PINNED_SHA256)
  })
})
