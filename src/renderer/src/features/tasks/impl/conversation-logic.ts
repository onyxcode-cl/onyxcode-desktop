/**
 * Lógica PURA de la conversación y de las aprobaciones de Tareas (sin React ni stores), para poder
 * comprobarla con node: ocultar lo deshecho por «Editar y reintentar», recorte del motivo que
 * declara el agente, reconocimiento de herramientas MCP y qué botones se ofrecen.
 */

// ───────────────────────────── Mensajes deshechos (session.revert) ─────────────────────────────

/**
 * `session.revert({messageID})` deja los mensajes en la lista hasta el siguiente prompt (el servidor los
 * limpia entonces). Se ocultan los que tienen id >= `revertMessageID`: los ids de OpenCode crecen con el
 * tiempo, así que la comparación de cadenas equivale a la cronológica. Sin marca devuelve la MISMA lista.
 */
export function hideRevertedEntries<T extends { info: { id: string } }>(entries: T[], revertMessageID?: string | null): T[] {
  if (!revertMessageID) return entries
  const kept = entries.filter((e) => e.info.id < revertMessageID)
  return kept.length === entries.length ? entries : kept
}

/** Id del bloque de la conversación que contiene la parte `partId` (o null). Los ids de bloque van en el DOM. */
export function blockIdForPart(blocks: Array<{ id: string; partIds: string[] }>, partId: string): string | null {
  for (const b of blocks) if (b.id === partId || b.partIds.includes(partId)) return b.id
  return null
}

// ───────────────────────────── Motivo declarado por el agente ─────────────────────────────

export const MOTIVE_MAX = 320

/**
 * Motivo que el agente escribió antes de pedir la carpeta: el ÚLTIMO párrafo del último mensaje
 * (lo más cercano a la petición), con los espacios colapsados y, si es largo, recortado por el
 * principio (se conserva el final). Es texto del modelo: la interfaz lo marca como no verificado.
 */
export function trimMotive(text: string, max = MOTIVE_MAX): string {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const last = paragraphs[paragraphs.length - 1] ?? ''
  if (last.length <= max) return last
  const tail = last.slice(last.length - (max - 1))
  const space = tail.indexOf(' ')
  // Empieza en una palabra completa siempre que quede texto suficiente.
  const clean = space > 0 && space < 40 ? tail.slice(space + 1) : tail
  return `…${clean.trim()}`
}

// ───────────────────────────── Herramientas MCP ─────────────────────────────

/** Permisos de OpenCode que NO son herramientas de un conector MCP. */
const BUILTIN_PERMISSIONS = new Set([
  'bash',
  'edit',
  'write',
  'patch',
  'multiedit',
  'apply_patch',
  'read',
  'glob',
  'grep',
  'list',
  'task',
  'skill',
  'webfetch',
  'websearch',
  'codesearch',
  'external_directory',
  'doom_loop',
  'todowrite',
  'todoread',
  'question',
  'lsp',
  'plan_enter',
  'plan_exit'
])

/** OpenCode nombra la herramienta MCP `<servidor>_<herramienta>` con el servidor saneado. */
function sanitizeServer(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export interface McpToolView {
  server: string
  tool: string
}

/**
 * ¿`permission` es una herramienta de un conector MCP? Con la lista de servidores conocidos se separa
 * exactamente (prefijo más largo); sin ella (o si no casa) se deduce por el primer «_».
 * `computer_*` y los permisos propios de OpenCode nunca cuentan.
 */
export function parseMcpPermission(permission: string, servers: string[] = []): McpToolView | null {
  if (BUILTIN_PERMISSIONS.has(permission) || permission.startsWith('computer_')) return null
  let best: { server: string; len: number } | null = null
  for (const s of servers) {
    const san = sanitizeServer(s)
    if (permission.startsWith(`${san}_`) && permission.length > san.length + 1 && (!best || san.length > best.len)) {
      best = { server: s, len: san.length }
    }
  }
  if (best) return { server: best.server, tool: permission.slice(best.len + 1) }
  const idx = permission.indexOf('_')
  if (idx > 0 && idx < permission.length - 1) return { server: permission.slice(0, idx), tool: permission.slice(idx + 1) }
  return null
}

/** JSON literal de los metadatos de la petición (vacío ⇒ ''), tal como los envía el agente. */
export function metadataJson(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object' || Object.keys(metadata as object).length === 0) return ''
  try {
    return JSON.stringify(metadata, null, 2)
  } catch {
    return String(metadata)
  }
}

// ───────────────────────────── Botón «Siempre» ─────────────────────────────

/**
 * ¿Se ofrece «Siempre»? No en acciones peligrosas, ni con la política `disableAlwaysAllow`, ni si no hay
 * ningún patrón que se pueda recordar (`rememberablePatterns` vacío).
 */
export function showAlways(opts: { danger: boolean; disableAlwaysAllow?: boolean; rememberableCount: number }): boolean {
  return !opts.danger && !opts.disableAlwaysAllow && opts.rememberableCount > 0
}

// ───────────────────────────── Tarjeta de carpeta ─────────────────────────────

export interface FolderRequestView {
  /** Carpeta pedida (literal). */
  requested: string
  /** Comando de bash que la provoca, si lo hay (literal). */
  command: string
  /** Carpetas ofrecidas: la pedida y sus ancestros (la primera es la pedida). */
  candidates: string[]
  motive: string
}

/** Modelo de vista de la tarjeta «otra carpeta»: ruta literal, candidatos, comando y motivo recortado. */
export function folderRequestView(
  req: { metadata?: Record<string, unknown> },
  paths: { requested: string; candidates: string[] },
  lastAssistantText: string
): FolderRequestView {
  const cmd = req.metadata?.command
  return {
    requested: paths.requested,
    command: typeof cmd === 'string' ? cmd : '',
    candidates: paths.candidates,
    motive: trimMotive(lastAssistantText)
  }
}
