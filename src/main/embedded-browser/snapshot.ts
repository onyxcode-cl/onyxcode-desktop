/**
 * `take_snapshot` (Lote D, B.6): convierte `Accessibility.getFullAXTree` en una representación de
 * texto con `uid`s estables (`s<seq>_<n>`) que las demás herramientas (`click`, `fill`…) resuelven
 * a un `backendDOMNodeId` de CDP. Los `uid`s caducan al navegar: se detecta por cambio de URL de
 * la pestaña (no hay otra señal fiable sin acoplarse a `service.ts`) y se sube `seq`, así un uid
 * de antes de navegar nunca se confunde con un nodo de la página nueva aunque coincida el índice.
 *
 * Tope de 1500 nodos y 60 KB de texto (B.6): por encima, se corta y se avisa en el propio texto.
 */

const MAX_NODES = 1500
const MAX_BYTES = 60_000

interface AXValue {
  type?: string
  value?: unknown
}

/** Forma de un nodo de `Accessibility.getFullAXTree` (subconjunto que usamos). */
export interface AXNode {
  nodeId: string
  ignored?: boolean
  role?: AXValue
  name?: AXValue
  value?: AXValue
  description?: AXValue
  properties?: Array<{ name: string; value?: AXValue }>
  childIds?: string[]
  backendDOMNodeId?: number
}

export interface UidInfo {
  backendNodeId: number
  /** Nombre accesible del nodo (para la guarda de acciones sensibles, B.6 punto 6). */
  name: string
  role: string
}

interface TabSnapshotState {
  seq: number
  url: string
  uidToInfo: Map<string, UidInfo>
}

/** Estado por pestaña (uid → nodo, y la URL con la que se tomó). Vive en memoria del proceso. */
const tabStates = new Map<string, TabSnapshotState>()

/** Al cerrar una pestaña o soltarla, libera su estado (evita crecer sin límite). */
export function forgetTabSnapshot(tabId: string): void {
  tabStates.delete(tabId)
}

function stateFor(tabId: string, url: string): TabSnapshotState {
  const cur = tabStates.get(tabId)
  if (cur && cur.url === url) return cur
  const next: TabSnapshotState = { seq: (cur?.seq ?? -1) + 1, url, uidToInfo: new Map() }
  tabStates.set(tabId, next)
  return next
}

/** Info de un `uid` de la ÚLTIMA instantánea de esa pestaña, o null si caducó/no existe. */
export function infoForUid(tabId: string, uid: string): UidInfo | null {
  const st = tabStates.get(tabId)
  if (!st) return null
  return st.uidToInfo.get(uid) ?? null
}

/** `backendNodeId` de un `uid` (atajo sobre `infoForUid`). */
export function backendIdForUid(tabId: string, uid: string): number | null {
  return infoForUid(tabId, uid)?.backendNodeId ?? null
}

export interface SnapshotResult {
  text: string
  truncated: boolean
  nodeCount: number
}

const INTERESTING_FLAGS = new Set(['disabled', 'focused', 'checked', 'expanded', 'selected', 'required', 'invalid', 'pressed'])

function textOf(v?: AXValue): string {
  return v && v.value !== undefined && v.value !== null ? String(v.value) : ''
}

/**
 * Construye el texto de la instantánea y (re)genera los `uid`s de esta pestaña. `url` es la URL
 * actual de la pestaña (para decidir si los `uid`s anteriores siguen valiendo).
 */
export function buildSnapshot(tabId: string, url: string, nodes: AXNode[], opts: { verbose?: boolean } = {}): SnapshotResult {
  const state = stateFor(tabId, url)
  state.uidToInfo.clear()
  const byId = new Map(nodes.map((n) => [n.nodeId, n] as const))
  const childOf = new Map<string, string>()
  for (const n of nodes) for (const c of n.childIds ?? []) childOf.set(c, n.nodeId)
  const roots = nodes.filter((n) => !childOf.has(n.nodeId))

  const lines: string[] = []
  let count = 0
  let bytes = 0
  let truncated = false
  let counter = 0
  const seen = new Set<string>()

  const visit = (node: AXNode, depth: number): void => {
    if (truncated || seen.has(node.nodeId)) return
    seen.add(node.nodeId)
    if (node.ignored) {
      for (const cid of node.childIds ?? []) {
        const c = byId.get(cid)
        if (c) visit(c, depth)
      }
      return
    }
    if (count >= MAX_NODES) {
      truncated = true
      return
    }
    const role = textOf(node.role) || 'generic'
    const name = textOf(node.name)
    const value = textOf(node.value)
    let uid = ''
    if (typeof node.backendDOMNodeId === 'number') {
      uid = `s${state.seq}_${counter++}`
      state.uidToInfo.set(uid, { backendNodeId: node.backendDOMNodeId, name, role })
    }
    let line = `${'  '.repeat(depth)}- ${role}`
    if (name) line += ` "${name}"`
    if (value) line += ` value="${value}"`
    if (opts.verbose) {
      const flags: string[] = []
      for (const p of node.properties ?? []) {
        if (p.value?.value === true && INTERESTING_FLAGS.has(p.name)) flags.push(p.name)
      }
      if (flags.length) line += ` (${flags.join(', ')})`
    }
    if (uid) line += ` [uid=${uid}]`
    const lineBytes = Buffer.byteLength(`${line}\n`, 'utf8')
    if (bytes + lineBytes > MAX_BYTES) {
      truncated = true
      return
    }
    lines.push(line)
    bytes += lineBytes
    count++
    for (const cid of node.childIds ?? []) {
      const c = byId.get(cid)
      if (c) visit(c, depth + 1)
    }
  }

  for (const r of roots) visit(r, 0)
  if (truncated) lines.push('… (árbol truncado: demasiados nodos o demasiado texto; usa uids ya visibles o pide de nuevo tras interactuar)')
  return { text: lines.join('\n'), truncated, nodeCount: count }
}
