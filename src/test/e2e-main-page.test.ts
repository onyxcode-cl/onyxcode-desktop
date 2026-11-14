import { afterEach, expect, it, vi } from 'vitest'
import type { Page } from 'playwright-core'
import { waitForMainPage } from './e2e-main-page'

const pageAt = (url: string): Page =>
  ({ url: () => url, isClosed: () => false, waitForFunction: vi.fn().mockResolvedValue(undefined) }) as unknown as Page

afterEach(() => vi.useRealTimers())

it('selecciona la principal aunque Quick Entry haya aparecido primero', async () => {
  const quick = pageAt('http://127.0.0.1:5132/quick/index.html')
  const main = pageAt('http://127.0.0.1:5132/')
  expect(await waitForMainPage({ windows: () => [quick, main] }, 'http://127.0.0.1:5132')).toBe(main)
  expect(quick.waitForFunction).not.toHaveBeenCalled()
  expect(main.waitForFunction).toHaveBeenCalledOnce()
})

it('espera la navegación de about:blank y excluye ventanas de otro origen', async () => {
  vi.useFakeTimers()
  const main = pageAt('about:blank')
  const foreign = pageAt('https://example.test/index.html')
  const pending = waitForMainPage({ windows: () => [foreign, main] }, 'lazunox://app/index.html', 1000)
  await vi.advanceTimersByTimeAsync(100)
  main.url = () => 'lazunox://app/index.html'
  await vi.advanceTimersByTimeAsync(100)
  expect(await pending).toBe(main)
  expect(foreign.waitForFunction).not.toHaveBeenCalled()
})

it('falla con diagnóstico al vencer el plazo; no acepta una ventana auxiliar', async () => {
  vi.useFakeTimers()
  const quick = pageAt('lazunox://app/quick/index.html')
  const pending = expect(waitForMainPage({ windows: () => [quick] }, 'lazunox://app/index.html', 200)).rejects.toThrow(
    /No apareció la ventana principal.*quick\/index.html/
  )
  await vi.advanceTimersByTimeAsync(200)
  await pending
})

it('conserva el fallo del renderer y su causa sin reintentar el test', async () => {
  const main = pageAt('lazunox://app/index.html')
  const cause = new Error('renderer sin API')
  vi.mocked(main.waitForFunction).mockRejectedValue(cause)
  await expect(waitForMainPage({ windows: () => [main] }, 'lazunox://app/index.html')).rejects.toMatchObject({
    message: expect.stringContaining('La ventana principal no quedó lista'),
    cause
  })
  expect(main.waitForFunction).toHaveBeenCalledOnce()
})
