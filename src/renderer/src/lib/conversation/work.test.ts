import { beforeEach, describe, expect, it } from 'vitest'
import { setLang } from '@shared/i18n'
import {
  attentionSteps,
  countSteps,
  formatWorkDuration,
  isOngoing,
  segmentWork,
  workDoneAnnouncement,
  workDurationMs,
  workTitle,
  type WorkRole
} from './work'

beforeEach(() => setLang('es'))

const role = (s: string): WorkRole =>
  s.startsWith('T') ? 'tool' : s.startsWith('R') ? 'reasoning' : s.startsWith('x') ? 'text' : s.startsWith('!') ? 'break' : 'skip'
const kinds = (items: string[]): string[] => segmentWork(items, role).map((s) => `${s.kind}:${s.items.join(',')}`)

describe('segmentWork: qué entra en el trabajo plegado', () => {
  it('texto antes y respuesta final quedan fuera; la narración entre pasos queda dentro', () => {
    expect(kinds(['x1', 'T1', 'x2', 'T2', 'x3'])).toEqual(['plain:x1', 'work:T1,x2,T2', 'plain:x3'])
  })
  it('sin herramientas no hay trabajo: un razonamiento suelto se queda como siempre', () => {
    expect(kinds(['R1', 'x1'])).toEqual(['plain:R1,x1'])
  })
  it('el razonamiento previo a la primera herramienta entra en el trabajo', () => {
    expect(kinds(['R1', 'T1', 'x1'])).toEqual(['work:R1,T1', 'plain:x1'])
  })
  it('un corte (error, reintento) separa dos tramos de trabajo y nunca queda dentro', () => {
    expect(kinds(['T1', '!err', 'T2'])).toEqual(['work:T1', 'plain:!err', 'work:T2'])
  })
  it('las partes que no se pintan no rompen el tramo', () => {
    expect(kinds(['T1', 's', 'T2'])).toEqual(['work:T1,s,T2'])
  })
  it('lista vacía', () => {
    expect(segmentWork([], role)).toEqual([])
  })
})

describe('isOngoing', () => {
  it('es lo último que hace el agente solo si después no hay respuesta final ni cortes', () => {
    expect(isOngoing(segmentWork(['T1', 'x1'], role), 0, role)).toBe(false)
    expect(isOngoing(segmentWork(['x0', 'T1'], role), 1, role)).toBe(true)
    expect(isOngoing(segmentWork(['T1', '!err'], role), 0, role)).toBe(false)
    expect(isOngoing(segmentWork(['T1', 's'], role), 0, role)).toBe(true)
  })
})

describe('workDurationMs', () => {
  const tool = (start: number, end?: number, status = 'completed') => ({ type: 'tool', state: { status, time: { start, end } } })
  it('va del primer inicio al último fin', () => {
    const parts = [tool(1_000, 3_000), { type: 'reasoning', time: { start: 500, end: 900 } }, tool(4_000, 7_000)]
    expect(workDurationMs(parts, false, 99_999)).toBe(6_500)
  })
  it('en vivo el fin es la hora actual', () => {
    expect(workDurationMs([tool(10_000, undefined, 'running')], true, 16_000)).toBe(6_000)
  })
  it('sin tiempos fiables devuelve null (solo se dirán los pasos)', () => {
    expect(workDurationMs([{ type: 'tool', state: { status: 'pending' } }], false, 1)).toBeNull()
    expect(workDurationMs([], false, 1)).toBeNull()
    expect(workDurationMs([tool(5_000, 4_000)], false, 1)).toBeNull()
    expect(workDurationMs([tool(1_000)], false, 1)).toBeNull()
    expect(workDurationMs([tool(1_000, 1_000 + 25 * 3600_000)], false, 1)).toBeNull()
    expect(workDurationMs([tool(Number.NaN, 5)], false, 1)).toBeNull()
  })
  it('un texto de la narración con su tiempo también cuenta', () => {
    expect(workDurationMs([tool(2_000, 3_000), { type: 'text', time: { start: 3_000, end: 5_000 } }], false, 0)).toBe(3_000)
  })
})

describe('textos llanos', () => {
  it('duración legible', () => {
    expect(formatWorkDuration(400)).toBe('1 s')
    expect(formatWorkDuration(6_000)).toBe('6 s')
    expect(formatWorkDuration(60_000)).toBe('1 min')
    expect(formatWorkDuration(125_000)).toBe('2 min 5 s')
    expect(formatWorkDuration(3_600_000)).toBe('1 h')
    expect(formatWorkDuration(3_780_000)).toBe('1 h 3 min')
  })
  it('título terminado, con y sin tiempo', () => {
    expect(workTitle(4, 6_000, false)).toBe('Trabajó durante 6 s · 4 pasos')
    expect(workTitle(1, 6_000, false)).toBe('Trabajó durante 6 s · 1 paso')
    expect(workTitle(4, null, false)).toBe('Trabajó en 4 pasos')
  })
  it('título en vivo', () => {
    expect(workTitle(2, 3_000, true)).toBe('Trabajando… 3 s · 2 pasos')
    expect(workTitle(2, null, true)).toBe('Trabajando… 2 pasos')
  })
  it('aviso al terminar y versión en inglés', () => {
    expect(workDoneAnnouncement(3)).toBe('Terminó, 3 pasos')
    setLang('en')
    expect(workDoneAnnouncement(3)).toBe('Finished, 3 steps')
    expect(workTitle(2, 7_000, false)).toBe('Worked for 7 s · 2 steps')
  })
  it('cuenta pasos: el razonamiento y el texto no cuentan', () => {
    expect(countSteps([{ type: 'tool' }, { type: 'reasoning' }, { type: 'text' }, { type: 'tool' }])).toBe(2)
  })
})

describe('attentionSteps: lo que nunca se esconde', () => {
  const tool = (callID: string, status: string) => ({ type: 'tool', callID, state: { status } })
  it('errores y permisos pendientes, y nada más', () => {
    const parts = [tool('a', 'completed'), tool('b', 'error'), tool('c', 'running'), { type: 'reasoning' }, tool('d', 'pending')]
    expect(attentionSteps(parts, new Set(['d'])).map((p) => (p as { callID: string }).callID)).toEqual(['b', 'd'])
    expect(attentionSteps(parts, new Set())).toHaveLength(1)
  })
})
