import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORK_VIEW,
  expandStepGroups,
  parseReadingMode,
  parseStoredView,
  showReasoning,
  showStepGroup,
  useReadingMode,
  visibleStepParts
} from './reading-mode'

describe('vista del trabajo por superficie', () => {
  it('Chat arranca Resumida y Code «Con pasos»', () => {
    expect(DEFAULT_WORK_VIEW).toEqual({ chat: 'summary', code: 'normal' })
  })
  it('un valor guardado inválido es «sin elección»', () => {
    expect(parseStoredView('x')).toBeNull()
    expect(parseStoredView(null)).toBeNull()
    expect(parseStoredView('detailed')).toBe('detailed')
    expect(parseStoredView('normal')).toBe('normal')
  })
  it('elegir una vista en una superficie no cambia la otra y queda guardada', () => {
    const store = new Map<string, string>()
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v)
    }
    useReadingMode.getState().setView('code', 'detailed')
    expect(useReadingMode.getState().stored).toEqual({ chat: null, code: 'detailed' })
    expect(store.get('lazunox.workView.code')).toBe('detailed')
    expect(store.has('lazunox.workView.chat')).toBe(false)
    delete (globalThis as { localStorage?: unknown }).localStorage
  })
  it('sin almacenamiento el cambio vale igual para esta sesión', () => {
    useReadingMode.getState().setView('chat', 'normal')
    expect(useReadingMode.getState().stored.chat).toBe('normal')
  })
})

describe('visibleStepParts', () => {
  const tool = (callID: string, status = 'completed') => ({ type: 'tool', callID, state: { status } })
  const reasoning = { type: 'reasoning' }
  const none = new Set<string>()
  it('normal y detallado dejan todo', () => {
    const parts = [reasoning, tool('a')]
    expect(visibleStepParts('normal', parts, none)).toEqual(parts)
    expect(visibleStepParts('detailed', parts, none)).toEqual(parts)
  })
  it('resumen oculta el grupo sin error ni pendiente', () => {
    expect(visibleStepParts('summary', [reasoning, tool('a')], none)).toBeNull()
  })
  it('resumen conserva el grupo con error o permiso pendiente, sin razonamiento', () => {
    expect(visibleStepParts('summary', [reasoning, tool('a', 'error')], none)).toEqual([tool('a', 'error')])
    expect(visibleStepParts('summary', [reasoning, tool('b', 'running')], new Set(['b']))).toEqual([tool('b', 'running')])
  })
})

describe('modos de lectura', () => {
  it('un valor desconocido cae a normal', () => {
    expect(parseReadingMode(null)).toBe('normal')
    expect(parseReadingMode('x')).toBe('normal')
    expect(parseReadingMode('summary')).toBe('summary')
    expect(parseReadingMode('detailed')).toBe('detailed')
  })
  it('normal y detallado muestran todos los grupos', () => {
    for (const mode of ['normal', 'detailed'] as const) expect(showStepGroup(mode, { hasPending: false, hasError: false })).toBe(true)
  })
  it('resumen oculta los grupos, salvo con permiso pendiente o error', () => {
    expect(showStepGroup('summary', { hasPending: false, hasError: false })).toBe(false)
    expect(showStepGroup('summary', { hasPending: true, hasError: false })).toBe(true)
    expect(showStepGroup('summary', { hasPending: false, hasError: true })).toBe(true)
  })
  it('el razonamiento solo se oculta en resumen', () => {
    expect(showReasoning('summary')).toBe(false)
    expect(showReasoning('normal')).toBe(true)
    expect(showReasoning('detailed')).toBe(true)
  })
  it('solo detallado fuerza abierto', () => {
    expect(expandStepGroups('detailed')).toBe(true)
    expect(expandStepGroups('normal')).toBe(false)
    expect(expandStepGroups('summary')).toBe(false)
  })
})
