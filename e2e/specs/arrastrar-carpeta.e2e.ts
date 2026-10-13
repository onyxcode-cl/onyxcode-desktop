// Arrastrar a la ventana de Tareas: la ruta real sale del preload (`webUtils.getPathForFile`) y main la valida igual que «Elegir carpeta».
// El arrastre del sistema no se puede simular (el protocolo de depuración se cuelga), así que se suelta un `File` REAL (elegido con un
// <input type=file>, que sí tiene ruta en disco) con un `DragEvent` sintético: pasa por el mismo `onDrop`, el mismo preload y el mismo main.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { fakeOutsideUserData } from '../lib/lotes'
import { MODE } from '../lib/launch'
import { MODE_LABELS } from '../../src/shared/labels'
import { expectVisible } from '../lib/wait'
import { IS_WIN } from '../lib/proc'

const fakeBin = fakeOutsideUserData()
const work = mkdtempSync(join(homedir(), 'lazunox-e2e-drop-'))
const file = join(work, 'nota.txt')
writeFileSync(file, 'hola')
afterAll(() => {
  fakeBin.dispose()
  rmSync(work, { recursive: true, force: true })
})

describe.skipIf(MODE !== 'dev' || IS_WIN)('Tareas: arrastrar a la ventana', () => {
  const app = useApp({ env: { OPENCODE_BIN: fakeBin.bin } })

  it('el preload entrega la ruta real y soltar un archivo (no carpeta) se rechaza con el aviso de siempre', async () => {
    const a = app()
    await a.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: MODE_LABELS.tasks }).click()
    await expectVisible(a.page.getByRole('button', { name: 'Elegir carpeta' }).first())

    await a.page.evaluate(() => {
      const input = document.createElement('input')
      input.type = 'file'
      input.id = 'lzx-drop-test'
      document.body.appendChild(input)
    })
    await a.page.locator('#lzx-drop-test').setInputFiles(file)
    const real = await a.page.evaluate(() => {
      const f = (document.getElementById('lzx-drop-test') as HTMLInputElement).files![0]
      return (window as unknown as { lzxPaths: { forFile: (f: File) => string } }).lzxPaths.forFile(f)
    })
    expect(real).toBe(file)

    await a.page.evaluate(() => {
      const f = (document.getElementById('lzx-drop-test') as HTMLInputElement).files![0]
      const dt = new DataTransfer()
      dt.items.add(f)
      const target = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2) ?? document.body
      for (const type of ['dragenter', 'dragover'])
        target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
    })
    await expectVisible(a.page.getByText('Suelta la carpeta para conectarla'))
    await a.page.evaluate(() => {
      const f = (document.getElementById('lzx-drop-test') as HTMLInputElement).files![0]
      const dt = new DataTransfer()
      dt.items.add(f)
      const target = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2) ?? document.body
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    })
    await expectVisible(a.page.getByText('No es una carpeta válida', { exact: false }))
  })
})
