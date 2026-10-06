import { describe, expect, it } from 'vitest'
import { CAPS_ARG_PREFIX, capsFlagsFromArgv, capsFlagsToArgs } from './caps-argv'

describe('caps-argv', () => {
  it('sin banderas no añade ningún argumento (la ventana queda exactamente como hoy)', () => {
    expect(capsFlagsToArgs({})).toEqual([])
    expect(capsFlagsToArgs({ tasksWin: false, computerWin: false })).toEqual([])
  })
  it('ida y vuelta de las banderas conocidas', () => {
    expect(capsFlagsToArgs({ tasksWin: true })).toEqual([`${CAPS_ARG_PREFIX}tasksWin`])
    expect(capsFlagsFromArgv(['electron', ...capsFlagsToArgs({ tasksWin: true })])).toEqual({ tasksWin: true })
    expect(capsFlagsFromArgv(capsFlagsToArgs({ tasksWin: true, computerWin: true }))).toEqual({ tasksWin: true, computerWin: true })
  })
  it('lo desconocido, vacío o mal formado se ignora (todo apagado)', () => {
    expect(capsFlagsFromArgv([])).toEqual({})
    expect(capsFlagsFromArgv([`${CAPS_ARG_PREFIX}`])).toEqual({})
    expect(capsFlagsFromArgv([`${CAPS_ARG_PREFIX}root,admin,TASKSWIN,tasksWin=true`])).toEqual({})
    expect(capsFlagsFromArgv(['--lazunox-caps', 'tasksWin', '--other=tasksWin'])).toEqual({})
    expect(capsFlagsFromArgv([1, null] as unknown as string[])).toEqual({})
  })
})
