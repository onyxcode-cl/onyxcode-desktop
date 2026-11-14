/** Contexto de fotos elegido por la interfaz; toda autorización de carpetas se repite en main. */
import { realpath, stat } from 'node:fs/promises'
import { dirname, relative, isAbsolute, sep } from 'node:path'
import type { ArtifactContext } from '@shared/ipc-extras'
import { OutputPathError } from '../documents/output-path'
import { readTaskFile } from '../documents/input-path'
import { readChatFile, resolveChatFile } from '../files/chat-files'

export interface ArtifactPhotoResolvers {
  standalone(html: string): Promise<string>
  chat(html: string, sessionId: string): Promise<string>
  file(html: string, scope: { root: string; agentRoots: string[]; baseDir: string }): Promise<string>
}

const contains = (root: string, path: string): boolean => {
  const rel = relative(root, path)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

export async function prepareArtifactPhotos(
  html: string,
  context: ArtifactContext | undefined,
  allowedRoots: readonly string[],
  resolvers: ArtifactPhotoResolvers
): Promise<string> {
  if (!context) return resolvers.standalone(html)
  if (context.kind === 'chat') {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(context.sessionId)) throw new OutputPathError('name', 'Conversación de fotos inválida.')
    return resolvers.chat(html, context.sessionId)
  }
  let info: ReturnType<typeof resolveChatFile>
  try {
    info = resolveChatFile(allowedRoots, context.path)
  } catch {
    throw new OutputPathError('name', 'El archivo HTML está fuera de las carpetas autorizadas o ya no existe.')
  }
  if (info.kind !== 'html' || !info.canView) throw new OutputPathError('name', 'El contexto debe ser un archivo HTML autorizado.')
  const roots = (
    await Promise.all(
      allowedRoots.map(async (root) => {
        try {
          const real = await realpath(root)
          return (await stat(real)).isDirectory() && contains(real, info.path) ? real : null
        } catch {
          return null
        }
      })
    )
  )
    .filter((root): root is string => root !== null)
    .sort((a, b) => b.length - a.length)
  let root = roots[0]
  if (context.root) {
    const requested = await realpath(context.root).catch(() => {
      throw new OutputPathError('name', 'La carpeta de las fotos ya no está disponible.')
    })
    if (!roots.some((r) => r === requested || contains(r, requested)) || !contains(requested, info.path))
      throw new OutputPathError('name', 'La carpeta de las fotos está fuera del ámbito autorizado del HTML.')
    root = requested
  }
  // Un archivo exacto autorizado al guardar NO autoriza su carpeta vecina ni sus fotos.
  if (!root) {
    const current = readChatFile(allowedRoots, info.path)
    if (!current.ok || current.kind !== 'html' || current.truncated)
      throw new OutputPathError('name', 'No se pudo leer el HTML autorizado completo.')
    return resolvers.standalone(current.text)
  }
  // Las tarjetas pueden conservar el primer borrador mientras el agente corrige rutas de fotos.
  // Toda acción de archivo lee la versión actual, igual que «Ver»; el HTML del renderer no es la fuente.
  const current = await readTaskFile(root, info.path, [root], {}, 'html')
  return resolvers.file(current.bytes.toString('utf8'), {
    root,
    agentRoots: [root],
    baseDir: relative(root, dirname(info.path)).split(sep).join('/')
  })
}
