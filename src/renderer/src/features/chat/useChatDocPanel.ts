/**
 * Como los Artifacts de Claude: cuando el agente de Chat termina un turno cuya última respuesta
 * trae un bloque ```html/```xlsx/```pptx, el panel de documento se abre SOLO (mismo visor nativo
 * que usa Tareas), sin que la persona tenga que apretar nada. Los botones de "vista previa"/
 * "descargar" del bloque siguen ahí por si quiere volver a verlo o descargarlo aparte.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getLang } from '@shared/i18n'
import type { ChatDocOpenRequest } from '@shared/ipc-extras'
import {
  extractBrokenDocBlocks,
  extractChatDocBlocks,
  parseDataBlockDetailed,
  type BrokenDocBlock,
  type ChatDocBlock
} from '../../lib/chatDocBlocks'
import { getExtras } from '../../lib/extrasApi'
import { recordChatDocSize } from '../../lib/chatDocSize'
import { setChatDocAskHandler, setChatDocPreviewHandler, setCreatingDoc, type ChatDocBlockKind } from '../../lib/chatDocPreview'
import { docProblemMessage, reportDocProblem } from '../../lib/report-problems'
import { sendChatMessage } from './actions'
import type { DocProblemReason } from '../../components/artifacts/DocNotice'
import { platformCaps } from '../../lib/platform'
import type { MessageEntry } from '../../stores/sessions'

function currentTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

/**
 * El bloque de documento del último mensaje de la conversación (si lo hay). A propósito NO busca
 * más atrás si el último mensaje es del usuario: eso significa que el agente todavía no respondió a
 * lo último que pidieron, así que no hay nada NUEVO que mostrar — mostrar un artifact viejo de más
 * atrás confundiría (pareceria que respondió a la pregunta nueva).
 */
export function lastDocBlock(entries: MessageEntry[]): ChatDocBlock | null {
  const last = entries[entries.length - 1]
  if (!last || last.info.role !== 'assistant') return null
  const text = last.parts
    .map((p) => (p.type === 'text' ? p.text : ''))
    .filter(Boolean)
    .join('\n')
  const blocks = extractChatDocBlocks(text)
  return blocks.length > 0 ? blocks[blocks.length - 1] : null
}

/**
 * El último bloque de datos CERRADO pero inválido del último mensaje del agente (si no hay uno válido que mostrar), para avisar en vez
 * de ignorarlo en silencio.
 */
export function lastBrokenBlock(entries: MessageEntry[]): BrokenDocBlock | null {
  const last = entries[entries.length - 1]
  if (!last || last.info.role !== 'assistant') return null
  const text = last.parts
    .map((p) => (p.type === 'text' ? p.text : ''))
    .filter(Boolean)
    .join('\n')
  const broken = extractBrokenDocBlocks(text)
  return broken.length > 0 ? broken[broken.length - 1] : null
}

/** Por qué el panel no pudo mostrar el documento (se muestra un aviso con «Reintentar»/«Ver detalle» en vez de cerrarlo). */
export interface ChatDocProblem {
  reason: Exclude<DocProblemReason, 'cut'>
  /** Motivo corto ya apto para mostrar (solo textos propios de la app). */
  detail?: string
}

export interface ChatDocPanelState {
  open: boolean
  /** El panel ya está abierto pero el archivo (PDF/Excel/PowerPoint) todavía no terminó de generarse. */
  creating: boolean
  fullscreen: boolean
  /** Título del documento actual (para el header del panel), vacío si no hay ninguno abierto. */
  title: string
  /** Lo que hace falta para el botón de descarga del header; `null` si no hay ninguno abierto.
   * `isSlides` (solo relevante para `kind:'html'`) decide si además se ofrece el botón de descarga
   * "PowerPoint (para proyectar)". */
  doc: { kind: ChatDocBlockKind; rawText: string; isSlides: boolean } | null
  /** El documento no se pudo abrir: el panel muestra el motivo y un botón en vez de cerrarse. */
  problem: ChatDocProblem | null
  /** Vuelve a intentar abrir el mismo documento (fallos de generación). */
  retry: () => void
  toggleFullscreen: () => void
  close: () => void
}

export function useChatDocPanel(sessionId: string | null, entries: MessageEntry[]): ChatDocPanelState {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [title, setTitle] = useState('')
  const [doc, setDoc] = useState<{ kind: ChatDocBlockKind; rawText: string; isSlides: boolean } | null>(null)
  const [problem, setProblem] = useState<ChatDocProblem | null>(null)
  const lastRawTextRef = useRef<string | null>(null)
  const sessionRef = useRef(sessionId)

  // OJO: no resetea `lastRawTextRef` — si se resetea, un `entries` que llega tarde (un evento que
  // todavía estaba en camino, o al reconectar) hace que el efecto de abajo lo vea como "nuevo" y
  // reabra SOLO el mismo documento que la persona acaba de cerrar a mano. Al volver a pedirlo (texto
  // distinto) el `rawText !== lastRawTextRef.current` ya detecta el cambio igual, sin necesitar el reseteo.
  const close = (closingSessionId: string | null): void => {
    const extras = getExtras()
    if (extras && closingSessionId) void extras.invoke('extras:chatDoc:close', { sessionId: closingSessionId }).catch(() => undefined)
    setOpen(false)
    setCreating(false)
    setFullscreen(false)
    setTitle('')
    setDoc(null)
    setProblem(null)
    setCreatingDoc(null)
  }

  /** Muestra el aviso de fallo en el panel (lo deja abierto). Cierra la vista nativa de main: se pintaría POR ENCIMA del aviso. */
  const showProblem = useCallback((kind: ChatDocBlockKind, rawText: string, title: string, isSlides: boolean, p: ChatDocProblem): void => {
    const extras = getExtras()
    const sid = sessionRef.current
    if (extras && sid) void extras.invoke('extras:chatDoc:close', { sessionId: sid }).catch(() => undefined)
    lastRawTextRef.current = rawText
    setOpen(true)
    setCreating(false)
    setTitle(title)
    setDoc({ kind, rawText, isSlides })
    setProblem(p)
    setCreatingDoc(null)
  }, [])

  // Abre el documento en el panel de la sesión ACTUAL (vía la ref: nunca una versión vieja de
  // sessionId). Usado tanto por la auto-apertura al terminar el turno como por "Abrir vista previa"
  // de un bloque ya en el historial (ver `chatDocPreview.ts`): ambos deben ir al mismo panel. El
  // panel se muestra (`open`) YA, con un estado de "generando" (`creating`): el texto del chat
  // aparece completo apenas el modelo termina de escribir, pero el archivo todavía tarda un poco en
  // generarse — sin esto, el dueño veía el chat diciendo que ya estaba listo mientras el panel ni
  // siquiera se había abierto. Mismo cap que Tareas (`platformCaps().docViewer`, atado a `tasksWin`
  // hasta pasar la batería de seguridad de Windows — ver `shared/platform-caps.ts`): sin esto, en una
  // plataforma donde el visor nativo no está habilitado, no hay que intentar abrirlo — los botones de
  // vista previa/descarga de cada bloque siguen funcionando igual, sin depender de este cap.
  const openDoc = useCallback(
    (kind: ChatDocBlockKind, rawText: string, title: string, isSlides = false): void => {
      if (!platformCaps().docViewer) return
      const sid = sessionRef.current
      const extras = getExtras()
      if (!sid || !extras) return

      const common = { title, sessionId: sid, lang: getLang(), theme: currentTheme() } as const
      let req: ChatDocOpenRequest | null = null
      if (kind === 'html') {
        req = { ...common, kind: 'pdf', html: rawText }
      } else {
        // Misma lectura que el resto de botones (JSON tolerante + limpieza de forma + esquema estricto).
        const parsed = parseDataBlockDetailed(kind, rawText)
        if (parsed.ok) req = { ...common, kind, data: parsed.data } as ChatDocOpenRequest
        else {
          reportDocProblem(rawText, docProblemMessage(kind, parsed.reason))
          showProblem(kind, rawText, title, isSlides, { reason: parsed.reason })
          return
        }
      }

      lastRawTextRef.current = rawText
      setProblem(null)
      setOpen(true)
      setCreating(true)
      setTitle(title)
      setDoc({ kind, rawText, isSlides })
      setCreatingDoc({ kind, rawText, title })
      void extras
        .invoke('extras:chatDoc:open', req)
        .then((res) => {
          setCreating(false)
          setCreatingDoc(null)
          // Antes se cerraba el panel sin decir nada; main ya anotó el motivo en el registro de problemas.
          if (!res.ok) showProblem(kind, rawText, title, isSlides, { reason: res.reason, detail: res.detail })
          else recordChatDocSize(kind, rawText, res.bytes)
        })
        .catch((err: unknown) => {
          setCreating(false)
          setCreatingDoc(null)
          reportDocProblem(rawText, `no se pudo abrir un documento de Chat (${kind}): ${err instanceof Error ? err.message : String(err)}`)
          showProblem(kind, rawText, title, isSlides, { reason: 'failed' })
        })
    },
    [showProblem]
  )

  const retry = useCallback((): void => {
    if (doc) openDoc(doc.kind, doc.rawText, title, doc.isSlides)
  }, [doc, title, openDoc])

  const toggleFullscreen = useCallback((): void => setFullscreen((v) => !v), [])

  // Cambiar de sesión de chat: cerrar el documento (si había uno) de la sesión anterior.
  useEffect(() => {
    if (sessionRef.current && sessionRef.current !== sessionId) close(sessionRef.current)
    sessionRef.current = sessionId
  }, [sessionId])

  // A propósito NO espera a que `busy` pase a `idle`: el texto (y el bloque, ya cerrado) puede estar
  // completo varios segundos antes de que el turno termine de verdad del lado del servidor (el
  // modelo sigue "pensando"/el servidor no cerró el turno todavía) — esperar a ese momento hacía que
  // la persona ya hubiera visto y reconocido el renglón normal mucho antes de que se marcara como
  // "generando", así que nunca llegaba a ver el spinner. En cuanto `lastDocBlock` encuentra un
  // bloque NUEVO (la valla ya cerrada, nunca uno a medio escribir), se marca al toque, esté busy o
  // no — como Claude, que abre el artifact apenas está listo, sin esperar a que termine la respuesta.
  useEffect(() => {
    if (!sessionId) return
    const block = lastDocBlock(entries)
    if (!block) {
      // Sin documento válido: si el agente escribió uno cerrado pero roto, se avisa (antes se ignoraba en silencio).
      const broken = lastBrokenBlock(entries)
      if (broken && broken.rawText !== lastRawTextRef.current) openDoc(broken.kind, broken.rawText, '', false)
      return
    }
    if (block.rawText === lastRawTextRef.current) return
    openDoc(block.kind, block.rawText, block.title, block.kind === 'html' && block.isSlides)
  }, [entries, sessionId, openDoc])

  // Los avisos de documento («Pedir de nuevo», «Pedir que continúe») mandan su mensaje a la conversación abierta.
  useEffect(() => {
    setChatDocAskHandler((text) => void sendChatMessage(text).catch(() => undefined))
    return () => setChatDocAskHandler(null)
  }, [])

  // Mientras el chat está montado, "Abrir vista previa" (en cualquier bloque de cualquier mensaje)
  // reusa este panel en vez de abrir una ventana aparte. `openDoc` lee sessionRef.current en cada
  // llamada, así que registrar la versión del montaje alcanza: nunca queda con un sessionId viejo.
  // Sin `docViewer` (ver arriba) no se registra nada: así un bloque ```html cae solo en su ventana
  // aislada de siempre, en vez de llamar a un `openDoc` que no haría nada.
  useEffect(() => {
    if (!platformCaps().docViewer) return
    setChatDocPreviewHandler(openDoc)
    return () => setChatDocPreviewHandler(null)
  }, [openDoc])

  // Si se cambia de modo (Tareas, Code…) con el panel abierto, `ChatView` entera se desmonta — sin
  // esto, la vista nativa (vive en main, fuera del árbol de React) se quedaba pegada encima de
  // cualquier otro modo, sin forma de cerrarla (mismo cierre que al apretar la X, ver `DocumentViewerPanel.tsx`
  // de Tareas, que ya hacía esto al desmontarse).
  useEffect(() => {
    return () => close(sessionRef.current)
  }, [])

  // Esc dentro del documento (la vista nativa lo reenvía como evento, nadie más en Chat lo escuchaba)
  // sale de pantalla completa, igual que el botón.
  useEffect(() => {
    const extras = getExtras()
    if (!extras) return
    return extras.on('extras:chatDoc:event', (ev) => {
      if (ev.type === 'escape') setFullscreen(false)
    })
  }, [])

  return { open, creating, fullscreen, title, doc, problem, retry, toggleFullscreen, close: () => close(sessionRef.current) }
}
