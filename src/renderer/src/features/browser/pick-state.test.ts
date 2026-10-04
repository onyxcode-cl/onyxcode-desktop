import { beforeEach, describe, expect, it, vi } from 'vitest'

const br = vi.hoisted(() => vi.fn(() => Promise.resolve(undefined)))
vi.mock('./bridge', () => ({ br }))

import { isPicking, setPickState, stopPicking } from './pick-state'

const owner = { kind: 'code', directory: '/p' } as const
const other = { kind: 'tasks', folder: '/q' } as const

beforeEach(() => {
  br.mockClear()
  setPickState(owner, null)
  setPickState(other, null)
})

describe('pick-state', () => {
  it('stopPicking apaga la selección de ese dueño con la pestaña registrada', () => {
    setPickState(owner, 't1')
    expect(isPicking(owner)).toBe(true)
    stopPicking(owner)
    expect(br).toHaveBeenCalledWith('browser:pick', { owner, tabId: 't1', on: false })
    expect(isPicking(owner)).toBe(false)
  })
  it('no hace nada si no estaba activa ni toca a otros dueños', () => {
    setPickState(other, 't9')
    stopPicking(owner)
    expect(br).not.toHaveBeenCalled()
    expect(isPicking(other)).toBe(true)
  })
  it('nunca lanza si main falla', async () => {
    br.mockReturnValueOnce(Promise.reject(new Error('x')) as never)
    setPickState(owner, 't1')
    expect(() => stopPicking(owner)).not.toThrow()
    await Promise.resolve()
  })
})
