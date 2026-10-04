import { describe, expect, it } from 'vitest'
import { installPerfReader, mark } from './perf'

describe('marcas de arranque (onyx:*)', () => {
  it('__onyxPerf devuelve las marcas en orden y solo las propias', async () => {
    installPerfReader()
    const read = (globalThis as unknown as { __onyxPerf: () => Array<[string, number]> }).__onyxPerf
    performance.mark('otra-cosa')
    for (const n of ['main', 'lang', 'boot', 'painted']) {
      mark(n)
      await new Promise((r) => setTimeout(r, 2))
    }
    const rows = read().filter(([name]) => ['onyx:main', 'onyx:lang', 'onyx:boot', 'onyx:painted'].includes(name))
    expect(rows.map((r) => r[0])).toEqual(['onyx:main', 'onyx:lang', 'onyx:boot', 'onyx:painted'])
    expect(rows.every((r, i) => i === 0 || r[1] >= rows[i - 1][1])).toBe(true)
    expect(read().some(([n]) => n === 'otra-cosa')).toBe(false)
  })
})
