// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LearnedMemoryBundle } from '@shared/ipc-tasks'
import { DEFAULT_SETTINGS } from '@shared/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const confirm = vi.hoisted(() => vi.fn(() => Promise.resolve(true)))
vi.mock('../../../components/ConfirmDialog', () => ({ confirmDialog: confirm }))

import { MemorySection, filterEntries } from './MemorySection'
import { useSettings } from '../../../stores/settings'

const NOTES: LearnedMemoryBundle = {
  usuario: [
    { id: 'aaaaaaa1', tipo: 'preferencia', texto: 'Prefiere respuestas cortas', fecha: '2026-10-16' },
    { id: 'aaaaaaa2', tipo: 'decision', texto: 'Usa Postgres en producción', fecha: '2026-10-16' }
  ],
  proyecto: []
}

/** Escribe en un campo controlado llamando a su `onChange` de React (los eventos DOM sintéticos no llegan bajo el entorno de pruebas). */
export function typeInto(el: Element, value: string): void {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps'))
  const props = (el as unknown as Record<string, { onChange?: (e: unknown) => void }>)[key!]
  props.onChange!({ target: { value }, currentTarget: { value } })
}

let host: HTMLDivElement
let root: Root
let invoke: ReturnType<typeof vi.fn>
let bundle: LearnedMemoryBundle

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
const entries = (): string[] => [...host.querySelectorAll('[data-testid="memory-entry"]')].map((e) => e.textContent ?? '')

beforeEach(async () => {
  vi.unstubAllGlobals()
  confirm.mockClear()
  bundle = JSON.parse(JSON.stringify(NOTES)) as LearnedMemoryBundle
  invoke = vi.fn(async (channel: string, req?: { id?: string; texto?: string }) => {
    if (channel === 'tasks:mem:get') return { ok: true, data: bundle }
    if (channel === 'tasks:mem:remove') {
      bundle = { ...bundle, usuario: bundle.usuario.filter((e) => e.id !== req?.id) }
      return { ok: true, data: bundle }
    }
    if (channel === 'tasks:mem:update') {
      if (req?.texto === 'clave') return { ok: true, data: { ok: false, reason: 'secreto' } }
      bundle = { ...bundle, usuario: bundle.usuario.map((e) => (e.id === req?.id ? { ...e, texto: req?.texto ?? e.texto } : e)) }
      return { ok: true, data: { ok: true, bundle } }
    }
    if (channel === 'tasks:mem:forgetAll') {
      bundle = { usuario: [], proyecto: [] }
      return { ok: true, data: undefined }
    }
    return { ok: true, data: undefined }
  })
  ;(window as unknown as { api: unknown }).api = {
    tasks: { invoke, on: vi.fn() },
    settings: { set: vi.fn(async (p: object) => ({ ok: true, data: p })) }
  }
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, learningEnabled: true } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(createElement(MemorySection)))
  await flush()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete (window as unknown as { api?: unknown }).api
})

describe('MemorySection', () => {
  it('lista las notas guardadas y avisa de la privacidad', () => {
    expect(entries()).toHaveLength(2)
    expect(host.textContent).toContain('Prefiere respuestas cortas')
    expect(host.querySelector('[data-testid="memory-privacy"]')?.textContent).toContain('solo en este computador')
    expect(host.textContent).toContain('2 de 40 notas')
  })

  it('busca por texto y por tipo, sin distinguir tildes ni mayúsculas', async () => {
    const input = host.querySelector('input[type="search"]') as HTMLInputElement
    await act(async () => typeInto(input, 'DECISION'))
    expect(entries()).toHaveLength(1)
    expect(entries()[0]).toContain('Postgres')
  })

  it('borrar una nota llama al canal y la quita de la lista', async () => {
    const del = host.querySelectorAll('[data-testid="memory-entry"] button')[1] as HTMLButtonElement
    await act(async () => del.click())
    await flush()
    expect(invoke).toHaveBeenCalledWith('tasks:mem:remove', { alcance: 'usuario', id: 'aaaaaaa1' })
    expect(entries()).toHaveLength(1)
  })

  it('editar guarda el texto nuevo; si parece un secreto, muestra el error y no cierra', async () => {
    const edit = host.querySelectorAll('[data-testid="memory-entry"] button')[0] as HTMLButtonElement
    await act(async () => edit.click())
    const area = host.querySelector('[data-testid="memory-entry-editing"] textarea') as HTMLTextAreaElement
    const setVal = (v: string): void => typeInto(area, v)
    const saveBtn = (): HTMLButtonElement => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Guardar')!
    await act(async () => setVal('clave'))
    await act(async () => saveBtn().click())
    await flush()
    expect(host.textContent).toContain('parece contener una clave')
    expect(host.querySelector('[data-testid="memory-entry-editing"]')).not.toBeNull()
    await act(async () => setVal('Prefiere respuestas largas'))
    await act(async () => saveBtn().click())
    await flush()
    expect(host.querySelector('[data-testid="memory-entry-editing"]')).toBeNull()
    expect(host.textContent).toContain('respuestas largas')
  })

  it('«Olvidar todo» pide confirmación y vacía la lista', async () => {
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Olvidar todo')!
    await act(async () => btn.click())
    await flush()
    expect(confirm).toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith('tasks:mem:forgetAll')
    expect(entries()).toHaveLength(0)
  })

  it('si se cancela la confirmación no borra nada', async () => {
    confirm.mockResolvedValueOnce(false)
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Olvidar todo')!
    await act(async () => btn.click())
    await flush()
    expect(invoke).not.toHaveBeenCalledWith('tasks:mem:forgetAll')
    expect(entries()).toHaveLength(2)
  })
})

describe('filterEntries', () => {
  it('sin búsqueda devuelve todo', () => {
    expect(filterEntries(NOTES.usuario, '  ', (t) => t)).toHaveLength(2)
  })
})
