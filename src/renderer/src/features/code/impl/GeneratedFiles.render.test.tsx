// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Part } from '@opencode-ai/sdk/v2/client'
import type { DocFileInfo } from '@shared/ipc-code'
import type { ChatFileInfo } from '@shared/ipc-extras'
import { applyLangPref } from '../../../lib/i18n'
import { canViewChatFileHere } from '../../../lib/chatFileView'
import { GeneratedFiles } from './GeneratedFiles'
import { CodeDocLayout } from './CodeDocLayout'

// Solo se sustituye la superficie nativa: el hook, el registro y los canales del Chat son los reales.
vi.mock('../../chat/ChatDocPanel', () => ({
  ChatDocPanel: (p: { title: string; onClose: () => void; onToggleFullscreen: () => void }) => (
    <div data-shared-doc-panel>
      {p.title}
      <button onClick={p.onClose}>Cerrar panel</button>
      <button onClick={p.onToggleFullscreen}>Pantalla completa</button>
    </div>
  )
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const tool = (name: string, input: Record<string, unknown>, output: string, status = 'completed'): Part =>
  ({ id: 'p1', type: 'tool', tool: name, callID: 'c1', state: { status, input, output } }) as unknown as Part

let host: HTMLDivElement
let root: Root
let docInfo: ReturnType<typeof vi.fn>
let openDoc: ReturnType<typeof vi.fn>
let invoke: ReturnType<typeof vi.fn>
let file: DocFileInfo
let info: ChatFileInfo
let cwd: string

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function surface(platform = 'darwin', tasksWin = false): void {
  Object.assign(window, {
    api: {
      platform,
      capsFlags: { tasksWin },
      code: { git: { status: vi.fn() }, files: { docInfo, openDoc } },
      extras: { invoke, on: () => () => undefined }
    }
  })
}
const parts = (): Part[] => [tool('documentos_crear', {}, `Documento creado: ${file.path} (2 KB).`)]
const render = (ps = parts(), done = false, sessionId: string | null = 'code-1', width = 1200): void => {
  act(() =>
    root.render(
      <CodeDocLayout sessionId={sessionId} containerWidth={width}>
        {(documentOpen) => (
          <main data-document-open={documentOpen}>
            <GeneratedFiles parts={ps} root={cwd} done={done} />
          </main>
        )}
      </CodeDocLayout>
    )
  )
}
const cardButtons = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>('[data-file-card] button')]

beforeEach(() => {
  vi.unstubAllGlobals()
  cwd = '/proyecto'
  file = { path: '/proyecto/Informe ñ.docx', name: 'Informe ñ.docx', bytes: 2048 }
  info = { ...file, kind: 'office', canView: true, canOpen: true }
  docInfo = vi.fn(async () => [file])
  openDoc = vi.fn(async () => undefined)
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'extras:chatFile:info') return [info]
    if (channel === 'extras:chatFile:viewNative') return { ok: true }
    return undefined
  })
  surface()
  applyLangPref('es')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  applyLangPref('es')
  delete (window as unknown as { api?: unknown }).api
})

describe('tarjeta de documentos de Código y panel compartido', () => {
  it.each(['darwin', 'win32'])('%s: al completar crear muestra nombre, Ver y Abrir aunque el turno continúe', async (platform) => {
    if (platform === 'win32') {
      cwd = String.raw`C:\Proyectos\Mi proyecto`
      file = { ...file, path: String.raw`C:\Proyectos\Mi proyecto\Informe ñ.docx` }
      info = { ...info, ...file }
    }
    surface(platform, true)
    render()
    await flush()
    expect(docInfo).toHaveBeenCalledWith(cwd, [file.path])
    expect(host.querySelector('[data-file-card]')?.getAttribute('aria-label')).toBe(file.name)
    expect(cardButtons().map((b) => b.textContent)).toEqual(['Ver', 'Abrir', 'Mostrar en la carpeta'])
    expect(host.querySelector('[data-code-doc-panel]')).toBeNull()

    await act(async () => cardButtons()[0].click())
    await flush()
    expect(docInfo).toHaveBeenCalledTimes(2) // se revalida al pulsar Ver
    expect(invoke).toHaveBeenCalledWith('extras:chatFile:info', { paths: [file.path] })
    expect(invoke).toHaveBeenCalledWith('extras:chatFile:viewNative', expect.objectContaining({ path: file.path, lang: 'es' }))
    expect(host.querySelector('[data-shared-doc-panel]')?.textContent).toContain(file.name)
    expect(host.querySelector('main')?.dataset.documentOpen).toBe('true')

    await act(async () => cardButtons()[1].click())
    expect(openDoc).toHaveBeenCalledWith(cwd, file.path)
    expect(invoke).not.toHaveBeenCalledWith('extras:chatFile:open', expect.anything())
  })

  it('un PowerPoint del proyecto ofrece Presentar y comunica el rechazo sin abrir otra ruta', async () => {
    file = { ...file, path: '/proyecto/Charla.pptx', name: 'Charla.pptx' }
    info = { ...info, ...file }
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'extras:presentPptx') throw new Error('No se pudo representar la lámina 2.')
      return undefined
    })
    render()
    await flush()
    const present = cardButtons().find((button) => button.textContent === 'Presentar')!
    expect(present).toBeTruthy()
    await act(async () => present.click())
    await flush()
    expect(invoke).toHaveBeenCalledWith('extras:presentPptx', { path: file.path })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('lámina 2')
    expect(openDoc).not.toHaveBeenCalled()
  })

  it('renderizar muestra la copia editada sin una llamada previa a crear', async () => {
    render([tool('documentos_documentos_renderizar', { ruta: file.name, carpeta: cwd }, 'Vista previa: 1 página(s).')])
    await flush()
    expect(docInfo).toHaveBeenCalledWith(cwd, [file.path])
    expect(cardButtons().map((b) => b.textContent)).toEqual(['Ver', 'Abrir', 'Mostrar en la carpeta'])
  })

  it.each(['running', 'error', 'completed'])('no muestra documento por un resultado sin éxito (%s)', async (status) => {
    render([tool('documentos_renderizar', { ruta: file.path }, 'No hay vista previa disponible.', status)])
    await flush()
    expect(docInfo).not.toHaveBeenCalled()
    expect(cardButtons()).toEqual([])
  })

  it('los candidatos ordinarios esperan al final del turno', async () => {
    const ps = [tool('write', { filePath: file.path }, '')]
    render(ps)
    await flush()
    expect(docInfo).not.toHaveBeenCalled()
    render(ps, true)
    await flush()
    expect(docInfo).toHaveBeenCalledWith(cwd, [file.path])
  })

  it('si main rechaza una ruta arbitraria no crea tarjeta ni invoca el visor', async () => {
    docInfo.mockResolvedValue([])
    render([tool('documentos_crear', {}, 'Documento creado: /fuera/secreto.pdf (1 KB).')])
    await flush()
    expect(docInfo).toHaveBeenCalledWith(cwd, ['/fuera/secreto.pdf'])
    expect(cardButtons()).toEqual([])
    expect(invoke).not.toHaveBeenCalledWith('extras:chatFile:info', expect.anything())
    expect(invoke).not.toHaveBeenCalledWith('extras:chatFile:viewNative', expect.anything())
  })

  it('si la ruta deja de ser válida después de mostrar la tarjeta, Ver no la abre', async () => {
    render()
    await flush()
    docInfo.mockResolvedValue([])
    await act(async () => cardButtons()[0].click())
    await flush()
    expect(invoke).not.toHaveBeenCalledWith('extras:chatFile:info', expect.anything())
    expect(host.querySelector('[data-code-doc-panel]')).toBeNull()
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
  })

  it('si la validación del Chat no permite ver, no abre el panel', async () => {
    info.canView = false
    render()
    await flush()
    await act(async () => cardButtons()[0].click())
    await flush()
    expect(invoke).not.toHaveBeenCalledWith('extras:chatFile:viewNative', expect.anything())
    expect(host.querySelector('[data-code-doc-panel]')).toBeNull()
  })

  it('sin docViewer ofrece solo Abrir y conserva la apertura validada del sistema', async () => {
    surface('win32', false)
    render()
    await flush()
    expect(cardButtons().map((b) => b.textContent)).toEqual(['Ver', 'Abrir', 'Mostrar en la carpeta'])
    await act(async () => cardButtons()[1].click())
    expect(openDoc).toHaveBeenCalledWith(cwd, file.path)
  })

  it('un formato que el visor no soporta solo ofrece Abrir', async () => {
    file = { ...file, name: 'Libro.xlsm', path: '/proyecto/Libro.xlsm' }
    render()
    await flush()
    expect(cardButtons().map((b) => b.textContent)).toEqual(['Abrir', 'Mostrar en la carpeta'])
  })

  it('la superficie remota conserva la restricción actual de archivos locales', async () => {
    surface('remote')
    render()
    await flush()
    expect(docInfo).not.toHaveBeenCalled()
    expect(cardButtons()).toEqual([])
  })

  it('muestra los botones en inglés por el sistema de traducciones', async () => {
    applyLangPref('en')
    render()
    await flush()
    expect(cardButtons().map((b) => b.textContent)).toEqual(['View', 'Open', 'Show in folder'])
  })

  it('un fallo de Abrir se comunica sin intentar abrir una ruta distinta', async () => {
    openDoc.mockRejectedValue(new Error('rechazado'))
    render()
    await flush()
    await act(async () => cardButtons()[1].click())
    expect(cardButtons()[1].textContent).toBe('No se pudo abrir')
    expect(openDoc).toHaveBeenCalledTimes(1)
  })

  it('ignora una validación tardía al cambiar de candidatos/proyecto', async () => {
    let finish!: (files: DocFileInfo[]) => void
    docInfo.mockReturnValueOnce(
      new Promise<DocFileInfo[]>((resolve) => {
        finish = resolve
      })
    )
    render()
    await flush()
    cwd = '/otro'
    render([])
    await act(async () => finish([file]))
    await flush()
    expect(cardButtons()).toEqual([])
  })

  it('cerrar, cambiar de sesión y desmontar cierran el visor compartido', async () => {
    render()
    await flush()
    await act(async () => cardButtons()[0].click())
    await flush()
    act(() => host.querySelector<HTMLButtonElement>('[data-shared-doc-panel] button')!.click())
    expect(host.querySelector('[data-code-doc-panel]')).toBeNull()
    expect(invoke).toHaveBeenCalledWith('extras:chatDoc:close', { sessionId: 'code-1' })

    await act(async () => cardButtons()[0].click())
    await flush()
    render(parts(), false, 'code-2')
    await flush()
    expect(host.querySelector('[data-code-doc-panel]')).toBeNull()
    act(() => root.render(null))
    expect(invoke).toHaveBeenCalledWith('extras:chatDoc:close', { sessionId: 'code-2' })
    expect(canViewChatFileHere()).toBe(false)
  })

  it('un clic en Ver pendiente no abre el documento después de abandonar su tarjeta', async () => {
    render()
    await flush()
    let finish!: (files: DocFileInfo[]) => void
    docInfo.mockReturnValueOnce(
      new Promise<DocFileInfo[]>((resolve) => {
        finish = resolve
      })
    )
    act(() => cardButtons()[0].click())
    render([], false, 'code-2')
    await act(async () => finish([file]))
    await flush()
    expect(invoke).not.toHaveBeenCalledWith('extras:chatFile:viewNative', expect.anything())
    expect(host.querySelector('[data-code-doc-panel]')).toBeNull()
  })

  it('el panel angosto se superpone; pantalla completa oculta el contenido y se puede cerrar', async () => {
    render(parts(), false, 'code-1', 700)
    await flush()
    await act(async () => cardButtons()[0].click())
    await flush()
    expect(host.querySelector('[data-code-doc-panel]')?.className).toContain('absolute')
    act(() => host.querySelectorAll<HTMLButtonElement>('[data-shared-doc-panel] button')[1].click())
    expect(host.querySelector('[data-code-doc-panel]')?.className).toContain('w-full')
    expect(host.querySelector('main')?.parentElement?.className).toContain('hidden')
  })
})
