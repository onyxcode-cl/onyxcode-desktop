// @vitest-environment jsdom
import { vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
const cw = vi.hoisted(() => vi.fn())
vi.mock('./bridge', () => ({ cw }))
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setLang } from '@shared/i18n'
import { useLang } from '../../../lib/i18n'
import { FileReview } from './FileReview'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const OK = { status: 'ok', items: [{ ok: true, text: 'Tiene título' }] }
const BAD = {
  status: 'issues',
  items: [
    { ok: true, text: 'Tiene título' },
    { ok: false, text: 'Celdas vacías' },
    { ok: true, text: 'Nota', note: true }
  ]
}

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  setLang('es')
  useLang.setState({ lang: 'es' })
  cw.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const f = (path: string, mtime = 1, size = 10) => ({ path, mtime, size })
const show = async (file: ReturnType<typeof f>): Promise<void> => {
  await act(async () => root.render(createElement(FileReview, { file })))
}
const badge = (): HTMLButtonElement => host.querySelector('[data-testid="file-review"]') as HTMLButtonElement
const tick = (): Promise<void> => act(async () => void (await new Promise((r) => setTimeout(r, 5))))

describe('FileReview', () => {
  it('no pinta nada para un archivo que no es Word/Excel/PowerPoint y no pide revisión', async () => {
    await show(f('/x/a.pdf'))
    expect(host.innerHTML).toBe('')
    expect(cw).not.toHaveBeenCalled()
  })

  it('mientras llega la revisión dice «Sin revisar»; luego «Revisado ✔»', async () => {
    let release!: (v: unknown) => void
    cw.mockReturnValue(new Promise((r) => (release = r)))
    await show(f('/x/ok.docx'))
    expect(badge().dataset.status).toBe('none')
    expect(badge().textContent).toContain('Sin revisar')
    release(OK)
    await tick()
    expect(badge().dataset.status).toBe('ok')
    expect(badge().textContent).toContain('Revisado ✔')
  })

  it('con ✘ cuenta los avisos (sin las notas) y la lista aparece al desplegar', async () => {
    cw.mockResolvedValue(BAD)
    await show(f('/x/mal.xlsx'))
    await tick()
    expect(badge().dataset.status).toBe('issues')
    expect(badge().textContent).toContain('1 aviso')
    expect(host.textContent).not.toContain('Celdas vacías')
    act(() => badge().click())
    expect(host.textContent).toContain('Celdas vacías')
    expect(badge().getAttribute('aria-expanded')).toBe('true')
  })

  it('si el archivo cambia (otra fecha) NO conserva el ✔ anterior: vuelve a «Sin revisar» y revisa de nuevo', async () => {
    cw.mockResolvedValueOnce(OK)
    await show(f('/x/cambia.pptx', 1))
    await tick()
    expect(badge().dataset.status).toBe('ok')
    let release!: (v: unknown) => void
    cw.mockReturnValueOnce(new Promise((r) => (release = r)))
    await show(f('/x/cambia.pptx', 2))
    expect(badge().dataset.status).toBe('none')
    release(BAD)
    await tick()
    expect(badge().dataset.status).toBe('issues')
    expect(cw).toHaveBeenCalledTimes(2)
  })

  it('si la revisión falla, dice «Sin revisar» (no inventa un ✔)', async () => {
    cw.mockRejectedValue(new Error('boom'))
    await show(f('/x/roto.docx'))
    await tick()
    expect(badge().dataset.status).toBe('none')
  })
})
