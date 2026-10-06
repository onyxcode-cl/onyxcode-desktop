import { describe, expect, it } from 'vitest'
import { renameReplaceSync } from './fs-retry'

const fail = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })

describe('renameReplaceSync', () => {
  it('Windows: reintenta EPERM/EBUSY/EACCES con espera creciente y al final lo consigue', () => {
    let n = 0
    const waits: number[] = []
    renameReplaceSync('a', 'b', {
      platform: 'win32',
      rename: () => {
        if (++n < 3) throw fail(n === 1 ? 'EPERM' : 'EBUSY')
      },
      sleep: (ms) => waits.push(ms)
    })
    expect(n).toBe(3)
    expect(waits).toEqual([25, 50])
  })
  it('Windows: tras agotar los intentos lanza el último error (no lo silencia)', () => {
    let n = 0
    expect(() =>
      renameReplaceSync('a', 'b', {
        platform: 'win32',
        attempts: 3,
        rename: () => {
          n++
          throw fail('EACCES')
        },
        sleep: () => undefined
      })
    ).toThrow('EACCES')
    expect(n).toBe(3)
  })
  it('Windows: un error que no es transitorio (ENOENT) se lanza al instante', () => {
    let n = 0
    expect(() =>
      renameReplaceSync('a', 'b', {
        platform: 'win32',
        rename: () => {
          n++
          throw fail('ENOENT')
        },
        sleep: () => undefined
      })
    ).toThrow('ENOENT')
    expect(n).toBe(1)
  })
  it('macOS/Linux: un solo intento, exactamente como antes', () => {
    for (const platform of ['darwin', 'linux']) {
      let n = 0
      expect(() =>
        renameReplaceSync('a', 'b', {
          platform,
          rename: () => {
            n++
            throw fail('EPERM')
          },
          sleep: () => {
            throw new Error('no debe esperar')
          }
        })
      ).toThrow('EPERM')
      expect(n).toBe(1)
    }
  })
})
