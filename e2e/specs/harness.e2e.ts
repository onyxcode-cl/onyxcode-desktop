import { describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { dialogCalls, stubDialog } from '../lib/dialogs'
import { spyNotifications } from '../lib/notifications'
import { MODE, withLru } from '../lib/launch'
import { storeState, waitForHooks } from '../lib/stores'
import { IS_WIN } from '../lib/proc'

const app = useApp()

describe('colectores del harness', () => {
  it('capturan console.error y pageerror y respetan la lista blanca', async () => {
    const a = app()
    await a.page.evaluate(() => {
      console.error('e2e-sonda-consola')
      setTimeout(() => {
        throw new Error('e2e-sonda-pageerror')
      }, 0)
    })
    await expect.poll(() => a.unexpectedErrors().length, { timeout: 5000 }).toBeGreaterThanOrEqual(2)
    const texts = a.unexpectedErrors().map((e) => `${e.source}:${e.text}`)
    expect(texts.some((t) => t.startsWith('console:e2e-sonda-consola'))).toBe(true)
    expect(texts.some((t) => t.startsWith('pageerror:') && t.includes('e2e-sonda-pageerror'))).toBe(true)
    await expect(a.assertClean('sonda')).rejects.toThrow(/Errores no permitidos/)
    a.errors.length = 0 // consumidos: que el afterEach no los vuelva a reportar
  })

  it('stubDialog sustituye los diálogos nativos de main', async () => {
    const a = app()
    await stubDialog(a.electronApp, { openPaths: ['/tmp/x'], savePath: '/tmp/y.txt' })
    const r = await a.electronApp.evaluate(async ({ dialog }) => ({
      open: await dialog.showOpenDialog({ properties: ['openDirectory'] }),
      save: await dialog.showSaveDialog({})
    }))
    expect(r.open).toEqual({ canceled: false, filePaths: ['/tmp/x'] })
    expect(r.save).toEqual({ canceled: false, filePath: '/tmp/y.txt' })
    expect((await dialogCalls(a.electronApp)).map((c) => c.kind)).toEqual(['open', 'save'])
  })

  it('spyNotifications registra notificaciones y badge sin mostrarlas', async () => {
    const a = app()
    const spy = await spyNotifications(a.electronApp)
    await a.electronApp.evaluate(({ Notification, app }) => {
      new Notification({ title: 'T', body: 'B' }).show()
      app.dock?.setBadge('3')
    })
    expect(await spy.shown()).toEqual([{ title: 'T', body: 'B' }])
    if (!IS_WIN) expect(await spy.badge()).toBe('3') // el badge del Dock es de macOS
    await spy.clear()
    expect(await spy.shown()).toEqual([])
    expect(await spy.badge()).toBe('')
  })

  it.skipIf(MODE === 'prod')('stores y withLru operan sobre window.__onyxE2E', async () => {
    const a = app()
    await waitForHooks(a.page)
    await withLru(a, 2)
    expect(await a.page.evaluate(() => localStorage.getItem('onyx.lru.max'))).toBe('2')
    expect(await storeState(a.page, 'useUi', 'mode')).toBeTruthy()
  })
})
