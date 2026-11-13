/** Indicio de borrado denegado en el resultado de una herramienta; nunca autoriza acceso. */
import type { ToolPart } from '@opencode-ai/sdk/v2/client'
import type { MessageEntry } from '../../../stores/sessions'
import { needsDeleteGrant } from '@shared/tasks-delete-command'
import { normalizeAbs } from '@shared/doc-files'
import { toSandboxPath } from '@shared/wsl-paths'

const DENIED = /operation not permitted|permission denied|\b(?:EPERM|EACCES|PermissionDenied)\b/i
const REMOVE_OPERATION = /\bFileSystem\.(?:remove|unlink|rmdir|rename)\b|\b(?:unlink|unlinkat|rmdir|rename|renameat)(?:\s*[(,:]|\s+['"/])/i
const DELETE_ACTION = /^(?:delete|remove|unlink|rmdir|rename|move)$/i

export interface DeleteScope {
  folder: string
  additional?: string[]
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function deleteAttemptText(part: ToolPart): string {
  const input = part.state.input
  return str(input.command) || str(input.patchText) || str(input.patch) || `${part.tool}\n${resultText(part)}`
}

function resultText(part: ToolPart): string {
  return part.state.status === 'error' ? part.state.error : part.state.status === 'completed' ? part.state.output : ''
}

/** Normalización solo para presentar la oferta: main y el aislamiento siguen validando las rutas reales. */
function inScope(paths: string[], scope: DeleteScope, search = false): boolean {
  const canonical = (p: string): string => {
    const w = toSandboxPath(p)
    const abs = normalizeAbs(w.ok ? w.path : p).replace(/^\/private\/(var|tmp)(\/|$)/, '/$1$2')
    return /^\/win\/[a-z](?:\/|$)/.test(abs) ? abs.toLowerCase() : abs
  }
  const root = canonical(scope.folder)
  const excluded = [root + '/.lazunox', root + '/.git/hooks', ...(scope.additional ?? []).map(canonical)]
  const inside = (p: string, dir: string): boolean => p === dir || p.startsWith(dir + '/')
  return paths.some((p) => {
    if (!p || p.startsWith('~') || /[$`\0]/.test(p)) return false
    const abs = canonical(p.startsWith('/') || /^[a-z]:[\\/]/i.test(p) ? p : root + '/' + p)
    return (abs.startsWith(root + '/') || (search && abs === root)) && !excluded.some((dir) => inside(abs, dir))
  })
}

/** Mac: EPERM; WSL/Landlock: EACCES; el motor también los presenta como PermissionDenied: FileSystem.remove. */
export function looksLikeBlockedDelete(part: ToolPart, scope?: DeleteScope): boolean {
  // bash puede completar la herramienta aun con salida distinta de cero. Si el proceso
  // terminó bien, su salida puede contener un error recuperado (p. ej. shutil.move).
  if (part.state.status === 'completed' && (part.state.metadata?.exit === 0 || part.state.metadata?.lazunoxOwnDelete === true)) return false
  const text = resultText(part)
  if (!DENIED.test(text)) return false
  const input = part.state.input
  const patch = str(input.patchText) || str(input.patch)
  const deleted = Array.from(patch.matchAll(/^\*\*\* Delete File:\s*(.+)$/gm), (m) => m[1].trim())
  // Mover un archivo en un parche también elimina su nombre de origen.
  deleted.push(...Array.from(patch.matchAll(/^\*\*\* Update File: *(.+)\r?\n\*\*\* Move to:/gm), (m) => m[1].trim()))
  const command = str(input.command)
  const shell = part.tool === 'bash' || part.tool === 'execute'
  const operation = REMOVE_OPERATION.test(text)
  const explicitDelete = DELETE_ACTION.test(str(input.operation) || str(input.action)) || DELETE_ACTION.test(part.tool)
  if (!operation && /\bFileSystem\.(?:readFile|readDirectory|writeFile|open|stat|makeDirectory)\b/.test(text)) return false
  if (!deleted.length && !operation && !explicitDelete && !(shell && (needsDeleteGrant(command) || needsDeleteGrant(text)))) return false
  if (!scope) return true

  const file = str(input.filePath) || str(input.file_path) || str(input.path) || str(input.source)
  if (deleted.length) return inScope(deleted, scope)
  if (file) return inScope([file], scope)
  // Los errores de syscall suelen nombrar la ruta entre comillas (Node/Python/Effect).
  const quoted = Array.from(text.matchAll(/["'‘]([^"'’\n]+)["'’]/g), (m) => m[1])
  if (quoted.length) return inScope(quoted, scope)
  const absoluteErrors = Array.from(text.matchAll(/(?:^|[\s(:])((?:\/|[a-z]:[\\/])[^\s"'():,]+)/gi), (m) => m[1])
  if (absoluteErrors.length) return inScope(absoluteErrors, scope)
  const scriptPaths = Array.from(
    command.matchAll(/(?:\.(?:remove|unlink|rmdir|rmtree|rename|replace|move|rm)(?:Sync)?|\bPath)\s*\(\s*["']([^"']+)["']/g),
    (m) => m[1]
  )
  if (scriptPaths.length) return inScope(scriptPaths, scope)
  // Órdenes habituales. No pretende interpretar programas arbitrarios ni resolver enlaces simbólicos.
  const tokens = Array.from(command.matchAll(/"([^"\n]*)"|'([^'\n]*)'|([^\s;|&()]+)/g), (m) => m[1] ?? m[2] ?? m[3])
  const paths = tokens.filter((v, i) => i > 0 && !v.startsWith('-') && !DELETE_ACTION.test(v))
  return inScope(paths, scope, /\bfind\s/.test(command))
}

/** Oferta del último intento bloqueado: sobrevive a la respuesta final, no a otra tanda o pedido. */
export function currentBlockedDeletes(entries: MessageEntry[], scope: DeleteScope): ToolPart[] {
  let attempts: ToolPart[] = []
  for (const { info, parts } of entries) {
    if (info.role === 'user') {
      attempts = []
      continue
    }
    const tools = parts.filter((p): p is ToolPart => p.type === 'tool')
    // Cancelar retira la oferta. La respuesta final o un error del modelo conservan
    // el último bloqueo si no hubo otra tanda de herramientas después.
    if (info.error?.name === 'MessageAbortedError') {
      attempts = []
      continue
    }
    // Una nueva tanda de herramientas sustituye al intento anterior, incluso mientras
    // está en curso. No rescatar después un fallo viejo del historial.
    if (tools.length) attempts = tools.filter((p) => looksLikeBlockedDelete(p, scope))
  }
  return attempts
}
