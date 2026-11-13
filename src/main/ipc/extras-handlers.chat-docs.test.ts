/** Handlers y almacenamiento reales; Electron, visor y motores falsos, sin abrir la app. */
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { IpcExtrasInvokeContract } from '@shared/ipc-extras'
import type { ExtrasDeps } from './extras-handlers'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (request: never, event: IpcMainInvokeEvent) => unknown
const mock = vi.hoisted(() => ({
  temp: '',
  handlers: new Map<string, Handler>(),
  render: vi.fn(),
  save: vi.fn(),
  pdf: vi.fn(),
  web: vi.fn(),
  openDoc: vi.fn(),
  classic: vi.fn(),
  gallery: vi.fn()
}))
vi.mock('electron', () => ({ app: { getPath: () => mock.temp, on: vi.fn() }, dialog: { showSaveDialog: mock.save }, shell: {} }))
vi.mock('./handle', () => ({
  makeInvokeHandler: () => (_ipc: unknown, channel: string, handler: Handler) => mock.handlers.set(channel, handler)
}))
vi.mock('./sender-window', () => ({ windowOfSender: () => null }))
vi.mock('../extras/artifact-window', () => ({ safeDocumentName: (title: string) => title }))
vi.mock('../documents/engine', () => ({
  DOC_EXT: { pdf: 'pdf', docx: 'docx', xlsx: 'xlsx', pptx: 'pptx' },
  renderBytes: mock.render,
  craftBinary: () => 'craft',
  ChatDocError: class extends Error {}
}))
vi.mock('../office/craft/chat-word', () => ({ docxToPdf: mock.pdf }))
vi.mock('../office/craft/chat-grid', () => ({ gridToPdf: mock.pdf }))
vi.mock('../office/craft/chat-deck', () => ({ deckToPdf: mock.pdf }))
vi.mock('../office/craft/web-open', () => ({ openInCraftWeb: mock.web, useClassicViewer: mock.classic }))
vi.mock('../office/craft/web-view', () => ({ onWebEvent: vi.fn() }))
vi.mock('../viewer/scheme', () => ({ registerViewerPathValidator: vi.fn(), installViewerScheme: vi.fn() }))
vi.mock('../viewer/view', () => ({ onViewerEvent: vi.fn(), openDoc: mock.openDoc }))
vi.mock('../security/app-protocol', () => ({ VIEWER_SCHEME: 'lazunox-viewer' }))
vi.mock('../files/gallery-runtime', () => ({ galleryRecordChat: mock.gallery, configureGalleryChat: vi.fn() }))
vi.mock('../extras', () => ({ initExtras: vi.fn() }))
vi.mock('../extras/voice-worker-host', () => ({
  voiceWorkerScriptPath: 'unused',
  VoiceWorkerHost: class {
    setProgressListener = vi.fn()
  }
}))
vi.mock('../extras/mcp-config', () => ({ ensureAppOpencodeConfig: vi.fn() }))
vi.mock('../extras/mcp-catalog-install', () => ({ CatalogProvenanceStore: class {} }))
vi.mock('../extras/import-service', () => ({ createImportService: () => ({}) }))
vi.mock('../personalizacion/store', () => ({ PersonalizacionStore: class {} }))
vi.mock('../personalizacion/skills-service', () => ({ createSkillsService: () => ({}) }))
vi.mock('../projects/store', () => ({ ProjectStore: class {} }))
vi.mock('../projects/service', () => ({ createProjectsService: () => ({}) }))
vi.mock('../extras/export-conversation', () => ({}))
vi.mock('../extras/slides-deck-export', () => ({}))
vi.mock('../office/craft/craft-problems', () => ({}))
vi.mock('../office/craft/open-external', () => ({}))
vi.mock('../office/craft/service', () => ({}))
vi.mock('../diagnostics/problem-log', () => ({}))
vi.mock('../runtimes/service', () => ({}))
vi.mock('../extras/local-connectors', () => ({}))
vi.mock('../extras/prefs', () => ({}))
vi.mock('../tasks/opencode-config', () => ({}))
vi.mock('./tasks-memory-handlers', () => ({}))
vi.mock('../tasks/projects', () => ({}))
vi.mock('../extras/quick-entry', () => ({}))
vi.mock('../store', () => ({}))
vi.mock('../files/gallery-index', () => ({}))
vi.mock('../files/chat-files', () => ({}))

const invoke = <C extends keyof IpcExtrasInvokeContract>(channel: C, request: IpcExtrasInvokeContract[C]['req']) =>
  mock.handlers.get(channel)!(request as never, { sender: {} } as IpcMainInvokeEvent)
const office = [
  { kind: 'docx' as const, data: { title: 'Informe', blocks: [{ type: 'paragraph' as const, text: 'Breve.' }] } },
  { kind: 'xlsx' as const, data: { sheets: [{ name: 'Datos', rows: [[1]] }] } },
  { kind: 'pptx' as const, data: { slides: [{ title: 'Informe' }] } }
]
const common = { title: 'Informe', sessionId: 'session', lang: 'es' as const, theme: 'light' as const }

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  mock.handlers.clear()
  mock.temp = mkdtempSync(join(tmpdir(), 'lzx-chat-handlers-'))
  mock.render.mockResolvedValue(Buffer.from('%PDF-original'))
  mock.save.mockResolvedValue({ canceled: false, filePath: join(mock.temp, 'descarga.pdf') })
  mock.pdf.mockImplementation(async (_cli: string, _source: string, out: string) => {
    writeFileSync(out, '%PDF-respaldo')
    return out
  })
  mock.web.mockResolvedValue(true)
  const { registerExtrasHandlers } = await import('./extras-handlers')
  registerExtrasHandlers({} as IpcMain, { server: {}, getMainWindow: () => null } as unknown as ExtrasDeps)
})
afterEach(() => rmSync(mock.temp, { recursive: true, force: true }))

describe('documentos de Chat: ruta real del handler', () => {
  it.each(office)('$kind: vista web correcta evita el PDF de respaldo', async (input) => {
    const result = await invoke('extras:chatDoc:open', { ...common, ...input })
    expect(result).toEqual({ ok: true, bytes: 13 })
    expect(mock.web).toHaveBeenCalledWith(input.kind, expect.stringContaining(`.${input.kind}`), 'Informe')
    expect(mock.pdf).not.toHaveBeenCalled()
    expect(mock.openDoc).not.toHaveBeenCalled()
    expect(mock.classic).not.toHaveBeenCalled()
  })

  it.each(office)('$kind: solo si falla la vista web convierte y muestra el PDF', async (input) => {
    mock.web.mockResolvedValue(false)
    expect(await invoke('extras:chatDoc:open', { ...common, ...input })).toEqual({ ok: true, bytes: 13 })
    expect(mock.pdf).toHaveBeenCalledTimes(1)
    expect(mock.web.mock.invocationCallOrder[0]).toBeLessThan(mock.pdf.mock.invocationCallOrder[0])
    expect(mock.openDoc).toHaveBeenCalledWith(expect.stringContaining('&kind=pdf&lang=es&theme=light'))
    expect(mock.classic).toHaveBeenCalledTimes(1)
  })

  it('descargar HTML como PDF reutiliza lo generado al abrir y mantiene el diálogo PDF', async () => {
    const html = '<p>Prueba de descarga PDF por IPC.</p>'
    mock.web.mockResolvedValue(false)
    await invoke('extras:chatDoc:open', { ...common, kind: 'pdf', html })
    const originalFile = mock.gallery.mock.calls[0][0] as string
    const saved = await invoke('extras:downloadHtmlAsPdf', { title: common.title, html })
    expect(mock.render).toHaveBeenCalledTimes(1)
    expect(readFileSync(saved as string)).toEqual(readFileSync(originalFile))
    expect(mock.pdf).not.toHaveBeenCalled()
    expect(mock.save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Guardar como PDF',
        defaultPath: join(mock.temp, 'Informe.pdf'),
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
    )
  })
})
