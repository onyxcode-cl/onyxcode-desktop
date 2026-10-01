/**
 * Estrés de los puntos de restauración. Opcional: `npm run test:stress` (`ONYXCODE_STRESS=1`); no entra en
 * `npm run verify`. Mide límites (19 990 ok / 20 010 omitido), incremental, retraso del bucle de eventos y memoria.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RestorePoints } from './restore-points'

const RUN = process.env.ONYXCODE_STRESS === '1'

describe.skipIf(!RUN)('Puntos de restauración: estrés', () => {
  let base: string
  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-stress-')))
  })
  afterAll(() => rmSync(base, { recursive: true, force: true }))

  const fill = (dir: string, n: number): void => {
    mkdirSync(dir, { recursive: true })
    for (let i = 0; i < n; i++) {
      const d = join(dir, `d${i % 50}`)
      if (i < 50) mkdirSync(d, { recursive: true })
      writeFileSync(join(d, `f${i}.txt`), `contenido ${i}`)
    }
  }
  const make = (store: string): RestorePoints =>
    new RestorePoints({ root: store, trash: async () => undefined, freeBytes: () => Number.MAX_SAFE_INTEGER })

  it('19 990 archivos entran; 20 010 dejan el punto omitido', async () => {
    const ok = join(base, 'ok')
    fill(ok, 19_990)
    expect((await make(join(base, 's1')).create(ok, 's', 'x')).status).toBe('ok')
    const over = join(base, 'over')
    fill(over, 20_010)
    expect((await make(join(base, 's2')).create(over, 's', 'x')).status).toBe('skipped')
  }, 600_000)

  it('incremental de 5 000 archivos rápido y con el bucle de eventos sano (p99 < 100 ms)', async () => {
    const dir = join(base, 'inc')
    fill(dir, 5000)
    const rp = make(join(base, 's3'))
    await rp.create(dir, 's', 'uno')
    const h = monitorEventLoopDelay({ resolution: 5 })
    h.enable()
    const t0 = Date.now()
    const pt = await rp.create(dir, 's', 'dos')
    const ms = Date.now() - t0
    h.disable()
    expect(pt.status).toBe('ok')
    expect(ms).toBeLessThan(15_000)
    expect(h.percentile(99) / 1e6).toBeLessThan(100)
  }, 300_000)

  it('dos archivos de 45 MB: la memoria (RSS) sube menos de 200 MB', async () => {
    const dir = join(base, 'big')
    mkdirSync(dir)
    writeFileSync(join(dir, 'a.bin'), Buffer.alloc(45 * 1024 * 1024, 1))
    writeFileSync(join(dir, 'b.bin'), Buffer.alloc(45 * 1024 * 1024, 2))
    global.gc?.()
    const before = process.memoryUsage().rss
    const rp = make(join(base, 's4'))
    expect((await rp.create(dir, 's', 'x')).status).toBe('ok')
    expect((process.memoryUsage().rss - before) / 1024 / 1024).toBeLessThan(200)
  }, 300_000)
})
