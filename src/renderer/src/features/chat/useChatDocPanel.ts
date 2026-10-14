/**
 * Como los Artifacts de Claude: cuando el agente de Chat termina un turno cuya última respuesta
 * trae un bloque ```html/```xlsx/```pptx, el panel de documento se abre SOLO (mismo visor nativo
 * que usa Tareas), sin que la persona tenga que apretar nada. Los botones de "vista previa"/
 * "descargar" del bloque siguen ahí por si quiere volver a verlo o descargarlo aparte.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getLang } from '@shared/i18n'
import type { ChatDocOpenRequest } from '@shared/ipc-extras'
import { extractChatDocBlocks, parseDataBlock, type ChatDocBlock } from '../../lib/chatDocBlocks'
import { getExtras } from '../../lib/extrasApi'
import { setChatDocPreviewHandler, setCreatingDoc, type ChatDocBlockKind } from '../../lib/chatDocPreview'
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
  /** Por qué no se pudo generar el documento (el panel sigue abierto para mostrarlo); `null` si no hay fallo. */
  notice: ChatDocNotice
  /** Vuelve a generar el documento actual (p. ej. tras instalar ArtCraft). */
  retry: () => void
  toggleFullscreen: () => void
  close: () => void
}

export type ChatDocNotice = null | 'failed' | 'craft-missing'

export function useChatDocPanel(sessionId: string | null, entries: MessageEntry[]): ChatDocPanelState {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [title, setTitle] = useState('')
  const [notice, setNotice] = useState<ChatDocNotice>(null)
  const [doc, setDoc] = useState<{ kind: ChatDocBlockKind; rawText: string; isSlides: boolean } | null>(null)
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
    setNotice(null)
    setDoc(null)
    setCreatingDoc(null)
  }

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
  const openDoc = useCallback((kind: ChatDocBlockKind, rawText: string, title: string, isSlides = false): void => {
    if (!platformCaps().docViewer) return
    const sid = sessionRef.current
    const extras = getExtras()
    if (!sid || !extras) return

    const common = { title, sessionId: sid, lang: getLang(), theme: currentTheme() } as const
    let req: ChatDocOpenRequest | null = null
    if (kind === 'html') {
      req = { ...common, kind: 'pdf', html: rawText }
    } else {
      // Misma lectura que el resto de botones (JSON tolerante + deslices comunes del modelo corregidos + esquema estricto).
      const parsed = parseDataBlock(kind, rawText)
      if (parsed) req = { ...common, kind, data: parsed } as ChatDocOpenRequest
    }
    if (!req) return

    lastRawTextRef.current = rawText
    setOpen(true)
    setCreating(true)
    setNotice(null)
    setTitle(title)
    setDoc({ kind, rawText, isSlides })
    setCreatingDoc({ kind, rawText, title })
    void extras
      .invoke('extras:chatDoc:open', req)
      .then((res) => {
        setCreating(false)
        setCreatingDoc(null)
        // El panel SE QUEDA abierto con el motivo (antes se cerraba sin decir nada).
        if (!res.ok) setNotice(res.reason === 'craft-missing' ? 'craft-missing' : 'failed')
      })
      .catch(() => {
        setCreating(false)
        setCreatingDoc(null)
        setNotice('failed')
      })
  }, [])

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
    if (!block || block.rawText === lastRawTextRef.current) return
    openDoc(block.kind, block.rawText, block.title, block.kind === 'html' && block.isSlides)
  }, [entries, sessionId, openDoc])

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

  return { open, creating, fullscreen, title, doc, notice, retry, toggleFullscreen, close: () => close(sessionRef.current) }
}
