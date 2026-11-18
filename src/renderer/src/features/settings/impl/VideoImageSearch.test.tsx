// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { es } from '@shared/i18n/es'
const { invoke, open } = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }))
vi.mock('../../tasks/impl/bridge', () => ({ cw: invoke }))
vi.mock('../../../lib/i18n', () => ({ useT: () => (k: keyof typeof es) => es[k] }))
vi.mock('../../../lib/open-external', () => ({ openExternalUrl: open }))
import { VideoImageSearch } from './VideoImageSearch'
vi.unstubAllGlobals()
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const div = document.createElement('div')
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  invoke.mockReset()
  open.mockReset()
})
it('estado sin revelar clave, guarda selección, permite quitarla y enlaza al proveedor elegido', async () => {
  invoke.mockImplementation(async (channel) =>
    channel === 'video:imageSearchStatus' ? { provider: 'serper', configured: { serper: true, brave: false }, secure: true } : { ok: true }
  )
  root = createRoot(div)
  await act(async () => root!.render(<VideoImageSearch />))
  expect(div.querySelector('input')!.type).toBe('password')
  expect(div.querySelector('input')!.value).toBe('')
  const button = (label: string) => [...div.querySelectorAll('button')].find((b) => b.textContent === label)!
  await act(async () => button('Guardar').click())
  expect(invoke).toHaveBeenCalledWith('video:imageSearchSave', { provider: 'serper' })
  await act(async () => button('Quitar clave').click())
  expect(invoke).toHaveBeenCalledWith('video:imageSearchSave', { provider: 'serper', key: '' })
  await act(async () => {
    const select = div.querySelector('select')!
    select.value = 'brave'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => button('Conseguir una clave').click())
  expect(open).toHaveBeenCalledWith('https://api-dashboard.search.brave.com/')
})
it('sin cifrado desactiva entrada y guardado', async () => {
  invoke.mockResolvedValue({ provider: 'serper', configured: { serper: false, brave: false }, secure: false })
  root = createRoot(div)
  await act(async () => root!.render(<VideoImageSearch />))
  expect(div.querySelector('input')!.disabled).toBe(true)
  expect([...div.querySelectorAll('button')].find((b) => b.textContent === 'Guardar')!.disabled).toBe(true)
  expect(div.textContent).toContain('No se guardan claves sin cifrar')
})
