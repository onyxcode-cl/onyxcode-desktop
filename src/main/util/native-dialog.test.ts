import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ dialog: { showMessageBox: vi.fn(async () => ({ response: 2 })) } }))
vi.mock('@shared/brand', () => ({ DISPLAY_NAME: 'Lazunox' }))

import { APPLESCRIPT, askButtons } from './native-dialog'

const BTN = ['No', 'Permitir en esta tarea', 'Permitir siempre']
const D = {
  message: '¿Dejar que el agente abra wikipedia.org?',
  detail: 'https://es.wikipedia.org/wiki/Canberra',
  buttons: BTN,
  defaultIndex: 0,
  cancelIndex: 0
}
const electron = { showMessageBox: vi.fn(async () => ({ response: 2 })) } as never

describe('diálogo de botones que no congela la app', () => {
  it('en macOS lo muestra osascript con el texto como ARGUMENTO, nunca dentro del script', async () => {
    const run = vi.fn(async (_a: string[]) => 'Permitir en esta tarea')
    const i = await askButtons(D, { platform: 'darwin', run, electronDialog: electron })
    expect(i).toBe(1)
    const args = run.mock.calls[0][0] as string[]
    const sep = args.indexOf('--')
    // Todo lo que va ANTES del `--` es el script fijo; los textos del usuario solo van después.
    expect(args.slice(0, sep)).toEqual(APPLESCRIPT)
    expect(args.slice(0, sep).join(' ')).not.toContain('wikipedia')
    expect(args.slice(sep + 1)).toEqual(['Lazunox', `${D.message}\n\n${D.detail}`, 'No', '600', ...BTN])
  })

  it('una URL con comillas y saltos de línea no puede inyectar AppleScript (va tal cual en argv)', async () => {
    const run = vi.fn(async (_a: string[]) => 'No')
    const evil = 'https://x.test/"; do shell script "touch /tmp/pwn"; "\nmás'
    await askButtons({ ...D, detail: evil }, { platform: 'darwin', run, electronDialog: electron })
    const args = run.mock.calls[0][0] as string[]
    expect(args.slice(0, args.indexOf('--')).join(' ')).not.toContain('touch')
    expect(args).toContain(`${D.message}\n\n${evil}`)
  })

  it('cerrar sin elegir (Esc / tiempo agotado) cuenta como el índice de cancelar, que es el seguro', async () => {
    expect(await askButtons(D, { platform: 'darwin', run: async () => '__cancel__', electronDialog: electron })).toBe(0)
    expect(await askButtons(D, { platform: 'darwin', run: async () => 'Nombre raro', electronDialog: electron })).toBe(0)
  })

  it('si osascript falla vuelve al diálogo de Electron', async () => {
    const e = { showMessageBox: vi.fn(async () => ({ response: 2 })) } as never
    const i = await askButtons(D, { platform: 'darwin', run: async () => Promise.reject(new Error('sin osascript')), electronDialog: e })
    expect(i).toBe(2)
    expect((e as { showMessageBox: ReturnType<typeof vi.fn> }).showMessageBox).toHaveBeenCalledOnce()
  })

  it('fuera de macOS usa el diálogo de Electron, con el botón seguro por defecto', async () => {
    const e = { showMessageBox: vi.fn(async () => ({ response: 1 })) } as never
    expect(await askButtons(D, { platform: 'win32', electronDialog: e })).toBe(1)
    expect((e as { showMessageBox: ReturnType<typeof vi.fn> }).showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ defaultId: 0, cancelId: 0, buttons: BTN })
    )
  })

  it('botones repetidos o fuera de 2 a 3: no se arriesga con osascript y usa Electron', async () => {
    const run = vi.fn(async (_a: string[]) => 'x')
    await askButtons({ ...D, buttons: ['No', 'No'] }, { platform: 'darwin', run, electronDialog: electron })
    await askButtons({ ...D, buttons: ['a', 'b', 'c', 'd'] }, { platform: 'darwin', run, electronDialog: electron })
    expect(run).not.toHaveBeenCalled()
  })
})
