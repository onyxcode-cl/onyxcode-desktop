// @vitest-environment jsdom
import '../../../../../test/jsdom-first'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '@shared/i18n'
import type { DocFileInfo } from '@shared/ipc-code'
import { useLang } from '../../../lib/i18n'
import { fileCardActions, fileCardType, GeneratedFiles } from './GeneratedFiles'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const revealDoc = vi.fn().mockResolvedValue(undefined)
const openDoc = vi.fn().mockResolvedValue(undefined)
const file: DocFileInfo = { path: '/p/a.pdf', name: 'a.pdf', bytes: 10 }

beforeEach(() => {
  setLang('es')
  useLang.setState({ lang: 'es' })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      platform: 'darwin',
      code: {
        git: { status: vi.fn() },
        files: { openDoc, revealDoc, docInfo: vi.fn().mockResolvedValue([file]) }
      }
    }
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  Reflect.deleteProperty(window, 'api')
})

describe('fileCardActions', () => {
  it('«Abrir» llama a la apertura del sistema; «Mostrar» solo a revelar', async () => {
    const api = { openDoc, revealDoc }
    const a = fileCardActions(api, '/p', '/p/a.xlsx')
    await a.open()
    expect(api.openDoc).toHaveBeenCalledWith('/p', '/p/a.xlsx')
    expect(api.revealDoc).not.toHaveBeenCalled()
    await a.reveal()
    expect(api.revealDoc).toHaveBeenCalledWith('/p', '/p/a.xlsx')
    expect(api.openDoc).toHaveBeenCalledTimes(1)
  })
  it('tipo por extensión', () => {
    expect(fileCardType('a.XLSM')).toBe('xlsx')
    expect(fileCardType('a.htm')).toBe('slides')
  })
})

describe('GeneratedFiles', () => {
  it('muestra «Ver», «Abrir» y «Mostrar en la carpeta» en ese orden', async () => {
    const part = {
      type: 'tool',
      tool: 'write',
      state: { status: 'completed', input: { filePath: '/p/a.pdf' } }
    } as never
    await act(async () => {
      root.render(createElement(GeneratedFiles, { parts: [part], root: '/p', done: true }))
    })
    const labels = [...host.querySelectorAll('button')].map((button) => button.textContent?.trim())
    expect(labels).toEqual(['Ver', 'Abrir', 'Mostrar en la carpeta'])
  })
})
