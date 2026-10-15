/**
 * Handlers IPC de extras (`extras:*`, `mcp:*`). Registrar en main con:
 *   registerExtrasHandlers(ipcMain, { server, createMainWindow, getMainWindow })
 * Además inicializa atajo global de Quick Entry y bandeja (idempotente).
 */
import { app, shell, type IpcMain } from 'electron'
import { stat } from 'node:fs/promises'
import { release } from 'node:os'
import { join } from 'node:path'
import type { IpcExtrasInvokeContract } from '@shared/ipc-extras'
import type { OpencodeServer } from '../opencode/server'
import { broadcastExtras, getPrefsState, initExtras } from '../extras'
import { downloadHtmlAsPdf, openArtifact, presentSlides } from '../extras/artifact-window'
import { downloadSlidesAsPptx } from '../extras/slides-deck-export'
import { VoiceWorkerHost, voiceWorkerScriptPath } from '../extras/voice-worker-host'
import {
  ChatDocError,
  cleanChatDocuments,
  downloadChatDoc,
  generateChatDoc,
  writeChatDocForExternal,
  type ChatDocInput
} from '../extras/chat-docs'
import { recordCraftProblem } from '../office/craft/craft-problems'
import { defaultFindDeps, guiNextToCli, openExternally } from '../office/craft/open-external'
import { craftService } from '../office/craft/service'
import { onWebEvent } from '../office/craft/web-view'
import { describeError, recordProblem } from '../diagnostics/problem-log'
import { openInCraftWeb, panelAttach, panelClose, useClassicViewer } from '../office/craft/web-open'
import { catalogState, CatalogProvenanceStore, installFromCatalog } from '../extras/mcp-catalog-install'
import {
  ensureAppOpencodeConfig,
  maskAppMcpConfig,
  readAppMcpConfig,
  removeMcpServer,
  saveMcpServer,
  setMcpServerEnabled
} from '../extras/mcp-config'
import { extrasPrefs } from '../extras/prefs'
import {
  deliverQuickPrompt,
  hideQuickEntry,
  registerQuickEntryShortcut,
  takePendingPrompt,
  toggleQuickEntry,
  unregisterQuickEntryShortcut
} from '../extras/quick-entry'
import type { MainWindowDeps } from '../extras/windows'
import { installViewerScheme } from '../viewer/scheme'
import { onViewerEvent, openDoc } from '../viewer/view'
import { VIEWER_SCHEME } from '../security/app-protocol'
import { makeInvokeHandler } from './handle'
import { windowOfSender } from './sender-window'

export interface ExtrasDeps extends MainWindowDeps {
  server: OpencodeServer
}

const handle = makeInvokeHandler<IpcExtrasInvokeContract>({ withCode: false })

/**
 * Recarga la config del sidecar sin reiniciar el proceso (`POST /global/dispose`).
 * Verificado: tras editar el archivo de OPENCODE_CONFIG, `/mcp` refleja los cambios.
 */
async function reloadOpencodeConfig(server: OpencodeServer): Promise<void> {
  const conn = server.getConnection()
  if (!conn) return
  try {
    const res = await fetch(`${conn.baseUrl}/global/dispose`, {
      method: 'POST',
      headers: { authorization: conn.authorization },
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) console.warn(`[extras] /global/dispose respondió ${res.status}`)
  } catch (err) {
    console.warn('[extras] no se pudo recargar la config de OpenCode:', err)
  }
}

export function registerExtrasHandlers(ipcMain: IpcMain, deps: ExtrasDeps): void {
  ensureAppOpencodeConfig()

  // Dictado por voz (F8-B144): proceso APARTE (utilityProcess), nunca en main directo — ONNX Runtime
  // ya tiró un crash nativo real acá (confirmado con el reporte de crash del sistema) que se llevó
  // toda la app; aislado, lo peor que pasa es que esa transcripción puntual falla con un mensaje.
  const voiceWorker = new VoiceWorkerHost(voiceWorkerScriptPath)
  voiceWorker.setProgressListener((progress) => broadcastExtras('extras:voiceModelProgress', progress))
  app.on('before-quit', () => voiceWorker.dispose())

  handle(ipcMain, 'extras:getPrefs', () => getPrefsState())
  handle(ipcMain, 'extras:setPrefs', (patch) => {
    extrasPrefs.set(patch ?? {})
    return getPrefsState()
  })
  handle(ipcMain, 'extras:versions', () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    osRelease: release()
  }))
  handle(ipcMain, 'extras:openArtifact', (payload) => {
    if (!payload || typeof payload.html !== 'string') throw new Error('Vista previa sin HTML')
    openArtifact({ title: String(payload.title ?? ''), html: payload.html })
  })
  handle(ipcMain, 'extras:downloadHtmlAsPdf', (payload, event) => {
    if (!payload || typeof payload.html !== 'string') throw new Error('Vista previa sin HTML')
    return downloadHtmlAsPdf({ title: String(payload.title ?? ''), html: payload.html }, windowOfSender(event.sender))
  })
  handle(ipcMain, 'extras:downloadSlidesAsPptx', (payload, event) => {
    if (!payload || typeof payload.html !== 'string') throw new Error('Vista previa sin HTML')
    return downloadSlidesAsPptx({ title: String(payload.title ?? ''), html: payload.html }, windowOfSender(event.sender))
  })
  handle(ipcMain, 'extras:presentSlides', (payload) => {
    if (!payload || typeof payload.html !== 'string') throw new Error('Vista previa sin HTML')
    presentSlides({ title: String(payload.title ?? ''), html: payload.html })
  })
  handle(ipcMain, 'extras:transcribeAudio', (payload) => voiceWorker.transcribe(payload.samples))
  // Panel de documento de Chat: MISMA vista nativa que Tareas (un solo modo visible a la vez, sin conflicto).
  onViewerEvent((event) => broadcastExtras('extras:chatDoc:event', event))
  onWebEvent((event) => broadcastExtras('extras:chatDoc:event', event))
  handle(ipcMain, 'extras:chatDoc:open', async (req) => {
    try {
      const { title, sessionId, lang, theme } = req
      let input: ChatDocInput
      if (req.kind === 'pdf') input = { kind: 'pdf', html: req.html }
      else if (req.kind === 'xlsx') input = { kind: 'xlsx', data: req.data }
      else if (req.kind === 'docx') input = { kind: 'docx', data: req.data }
      else input = { kind: 'pptx', data: req.data }
      const doc = await generateChatDoc(input, title, sessionId)
      // Con el programa de ArtCraft instalado, el panel muestra su versión WEB (misma pantalla y motor que el programa de escritorio);
      // si no está o falla, el visor de siempre.
      // Peso real del archivo generado; si no se puede leer, simplemente no se informa.
      const bytes = await stat(doc.file)
        .then((s) => s.size)
        .catch(() => undefined)
      if (await openInCraftWeb(input.kind, doc.file, title)) return { ok: true, bytes }
      installViewerScheme()
      openDoc(`${VIEWER_SCHEME}://viewer/index.html#t=${doc.token}&kind=${doc.kind}&lang=${lang}&theme=${theme}`)
      useClassicViewer()
      return { ok: true, bytes }
    } catch (e) {
      console.warn('[chat-doc] no se pudo generar el documento:', e instanceof Error ? e.message : e)
      // Queda en el registro de problemas (Ajustes › Diagnóstico) con el tipo de documento y el motivo, ya redactado por el registro.
      // Falta de ArtCraft (esperable, aún no instalado): origen `craft` en aviso; el resto (generación, JSON inválido): origen `document`.
      const kind = req?.kind ?? 'desconocido'
      if (e instanceof ChatDocError && e.code === 'no-craft') {
        recordCraftProblem('documento', e, { tipo: kind }, { level: craftService().status().state === 'missing' ? 'warn' : 'error' })
      } else {
        const why = describeError(e)
        recordProblem({
          source: 'document',
          level: 'warn',
          message: `no se pudo abrir un documento de Chat (${kind}): ${why.message}`,
          stack: why.stack,
          detail: { tipo: kind }
        })
      }
      if (e instanceof ChatDocError) return { ok: false, reason: e.code, detail: e.message }
      return { ok: false, reason: 'failed' }
    }
  })
  handle(ipcMain, 'extras:chatDoc:attach', ({ rect, visible }, event) => {
    const win = windowOfSender(event.sender) ?? deps.getMainWindow?.() ?? null
    if (win) panelAttach(win, rect, visible)
  })
  handle(ipcMain, 'extras:chatDoc:close', ({ sessionId }) => {
    panelClose()
    void cleanChatDocuments(sessionId)
  })
  const installedCli = (kind: ChatDocInput['kind']): string | null => {
    const st = craftService().status()
    if (st.state !== 'installed' || kind === 'pdf') return null
    return st.bins[{ pptx: 'deckcraft', docx: 'wordcraft', xlsx: 'gridcraft' }[kind] as 'deckcraft'] ?? null
  }
  handle(ipcMain, 'extras:chatDoc:openExternal', async (req) => {
    try {
      const input: ChatDocInput =
        req.kind === 'pdf'
          ? { kind: 'pdf', html: req.html }
          : req.kind === 'xlsx'
            ? { kind: 'xlsx', data: req.data }
            : req.kind === 'docx'
              ? { kind: 'docx', data: req.data }
              : { kind: 'pptx', data: req.data }
      const file = await writeChatDocForExternal(input, req.title)
      return {
        ok: true as const,
        via: await openExternally(input.kind, file, (p) => shell.openPath(p), defaultFindDeps(guiNextToCli(installedCli(input.kind))))
      }
    } catch (e) {
      console.warn('[chat-doc] no se pudo abrir aparte:', e instanceof Error ? e.message : e)
      recordCraftProblem('apertura externa', e, { tipo: req.kind })
      return { ok: false as const }
    }
  })
  handle(ipcMain, 'extras:downloadChatDoc', (req, event) => {
    const input: ChatDocInput =
      req.kind === 'xlsx'
        ? { kind: 'xlsx', data: req.data }
        : req.kind === 'docx'
          ? { kind: 'docx', data: req.data }
          : { kind: 'pptx', data: req.data }
    return downloadChatDoc(input, req.title, windowOfSender(event.sender))
  })
  handle(ipcMain, 'extras:quickSubmit', (req) => {
    if (!req || typeof req.text !== 'string') throw new Error('Prompt inválido')
    deliverQuickPrompt(deps, { text: req.text })
  })
  handle(ipcMain, 'extras:quickHide', () => hideQuickEntry())
  handle(ipcMain, 'extras:quickToggle', () => toggleQuickEntry())
  handle(ipcMain, 'extras:suspendShortcut', ({ suspended }) => {
    if (suspended) unregisterQuickEntryShortcut()
    else registerQuickEntryShortcut(extrasPrefs.get().quickEntryShortcut)
  })
  handle(ipcMain, 'extras:takePendingPrompt', () => takePendingPrompt())

  const afterMcpChange = async (): Promise<ReturnType<typeof readAppMcpConfig>> => {
    // Al renderer SIEMPRE valores enmascarados (F8-B69): los secretos no salen de main.
    const cfg = maskAppMcpConfig(readAppMcpConfig())
    await reloadOpencodeConfig(deps.server)
    broadcastExtras('mcp:changed', cfg)
    return cfg
  }

  const provenance = new CatalogProvenanceStore(join(app.getPath('userData'), 'mcp-catalog-installs.json'))

  handle(ipcMain, 'mcp:getConfig', () => maskAppMcpConfig(readAppMcpConfig()))
  handle(ipcMain, 'mcp:save', async ({ name, entry, previousName }) => {
    saveMcpServer(name, entry, previousName)
    if (previousName && previousName !== name) provenance.rename(previousName, name)
    return afterMcpChange()
  })
  handle(ipcMain, 'mcp:remove', async ({ name }) => {
    removeMcpServer(name) // también limpia su «Preguntar antes de cada uso»
    provenance.forget(name)
    return afterMcpChange()
  })
  handle(ipcMain, 'mcp:catalog', () => catalogState(provenance.read(), readAppMcpConfig()))
  handle(ipcMain, 'mcp:installCatalog', async (req) => {
    installFromCatalog(provenance, req)
    return afterMcpChange()
  })
  handle(ipcMain, 'mcp:setEnabled', async ({ name, enabled }) => {
    setMcpServerEnabled(name, enabled)
    return afterMcpChange()
  })
  handle(ipcMain, 'mcp:revealConfig', () => {
    shell.showItemInFolder(ensureAppOpencodeConfig())
  })

  initExtras(deps)
}
