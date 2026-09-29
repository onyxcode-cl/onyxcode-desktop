// Ciclo de vida para specs: una app por archivo (beforeAll/afterAll) y verificación de errores tras cada test.
import { afterAll, afterEach, beforeAll } from 'vitest'
import { startApp, type E2EApp, type LaunchOptions } from './launch'

export function useApp(opts: LaunchOptions = {}): () => E2EApp {
  let app: E2EApp | null = null
  beforeAll(async () => {
    app = await startApp(opts)
  })
  afterEach(async (ctx) => {
    if (!app) return
    if ((ctx.task.result?.errors?.length ?? 0) > 0) await app.screenshot(`fail-${ctx.task.name}`)
    await app.assertClean(ctx.task.name)
  })
  afterAll(async () => {
    await app?.stop()
    app = null
  })
  return () => {
    if (!app) throw new Error('app no iniciada')
    return app
  }
}
