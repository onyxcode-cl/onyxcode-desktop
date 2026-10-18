/**
 * Handlers IPC de extras (`extras:*`, `mcp:*`). Registrar en main con:
 *   registerExtrasHandlers(ipcMain, { server, createMainWindow, getMainWindow })
 * Además inicializa atajo global de Quick Entry y bandeja (idempotente).
 */
import { app, dialog, shell, type IpcMain } from 'electron'
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { release } from 'node:os'
import { basename, join } from 'node:path'
import { t } from '@shared/i18n'
import type { IpcExtrasInvokeContract } from '@shared/ipc-extras'
import type { OpencodeServer } from '../opencode/server'
import { broadcastExtras, getPrefsState, initExtras } from '../extras'
import { downloadHtmlAsPdf, openArtifact, presentSlides } from '../extras/artifact-window'
import { exportConversation } from '../extras/export-conversation'
import { downloadSlidesAsPptx } from '../extras/slides-deck-export'
import { VoiceWorkerHost, voiceWorkerScriptPath } from '../extras/voice-worker-host'
import {
  ChatDocError,
  assertInsideChatDocs,
  chatDocsRoot,
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
import {
  catalogState,
  CatalogProvenanceStore,
  installFromCatalog,
  installLocalFromCatalog,
  removeLocalFromCatalog
} from '../extras/mcp-catalog-install'
import { defaultRunner, findExecutable, stageClientFileFromDisk, type LocalDeps, type StagedClient } from '../extras/local-connectors'
import { LOCK_FILE_TEXT } from '../extras/local-connector-files'
import { findLocalItem } from '@shared/mcp-catalog'
import {
  ensureAppOpencodeConfig,
  maskAppMcpConfig,
  readAppMcpConfig,
  removeMcpServer,
  saveMcpServer,
  setMcpServerEnabled
} from '../extras/mcp-config'
import { createImportService } from '../extras/import-service'
import { extrasPrefs } from '../extras/prefs'
import { PersonalizacionStore } from '../personalizacion/store'
import { createSkillsService } from '../personalizacion/skills-service'
import { getBundledOpencodeDir, getOpencodeConfigDir } from '../tasks/opencode-config'
import { assertInstructionsFolder } from './tasks-memory-handlers'
import { getAgentsMd, saveAgentsMd } from '../tasks/projects'
import {
  deliverQuickPrompt,
  hideQuickEntry,
  registerQuickEntryShortcut,
  takePendingPrompt,
  toggleQuickEntry,
  unregisterQuickEntryShortcut
} from '../extras/quick-entry'
import type { MainWindowDeps } from '../extras/windows'
import { settingsStore } from '../store'
import { galleryTypeOf } from '../files/gallery-index'
import { KNOWLEDGE_EXTS } from '@shared/project-knowledge'
import { ProjectStore } from '../projects/store'
import { createProjectsService } from '../projects/service'
import { galleryRecordChat, galleryThumbFor, getGallery, configureGalleryChat } from '../files/gallery-runtime'
import { assertNativeViewable, assertOpenable, assertRevealable, chatFilesInfo, readChatFile, resolveChatFile } from '../files/chat-files'
import { issueToken } from '../viewer/tokens'
import { MAX_BYTES, sniffDocKind } from '../viewer/doc-kind'
import { installViewerScheme, registerViewerPathValidator } from '../viewer/scheme'
import { onViewerEvent, openDoc } from '../viewer/view'
import { VIEWER_SCHEME } from '../security/app-protocol'
import { makeInvokeHandler } from './handle'
import { windowOfSender } from './sender-window'

export interface ExtrasDeps extends MainWindowDeps {
  server: OpencodeServer
  /** Carpeta de trabajo del Chat (userData/chat-workspace): una de las carpetas desde las que se pueden ver/abrir archivos. */
  chatDirectory?: string
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
  // «Descargar/Guardar»: el archivo elegido por la persona se anota en la galería (solo ese archivo, no su carpeta).
  const recordSaved = (path: string | null, title: string): string | null => {
    if (path) galleryRecordChat(path, { exact: true, title: title.trim() || undefined })
    return path
  }
  handle(ipcMain, 'extras:downloadHtmlAsPdf', async (payload, event) => {
    if (!payload || typeof payload.html !== 'string') throw new Error('Vista previa sin HTML')
    const title = String(payload.title ?? '')
    return recordSaved(await downloadHtmlAsPdf({ title, html: payload.html }, windowOfSender(event.sender)), title)
  })
  handle(ipcMain, 'extras:downloadSlidesAsPptx', async (payload, event) => {
    if (!payload || typeof payload.html !== 'string') throw new Error('Vista previa sin HTML')
    const title = String(payload.title ?? '')
    return recordSaved(await downloadSlidesAsPptx({ title, html: payload.html }, windowOfSender(event.sender)), title)
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
      galleryRecordChat(doc.file, { session: sessionId, title: title.trim() || undefined })
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
      galleryRecordChat(file, { title: req.title.trim() || undefined })
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
  // Archivos que la IA crea o menciona en el Chat. Carpetas permitidas: la del chat, la de documentos generados y los proyectos
  // recientes (nunca una ruta cualquiera que escriba el modelo); la validación completa vive en `files/chat-files.ts`.
  const chatFileRoots = (): string[] => [
    ...(deps.chatDirectory ? [deps.chatDirectory] : []),
    chatDocsRoot(),
    ...settingsStore.get().recentFolders
  ]
  // Galería: sus archivos de Overdrive (carpetas autorizadas) y los guardados con «Descargar» se suman como ámbito de las acciones.
  configureGalleryChat({
    chatRoots: chatFileRoots,
    scanDirs: () => [...(deps.chatDirectory ? [deps.chatDirectory] : []), join(chatDocsRoot(), 'abiertos')]
  })
  const allFileRoots = (): string[] => [...chatFileRoots(), ...getGallery().extraRoots()]
  let chatFileValidatorRegistered = false
  handle(ipcMain, 'extras:chatFile:info', ({ paths }) => chatFilesInfo(allFileRoots(), paths))
  handle(ipcMain, 'extras:chatFile:read', ({ path }) => readChatFile(allFileRoots(), path))
  handle(ipcMain, 'extras:chatFile:viewNative', async ({ path, lang, theme }) => {
    try {
      const real = assertNativeViewable(allFileRoots(), path)
      if (!chatFileValidatorRegistered) {
        chatFileValidatorRegistered = true
        // El visor revalida al SERVIR los bytes: la ruta debe seguir dentro de las carpetas permitidas (o ser un documento propio de Chat).
        registerViewerPathValidator((p) => {
          try {
            return assertInsideChatDocs(p)
          } catch {
            return resolveChatFile(allFileRoots(), p).path
          }
        })
      }
      installViewerScheme()
      const head = Buffer.alloc(8)
      const fd = openSync(real, 'r')
      try {
        readSync(fd, head, 0, 8, 0)
      } finally {
        closeSync(fd)
      }
      const kind = sniffDocKind(real, head)
      if (!kind) return { ok: false as const, reason: 'unsupported' as const }
      if (statSync(real).size > MAX_BYTES[kind]) return { ok: false as const, reason: 'too-large' as const }
      const token = issueToken({ path: real, kind })
      const title =
        real
          .split(/[\\/]/)
          .pop()
          ?.replace(/\.[^.]+$/, '') ?? 'documento'
      if (await openInCraftWeb(kind, real, title)) return { ok: true as const }
      openDoc(`${VIEWER_SCHEME}://viewer/index.html#t=${token}&kind=${kind}&lang=${lang}&theme=${theme}`)
      useClassicViewer()
      return { ok: true as const }
    } catch (e) {
      console.warn('[chat-file] no se pudo mostrar el archivo:', e instanceof Error ? e.message : e)
      return { ok: false as const, reason: 'failed' as const }
    }
  })
  handle(ipcMain, 'extras:chatFile:open', async ({ path }) => {
    const err = await shell.openPath(assertOpenable(allFileRoots(), path))
    if (err) throw new Error(err)
  })
  handle(ipcMain, 'extras:chatFile:reveal', ({ path }) => {
    shell.showItemInFolder(assertRevealable(allFileRoots(), path))
  })
  handle(ipcMain, 'extras:gallery:list', () => getGallery().list())
  handle(ipcMain, 'extras:gallery:thumb', ({ path }) => {
    try {
      const g = getGallery()
      const info = g.resolve(path)
      const entry = galleryTypeOf(info.path)
      return entry ? galleryThumbFor(info, entry) : { kind: 'none' as const }
    } catch {
      return { kind: 'none' as const }
    }
  })
  handle(ipcMain, 'extras:gallery:remove', ({ path }) => getGallery().remove(path))
  handle(ipcMain, 'extras:downloadChatDoc', async (req, event) => {
    const input: ChatDocInput =
      req.kind === 'xlsx'
        ? { kind: 'xlsx', data: req.data }
        : req.kind === 'docx'
          ? { kind: 'docx', data: req.data }
          : { kind: 'pptx', data: req.data }
    return recordSaved(await downloadChatDoc(input, req.title, windowOfSender(event.sender)), req.title)
  })
  handle(ipcMain, 'extras:exportConversation', (req, event) => exportConversation(req, windowOfSender(event.sender)))
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

  // Importar de otras herramientas: el renderer solo pide «elegir» (diálogo nativo en main) y luego confirma por ficha.
  const importService = createImportService({
    pickPath: async (source) => {
      const win = deps.getMainWindow?.() ?? null
      const options: Electron.OpenDialogOptions =
        source === 'project-folder'
          ? { title: t('import.dialog.folder'), properties: ['openDirectory'] }
          : {
              title: t('import.dialog.file'),
              properties: ['openFile', 'showHiddenFiles'],
              filters: [{ name: 'JSON', extensions: ['json', 'jsonc'] }]
            }
      const res = win && !win.isDestroyed() ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      return res.canceled ? null : (res.filePaths[0] ?? null)
    },
    validateFolder: (folder) => assertInstructionsFolder(folder),
    existingMcpNames: () => new Set(Object.keys(readAppMcpConfig().servers)),
    readAgents: (folder) => getAgentsMd(folder),
    saveAgents: (folder, content) => void saveAgentsMd(folder, content),
    saveMcp: (name, entry) => void saveMcpServer(name, entry),
    maskedMcp: () => maskAppMcpConfig(readAppMcpConfig()),
    afterMcpChange
  })
  handle(ipcMain, 'extras:import:pick', (req) => importService.pick(req))
  handle(ipcMain, 'extras:import:apply', (req) => importService.apply(req))

  // Personalización › Habilidades: la carpeta la elige la persona en el diálogo nativo (main); el renderer solo confirma por ficha.
  const skills = createSkillsService({
    store: new PersonalizacionStore(join(app.getPath('userData'), 'personalizacion.json')),
    skillsDir: () => join(getOpencodeConfigDir(), 'skills'),
    bundledDir: () => join(getBundledOpencodeDir(), 'skills'),
    pickFolder: async () => {
      const win = deps.getMainWindow?.() ?? null
      const options: Electron.OpenDialogOptions = { title: t('pers.skill.dialog'), properties: ['openDirectory'] }
      const res = win && !win.isDestroyed() ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      return res.canceled ? null : (res.filePaths[0] ?? null)
    },
    afterChange: () => reloadOpencodeConfig(deps.server)
  })

  // Proyectos del Chat (F8-B185): archivos de conocimiento con búsqueda local. Los elige la persona en el diálogo nativo (main) o los arrastra
  // (bytes); main los lee, los copia al almacén del proyecto y los indexa. Nada sale del equipo salvo los pasajes que van al modelo.
  const projects = createProjectsService({
    store: new ProjectStore(join(app.getPath('userData'), 'projects')),
    pickFiles: async () => {
      const win = deps.getMainWindow?.() ?? null
      const options: Electron.OpenDialogOptions = {
        title: t('projects.dialog.title'),
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: t('projects.dialog.filter'), extensions: [...KNOWLEDGE_EXTS] },
          { name: t('projects.dialog.all'), extensions: ['*'] }
        ]
      }
      const res = win && !win.isDestroyed() ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      return res.canceled ? [] : res.filePaths
    }
  })
  handle(ipcMain, 'projects:list', () => projects.state())
  handle(ipcMain, 'projects:create', (req) => projects.create(req))
  handle(ipcMain, 'projects:update', (req) => projects.update(req))
  handle(ipcMain, 'projects:delete', (req) => projects.remove(req))
  handle(ipcMain, 'projects:pickFiles', (req) => projects.pickFiles(req))
  handle(ipcMain, 'projects:addPicked', (req) => projects.addPicked(req))
  handle(ipcMain, 'projects:addBytes', (req) => projects.addBytes(req))
  handle(ipcMain, 'projects:removeFile', (req) => projects.removeFile(req))
  handle(ipcMain, 'projects:assign', (req) => projects.assign(req))
  handle(ipcMain, 'projects:context', (req) => projects.context(req))

  handle(ipcMain, 'personalizacion:skills:list', () => skills.list())
  handle(ipcMain, 'personalizacion:skills:setEnabled', (req) => skills.setEnabled(req))
  handle(ipcMain, 'personalizacion:skills:pick', () => skills.pick())
  handle(ipcMain, 'personalizacion:skills:install', (req) => skills.install(req))
  handle(ipcMain, 'personalizacion:skills:remove', (req) => skills.remove(req))

  handle(ipcMain, 'mcp:getConfig', () => maskAppMcpConfig(readAppMcpConfig()))
  // Conectores LOCALES del catálogo (F8-B186): carpeta propia, instalación fijada y archivo del cliente elegido en un diálogo.
  const localDeps = (): LocalDeps => ({
    baseDir: join(app.getPath('userData'), 'conectores-locales'),
    platform: process.platform,
    files: LOCK_FILE_TEXT,
    run: defaultRunner,
    find: (name) => findExecutable(name),
    now: () => Date.now()
  })
  const stagedClients = new Map<string, StagedClient>()

  handle(ipcMain, 'mcp:save', async ({ name, entry, previousName }) => {
    // Un conector local del catálogo se gestiona solo desde Personalización: editar su programa o sus argumentos quitaría el «solo consulta».
    if (provenance.isLocal(previousName ?? name) || provenance.isLocal(name)) throw new Error(t('merr.local.noEdit'))
    saveMcpServer(name, entry, previousName)
    if (previousName && previousName !== name) provenance.rename(previousName, name)
    return afterMcpChange()
  })
  handle(ipcMain, 'mcp:remove', async ({ name }) => {
    if (provenance.isLocal(name)) {
      // Local: quita el servidor y sus reglas, recarga el motor (el programa deja de correr) y BORRA su carpeta entera.
      await removeLocalFromCatalog(provenance, localDeps().baseDir, name, async () => void (await reloadOpencodeConfig(deps.server)))
      return afterMcpChange()
    }
    removeMcpServer(name) // también limpia su «Preguntar antes de cada uso»
    provenance.forget(name)
    return afterMcpChange()
  })
  handle(ipcMain, 'mcp:catalog', () => catalogState(provenance.read(), readAppMcpConfig(), localDeps()))
  handle(ipcMain, 'mcp:localPickClient', async ({ id }) => {
    const item = findLocalItem(id)
    if (!item?.runtime.clientFile) throw new Error(t('merr.mcp.notInCatalog'))
    const win = deps.getMainWindow?.() ?? null
    const options: Electron.OpenDialogOptions = {
      title: t('pers.local.pickTitle'),
      properties: ['openFile', 'showHiddenFiles'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const res = win && !win.isDestroyed() ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const file = res.canceled ? null : (res.filePaths[0] ?? null)
    if (!file) return null
    const staged = stageClientFileFromDisk(file, Date.now())
    stagedClients.set(id, staged)
    return { fileName: basename(file), hint: staged.hint }
  })
  handle(ipcMain, 'mcp:installLocal', async ({ id, name, askEachUse }) => {
    const client = stagedClients.get(id) ?? null
    await installLocalFromCatalog(provenance, localDeps(), { id, name, askEachUse }, client)
    stagedClients.delete(id) // de un solo uso: el secreto del cliente ya está solo en la carpeta del conector
    return afterMcpChange()
  })
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
