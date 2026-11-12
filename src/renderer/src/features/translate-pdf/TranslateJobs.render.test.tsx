// @vitest-environment jsdom
/** Tarjetas de traducción dentro de la conversación: progreso, resultado con botones, versión limpia y error. */
import { act, createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { click, mount, type Mounted } from '../../../../test/dom-render'

const call = vi.fn(async () => ({ saved: true, opened: true }))
vi.mock('../../lib/api', () => ({ call: (...a: unknown[]) => (call as (...x: unknown[]) => unknown)(...a) }))
vi.mock('../../lib/announce', () => ({ announce: vi.fn() }))
vi.mock('../../stores/server', () => ({ useServer: { getState: () => ({ connection: { chatDirectory: '/x' } }) } }))
vi.mock('../code/impl/pr/pr-ai', () => ({ askModel: vi.fn() }))
vi.mock('./model-info', () => ({ chatModelSeesImages: () => false }))
vi.mock('../chat/actions', () => ({ sendChatMessage: vi.fn() }))

import { TranslateJobs } from './TranslateJobs'
import { useTranslateJobs, type TranslateJob } from './jobs'
import { useChatDocPanel } from '../chat/useChatDocPanel'
import { setChatFileViewHandler } from '../../lib/chatFileView'
import { applyLangPref } from '../../lib/i18n'
import type { ChatFileInfo } from '@shared/ipc-extras'

function ChatWithJobs(): React.JSX.Element {
  const panel = useChatDocPanel(null, [])
  return (
    <>
      <TranslateJobs />
      {panel.open && (
        <aside data-doc-panel data-status={panel.file?.status}>
          {panel.title}
        </aside>
      )}
    </>
  )
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const invoke = vi.fn()
let info: ChatFileInfo
function preview(platform = 'darwin'): void {
  const path = platform === 'win32' ? 'C:\\Temp\\chat-docs\\poliza (es).pdf' : '/tmp/chat-docs/poliza (es).pdf'
  info = { path, name: 'poliza (es).pdf', bytes: 1024, kind: 'office', canView: true, canOpen: true }
  const job = done(false)
  if (job.state.kind === 'done') job.state.outcome.viewPath = path
  useTranslateJobs.setState({ jobs: [job] })
  Object.assign(window, { api: { platform, capsFlags: { tasksWin: false }, extras: { invoke, on: () => () => undefined } } })
  invoke.mockImplementation(async (channel: string) => (channel === 'extras:chatFile:info' ? [info] : { ok: true }))
}

const button = (label: string): HTMLButtonElement | undefined => m?.qa<HTMLButtonElement>('button').find((b) => b.textContent === label)

const preset = { name: 'poliza.pdf', base64: 'AAAA', target: 'es' as const }
const report = { translated: 71, untranslated: 0, shrunk: 3, overflow: [], linksDropped: 0 }
const done = (clean: boolean): TranslateJob => ({
  id: 'j1',
  preset,
  state: {
    kind: 'done',
    saved: false,
    outcome: {
      jobId: 'aaaaaaaaaaaaaaaa',
      outName: 'poliza (es).pdf',
      report,
      pages: 5,
      pagesWithoutText: [],
      failedSegments: 0,
      ...(clean ? { cleanOutName: 'poliza (es, limpio).pdf' } : {})
    }
  }
})

let m: Mounted | null = null
beforeEach(() => {
  call.mockClear()
  invoke.mockReset()
  applyLangPref('es')
  document.documentElement.dataset.theme = 'light'
})
afterEach(() => {
  m?.unmount()
  m = null
  useTranslateJobs.setState({ jobs: [] })
  setChatFileViewHandler(null)
  delete (window as unknown as { api?: unknown }).api
  delete document.documentElement.dataset.theme
  applyLangPref('es')
})

describe('TranslateJobs', () => {
  it.each(['darwin', 'win32'])('«Ver» usa el panel del Chat y los canales existentes en %s (Tareas apagadas)', async (platform) => {
    preview(platform)
    m = mount(createElement(ChatWithJobs))
    expect(button('Ver')).toBeDefined()
    expect(invoke).not.toHaveBeenCalledWith('extras:chatFile:viewNative', expect.anything())
    click(button('Ver')!)
    await flush()
    expect(invoke).toHaveBeenCalledWith('extras:chatFile:info', { paths: [info.path] })
    expect(invoke).toHaveBeenCalledWith('extras:chatFile:viewNative', { path: info.path, lang: 'es', theme: 'light' })
    expect(m.q('[data-doc-panel]')?.textContent).toBe(info.name)
    expect(m.q('[data-doc-panel]')?.getAttribute('data-status')).toBe('ready')
    expect(call).not.toHaveBeenCalled()
    click(button('Abrir')!)
    click(button('Guardar como…')!)
    await flush()
    expect(call).toHaveBeenCalledWith('translate:pdfOpen', { jobId: 'aaaaaaaaaaaaaaaa' })
    expect(call).toHaveBeenCalledWith('translate:pdfSave', { jobId: 'aaaaaaaaaaaaaaaa' })
  })

  it('traduce «Ver» y el aviso de fallo al inglés', async () => {
    preview()
    applyLangPref('en')
    m = mount(createElement(TranslateJobs))
    click(button('View')!)
    await flush()
    expect(m.q('[role="alert"]')?.textContent).toBe('The file could not be shown here. Try opening it with your app.')
  })

  it.each(['linux', 'remote'])('sin visor (%s) conserva Abrir y Guardar sin ofrecer Ver', (platform) => {
    preview(platform)
    m = mount(createElement(TranslateJobs))
    expect(button('Ver')).toBeUndefined()
    expect(button('Abrir')).toBeDefined()
    expect(button('Guardar como…')).toBeDefined()
    expect(invoke).not.toHaveBeenCalled()
  })

  it.each(['missing', 'blocked', 'wrong-path', 'rejected'])('no abre un archivo cuya validación falla: %s', async (failure) => {
    preview()
    if (failure === 'missing') invoke.mockResolvedValueOnce([])
    if (failure === 'blocked') invoke.mockResolvedValueOnce([{ ...info, canView: false }])
    if (failure === 'wrong-path') invoke.mockResolvedValueOnce([{ ...info, path: '/otro.pdf' }])
    if (failure === 'rejected') invoke.mockRejectedValueOnce(new Error('invalid path'))
    m = mount(createElement(ChatWithJobs))
    click(button('Ver')!)
    await flush()
    expect(invoke).not.toHaveBeenCalledWith('extras:chatFile:viewNative', expect.anything())
    expect(m.q('[role="alert"]')).not.toBeNull()
  })

  it('no abre el panel si la tarjeta se quita mientras se valida la ruta', async () => {
    preview()
    let resolve!: (value: ChatFileInfo[]) => void
    invoke.mockImplementationOnce(
      () =>
        new Promise<ChatFileInfo[]>((r) => {
          resolve = r
        })
    )
    m = mount(createElement(ChatWithJobs))
    click(button('Ver')!)
    click(m.q('button[aria-label="Quitar"]'))
    await act(async () => resolve([info]))
    expect(invoke).not.toHaveBeenCalledWith('extras:chatFile:viewNative', expect.anything())
  })

  it('sin trabajos no pinta nada', () => {
    m = mount(createElement(TranslateJobs))
    expect(m.q('[data-testid="translate-jobs"]')).toBeNull()
  })

  it('en curso muestra el avance y «Cancelar»', () => {
    useTranslateJobs.setState({
      jobs: [{ id: 'j1', preset, state: { kind: 'running', progress: { phase: 'translating', done: 2, total: 6 } } }]
    })
    m = mount(createElement(TranslateJobs))
    const card = m.q('[data-testid="translate-job"]')!
    expect(card.getAttribute('data-state')).toBe('running')
    expect(card.textContent).toContain('poliza.pdf')
    expect(card.textContent).toContain('lote 3 de 6')
    expect(card.textContent).toContain('Cancelar')
  })

  it('terminado muestra Abrir y Guardar, y la versión limpia solo si existe', () => {
    useTranslateJobs.setState({ jobs: [done(true)] })
    m = mount(createElement(TranslateJobs))
    const card = m.q('[data-testid="translate-job"]')!
    expect(card.textContent).toContain('71 textos traducidos en 5 páginas')
    expect(card.textContent).toContain('poliza (es, limpio).pdf')
    const buttons = [...card.querySelectorAll('button')]
    const open = buttons.find((b) => b.textContent === 'Abrir')!
    click(open)
    expect(call).toHaveBeenCalledWith('translate:pdfOpen', { jobId: 'aaaaaaaaaaaaaaaa' })
    click(buttons.find((b) => b.textContent === 'Abrir versión limpia')!)
    expect(call).toHaveBeenCalledWith('translate:pdfOpen', { jobId: 'aaaaaaaaaaaaaaaa', clean: true })
  })

  it('sin versión limpia no hay botones de versión limpia; quitar la tarjeta la saca', () => {
    useTranslateJobs.setState({ jobs: [done(false)] })
    m = mount(createElement(TranslateJobs))
    const card = m.q('[data-testid="translate-job"]')!
    expect(card.textContent).not.toContain('versión limpia')
    expect(button('Ver')).toBeUndefined() // resultado sin copia de vista previa
    click(card.querySelector('button[aria-label="Quitar"]')!)
    expect(useTranslateJobs.getState().jobs).toHaveLength(0)
  })

  it('un error muestra el motivo y «Reintentar» (salvo si se canceló)', () => {
    useTranslateJobs.setState({ jobs: [{ id: 'j1', preset, state: { kind: 'error', reason: 'encrypted' } }] })
    m = mount(createElement(TranslateJobs))
    const card = m.q('[data-testid="translate-job"]')!
    expect(card.textContent).toContain('contraseña')
    expect(card.textContent).toContain('Reintentar')
  })
})
