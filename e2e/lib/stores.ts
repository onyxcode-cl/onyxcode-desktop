// Ayudantes sobre `window.__onyxE2E` (ganchos DEV: stores zustand y acciones). Requieren `localStorage['onyx.e2e']='1'`.
import type { Page } from 'playwright-core'

export type StoreName = 'useSessions' | 'useCode' | 'useTasks' | 'useUi' | 'useServer' | 'useChat' | 'useSettings' | 'useProviders'

/** Espera a que los ganchos existan (se cargan con un import dinámico tras el arranque). */
export async function waitForHooks(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForFunction(() => Boolean((window as unknown as { __onyxE2E?: object }).__onyxE2E), undefined, { timeout })
}

/** Estado actual del store (serializado por Playwright: las funciones se descartan). `pick` = ruta 'a.b.c'. */
export async function storeState<T = unknown>(page: Page, store: StoreName, pick?: string): Promise<T> {
  return page.evaluate(
    ([s, p]) => {
      const st = (window as any).__onyxE2E[s].getState()
      if (!p) return JSON.parse(JSON.stringify(st, (_k, v) => (typeof v === 'function' ? undefined : v)))
      return p.split('.').reduce((o: any, k: string) => (o == null ? o : o[k]), st)
    },
    [store, pick] as const
  ) as Promise<T>
}

/** Llama a un método del store (`useCode.getState().selectSession(id)`), espera promesas y devuelve el resultado. */
export async function storeCall<T = unknown>(page: Page, store: StoreName, method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    async ([s, m, a]) => (window as any).__onyxE2E[s].getState()[m](...(a as unknown[])),
    [store, method, args] as const
  ) as Promise<T>
}

export async function storeSet(page: Page, store: StoreName, partial: Record<string, unknown>): Promise<void> {
  await page.evaluate(([s, p]) => (window as any).__onyxE2E[s].setState(p), [store, partial] as const)
}

/** Llama a una función suelta del gancho (`openChatSession`, `newChat`, `throwIn`). */
export async function hook<T = unknown>(page: Page, name: 'openChatSession' | 'newChat' | 'throwIn', ...args: unknown[]): Promise<T> {
  return page.evaluate(async ([n, a]) => (window as any).__onyxE2E[n](...(a as unknown[])), [name, args] as const) as Promise<T>
}

export async function setMode(page: Page, mode: 'chat' | 'code' | 'tasks' | 'routines'): Promise<void> {
  await storeCall(page, 'useUi', 'setMode', mode)
}

/** Conexión al OpenCode (falso) tal como la ve el renderer. */
export async function connection(page: Page): Promise<{ baseUrl: string; authorization: string }> {
  await page.waitForFunction(() => Boolean((window as any).__onyxE2E?.useServer.getState().connection), undefined, { timeout: 60_000 })
  return storeState(page, 'useServer', 'connection')
}
