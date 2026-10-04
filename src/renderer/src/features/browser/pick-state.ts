/**
 * Qué dueños tienen el modo «Seleccionar elemento» activo (lo escribe `BrowserPanel` al recibir `browser:state`).
 * Permite que quien envía un mensaje (compositor de Code o de Tareas) apague la selección sin conocer la pestaña.
 */
import type { BrowserOwner } from '@shared/ipc-browser'
import { br } from './bridge'
import { ownerKey } from './store'

const active = new Map<string, { owner: BrowserOwner; tabId: string }>()

export function setPickState(owner: BrowserOwner, tabId: string | null): void {
  const key = ownerKey(owner)
  if (tabId) active.set(key, { owner, tabId })
  else active.delete(key)
}

export function isPicking(owner: BrowserOwner): boolean {
  return active.has(ownerKey(owner))
}

/** Apaga la selección de ese dueño (no hace nada si no estaba activa). Nunca lanza. */
export function stopPicking(owner: BrowserOwner): void {
  const cur = active.get(ownerKey(owner))
  if (!cur) return
  active.delete(ownerKey(owner))
  void br('browser:pick', { owner: cur.owner, tabId: cur.tabId, on: false }).catch(() => undefined)
}
