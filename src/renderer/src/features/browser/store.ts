/**
 * Lógica pura del navegador integrado (detección URL/búsqueda, resaltado de host, armado de
 * tarjetas) más un store de UI mínimo (Zustand) para las aprobaciones pendientes y el aviso de
 * primer uso. No importa nada de Code ni de Tareas: solo tipos de `@shared/ipc-browser`.
 */
import { create } from 'zustand'
import { t as tr } from '@shared/i18n'
import type { BrowserApprovalRequest, BrowserOwner, BrowserToChat } from '@shared/ipc-browser'

/** Clave estable para agrupar estado por dueño (carpeta de Code o de Tareas). */
export function ownerKey(owner: BrowserOwner): string {
  return owner.kind === 'code' ? `code:${owner.directory}` : `tasks:${owner.folder}`
}

export function sameOwner(a: BrowserOwner, b: BrowserOwner): boolean {
  return ownerKey(a) === ownerKey(b)
}

// ---------------------------------------------------------------------------
// Barra de URL: ¿es una dirección o una búsqueda? (decisión: Google por defecto)
// ---------------------------------------------------------------------------

const HOSTNAME_LIKE = /^[\w-]+(\.[\w-]+)+(:\d{1,5})?(\/.*)?$/i
const LOCALHOST_LIKE = /^localhost(:\d{1,5})?(\/.*)?$/i
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

/** ¿`input` parece una URL (con o sin esquema) en vez de una consulta de búsqueda? */
export function isLikelyUrl(input: string): boolean {
  const v = input.trim()
  if (!v) return false
  if (HAS_SCHEME.test(v)) return true
  if (/\s/.test(v)) return false
  if (LOCALHOST_LIKE.test(v)) return true
  if (HOSTNAME_LIKE.test(v)) return true
  return false
}

export function googleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`
}

/** Normaliza lo escrito en la barra a algo navegable: le agrega esquema o busca en Google. */
export function toNavigationInput(raw: string): string {
  const v = raw.trim()
  if (!v) return v
  if (!isLikelyUrl(v)) return googleSearchUrl(v)
  return HAS_SCHEME.test(v) ? v : `https://${v}`
}

/** Host de una URL, o `null` si no se puede interpretar. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}

/** Separa una URL en {prefijo, host, sufijo} para resaltar el host en la barra. */
export function splitHostForDisplay(url: string): { prefix: string; host: string; suffix: string } | null {
  const host = hostOf(url)
  if (!host) return null
  const idx = url.indexOf(host)
  if (idx < 0) return null
  return { prefix: url.slice(0, idx), host, suffix: url.slice(idx + host.length) }
}

// ---------------------------------------------------------------------------
// Tarjetas de aprobación (B.8): armado a los 700 ms, contra clickjacking.
// ---------------------------------------------------------------------------

export const CARD_ARM_DELAY_MS = 700

/** ¿Ya deben estar armados los botones, dado el tiempo transcurrido desde que apareció la tarjeta? */
export function isCardArmed(elapsedMs: number): boolean {
  return elapsedMs >= CARD_ARM_DELAY_MS
}

/** Milisegundos que faltan para armar la tarjeta (0 si ya está armada). */
export function armRemainingMs(createdAt: number, now: number): number {
  return Math.max(0, CARD_ARM_DELAY_MS - (now - createdAt))
}

/** Texto simple/de tres botones según el tipo de tarjeta (B.8). */
export function approvalButtons(kind: BrowserApprovalRequest['kind']): 'simple' | 'site' {
  return kind === 'sensitive' || kind === 'download' ? 'simple' : 'site'
}

// ---------------------------------------------------------------------------
// "Añadir al chat": formato de texto compartido entre Code y Tareas.
// ---------------------------------------------------------------------------

export function formatPageChatText(title: string, url: string): string {
  const t = title.trim() || url
  return `${tr('browser.chat.page')} ${t} — ${url}`
}

export function formatElementChatText(el: { tag: string; role?: string; name?: string; url: string }): string {
  const bits = [el.tag]
  if (el.role) bits.push(`[${el.role}]`)
  const label = bits.join(' ')
  return el.name ? `${tr('browser.chat.element')} ${label} "${el.name}" — ${el.url}` : `${tr('browser.chat.element')} ${label} — ${el.url}`
}

// ---------------------------------------------------------------------------
// Store de UI (Zustand): cola de aprobaciones por dueño + aviso de primer uso.
// ---------------------------------------------------------------------------

const LS_FIRST_RUN = 'browser.firstRunSeen'

function readFirstRunSeen(): boolean {
  try {
    return localStorage.getItem(LS_FIRST_RUN) === '1'
  } catch {
    return false
  }
}

interface BrowserUiState {
  /** Aprobaciones pendientes, por `ownerKey`. */
  approvals: Record<string, BrowserApprovalRequest[]>
  pushApproval: (req: BrowserApprovalRequest) => void
  removeApproval: (owner: BrowserOwner, id: string) => void
  /** Igual que `removeApproval`, pero sin conocer el dueño (p. ej. `browser:approvalDone` no lo trae). */
  removeApprovalById: (id: string) => void
  firstRunSeen: boolean
  markFirstRunSeen: () => void
}

export const useBrowserUi = create<BrowserUiState>((set) => ({
  approvals: {},
  pushApproval: (req) =>
    set((s) => {
      const key = ownerKey(req.owner)
      const list = s.approvals[key] ?? []
      if (list.some((a) => a.id === req.id)) return s
      return { approvals: { ...s.approvals, [key]: [...list, req] } }
    }),
  removeApproval: (owner, id) =>
    set((s) => {
      const key = ownerKey(owner)
      const list = s.approvals[key]
      if (!list) return s
      return { approvals: { ...s.approvals, [key]: list.filter((a) => a.id !== id) } }
    }),
  removeApprovalById: (id) =>
    set((s) => {
      const next: Record<string, BrowserApprovalRequest[]> = {}
      let changed = false
      for (const [key, list] of Object.entries(s.approvals)) {
        if (list.some((a) => a.id === id)) {
          next[key] = list.filter((a) => a.id !== id)
          changed = true
        } else {
          next[key] = list
        }
      }
      return changed ? { approvals: next } : s
    }),
  firstRunSeen: readFirstRunSeen(),
  markFirstRunSeen: () => {
    try {
      localStorage.setItem(LS_FIRST_RUN, '1')
    } catch {
      // ignorar
    }
    set({ firstRunSeen: true })
  }
}))

/** Aprobaciones pendientes de un dueño concreto (selector estable para `useBrowserUi`). */
export function approvalsFor(
  state: { approvals: Record<string, BrowserApprovalRequest[]> },
  owner: BrowserOwner
): BrowserApprovalRequest[] {
  return state.approvals[ownerKey(owner)] ?? []
}

export type { BrowserToChat }
