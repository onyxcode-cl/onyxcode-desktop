/**
 * PRUEBA REAL (omitida por defecto): descarga e instala el LibreOffice OFICIAL fijado en `resources/libreoffice/pin.json` en una carpeta
 * temporal, con `hdiutil`, `codesign` y `ditto` de verdad, y comprueba que `soffice` arranca y convierte un archivo a PDF.
 * Descarga ~300 MB: se activa con `LAZUNOX_REAL_LO=1 npx vitest run src/main/office/libreoffice.real.test.ts`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installLibreOffice, loadOfficePin, officeStatus, removeLibreOffice } from './libreoffice'

const ON = process.env.LAZUNOX_REAL_LO === '1' && process.platform === 'darwin'

describe.skipIf(!ON)('LibreOffice real (descarga oficial)', () => {
  it('instala, verifica, ejecuta y se puede quitar', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lo-real-'))
    try {
      const pin = loadOfficePin(join(process.cwd(), 'resources', 'libreoffice', 'pin.json'))
      const deps = { binDir: join(dir, 'bin'), pin, systemApp: join(dir, 'NoExiste.app') }
      expect(officeStatus(deps).state).toBe('missing')
      let last = ''
      const exe = await installLibreOffice(deps, (p) => {
        if (p.phase !== last) {
          last = p.phase
          console.log('fase:', p.phase)
        }
      })
      expect(existsSync(exe)).toBe(true)
      expect(officeStatus(deps)).toMatchObject({ state: 'installed', source: 'app' })
      // Arranca de verdad y convierte un .txt a PDF con un perfil propio.
      const src = join(dir, 'hola.txt')
      writeFileSync(src, 'Hola Lazunox\n')
      const prof = join(dir, 'perfil')
      execFileSync(
        exe,
        [`-env:UserInstallation=file://${prof}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, src],
        { timeout: 180_000 }
      )
      expect(existsSync(join(dir, 'hola.pdf'))).toBe(true)
      removeLibreOffice(deps)
      expect(officeStatus(deps).state).toBe('missing')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 900_000)
})
