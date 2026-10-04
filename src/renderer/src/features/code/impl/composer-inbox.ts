/**
 * Bandeja de entrada del Composer de Code: recibe los eventos `browser:toChat` (botón "Añadir al
 * chat") y `browser:picked` ("Seleccionar elemento") del navegador integrado compartido
 * (`features/browser`) y los traduce en algo que el Composer pueda insertar — el mismo tipo
 * `Attachment` que ya usa para imágenes pegadas/arrastradas (`Composer.tsx`).
 */
import { onBrowser } from '../../browser/bridge'
import { makeElementAttachment, type ElementAttachment } from '../../browser/element-context'
import type { Attachment } from './types'

export interface ComposerInboxItem {
  text: string
  attachment?: Attachment
  /** Elemento elegido en el navegador: va como chip (no como texto) y se serializa al enviar. */
  element?: ElementAttachment
}

type Listener = (item: ComposerInboxItem) => void

const listeners = new Map<string, Set<Listener>>()

function notify(directory: string, item: ComposerInboxItem): void {
  const set = listeners.get(directory)
  if (!set || set.size === 0) return
  for (const fn of set) fn(item)
}

let attSeq = 0
function imageAttachment(image?: { name: string; mime: 'image/jpeg'; dataUrl: string }): Attachment | undefined {
  if (!image) return undefined
  attSeq += 1
  return { id: `att-browser-${Date.now()}-${attSeq}`, name: image.name, mime: image.mime, url: image.dataUrl }
}

let started = false
function ensureStarted(): void {
  if (started) return
  started = true
  onBrowser('browser:toChat', (payload) => {
    if (payload.owner.kind !== 'code') return
    notify(payload.owner.directory, { text: payload.text, attachment: imageAttachment(payload.image) })
  })
  onBrowser('browser:picked', (payload) => {
    if (payload.owner.kind !== 'code') return
    notify(payload.owner.directory, { text: '', element: makeElementAttachment(payload.element) })
  })
}

/**
 * Se suscribe a la bandeja de un proyecto (`directory`). El Composer de Code la usa para
 * insertar el texto ("Página: {título} — {url}") y adjuntar la imagen si la hay, o para añadir el chip del elemento elegido.
 */
export function subscribeComposerInbox(directory: string, onItem: Listener): () => void {
  ensureStarted()
  let set = listeners.get(directory)
  if (!set) {
    set = new Set()
    listeners.set(directory, set)
  }
  set.add(onItem)
  return () => {
    set?.delete(onItem)
  }
}
