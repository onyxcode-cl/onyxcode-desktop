/**
 * Servicio de «Proyectos» del Chat (F8-B185): une el almacén local, la lectura de archivos y la búsqueda. Sin Electron: el diálogo de
 * archivos lo entrega quien lo llama (en pruebas, uno falso).
 *
 *  - Los archivos entran por dos puertas y las dos terminan en `ingest`: el diálogo nativo (el renderer recibe fichas de un solo
 *    uso, nunca rutas) o los bytes de un archivo arrastrado.
 *  - Reglas: extensiones permitidas, sin nombres de secretos (`.env`, llaves…; las mismas del Chat), sin ejecutables ni enlaces
 *    simbólicos, solo archivos regulares, y los topes de `PROJECT_LIMITS`. Lo que no cumple NO se indexa y queda anotado con su motivo.
 *  - Todo se copia al almacén del proyecto: borrar el proyecto borra todo, y el índice no depende de que la ruta de origen siga ahí.
 */
import { randomBytes } from 'node:crypto'
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { basename, extname, isAbsolute } from 'node:path'
import type {
  ProjectAddResult,
  ProjectContextResult,
  ProjectFileFailReason,
  ProjectFileInfo,
  ProjectInfo,
  ProjectLimitsInfo,
  ProjectPickedFile,
  ProjectsState
} from '@shared/ipc-extras'
import { KNOWLEDGE_EXTS, PROJECT_LIMITS, chunksForFile, knowledgeKind, selectPassages } from '@shared/project-knowledge'
import { BLOCKED_OPEN_EXTENSIONS } from '../tasks/open-policy'
import { isSensitiveName } from '../files/chat-files'
import { extractKnowledgeText } from './extract'
import { ProjectStore, ProjectStoreError, cleanName } from './store'

export const PICK_TOKEN_TTL_MS = 10 * 60_000
const MAX_PICKS = 20

export class ProjectError extends Error {
  constructor(readonly code: 'notFound' | 'tooMany' | 'invalid' | 'expired') {
    super(code)
  }
}

export interface ProjectsDeps {
  store: ProjectStore
  /** Diálogo nativo de archivos (varios). `[]` = cancelado. */
  pickFiles: () => Promise<string[]>
  now?: () => number
}

interface Pending {
  path: string
  name: string
  bytes: number
  expires: number
}

export function projectLimits(): ProjectLimitsInfo {
  return {
    maxProjects: PROJECT_LIMITS.maxProjects,
    maxFilesPerProject: PROJECT_LIMITS.maxFilesPerProject,
    maxFileBytes: PROJECT_LIMITS.maxFileBytes,
    maxProjectBytes: PROJECT_LIMITS.maxProjectBytes,
    maxCharsPerFile: PROJECT_LIMITS.maxCharsPerFile,
    maxInstructionsChars: PROJECT_LIMITS.maxInstructionsChars,
    maxNameChars: PROJECT_LIMITS.maxNameChars,
    maxPassages: PROJECT_LIMITS.maxPassages,
    maxInjectedChars: PROJECT_LIMITS.maxInjectedChars,
    extensions: [...KNOWLEDGE_EXTS]
  }
}

/** ¿Se puede aceptar un archivo con este nombre? `null` = sí; si no, el motivo. */
export function checkFileName(name: string): ProjectFileFailReason | null {
  if (!name || name.includes('\0')) return 'unsupported'
  if (isSensitiveName(name)) return 'reserved'
  const ext = extname(name).toLowerCase()
  if (ext && BLOCKED_OPEN_EXTENSIONS.has(ext)) return 'unsupported'
  if (!knowledgeKind(name)) return 'unsupported'
  return null
}

/** Lee un archivo elegido en el diálogo: ruta absoluta, archivo regular (también tras seguir enlaces), sin nombre de secreto y con tope. */
function readPicked(path: string): { name: string; buf: Buffer } | { name: string; bytes: number; reason: ProjectFileFailReason } {
  const name = basename(path)
  const fail = (reason: ProjectFileFailReason, bytes = 0): { name: string; bytes: number; reason: ProjectFileFailReason } => ({
    name,
    bytes,
    reason
  })
  if (!isAbsolute(path) || path.includes('\0')) return fail('unreadable')
  let real: string
  try {
    real = realpathSync(path)
  } catch {
    return fail('unreadable')
  }
  // El tipo y el nombre se juzgan sobre la ruta REAL: un enlace «a.md» hacia un archivo de secretos no pasa.
  const realName = basename(real)
  const bad = checkFileName(name) ?? checkFileName(realName)
  if (bad) return fail(bad)
  let fd = -1
  try {
    if (!lstatSync(real).isFile()) return fail('unreadable')
    fd = openSync(real, 'r')
    const st = fstatSync(fd)
    if (!st.isFile()) return fail('unreadable')
    if (st.size > PROJECT_LIMITS.maxFileBytes) return fail('tooBig', st.size)
    const buf = Buffer.alloc(st.size)
    let off = 0
    while (off < buf.length) {
      const n = readSync(fd, buf, off, buf.length - off, off)
      if (n <= 0) break
      off += n
    }
    return { name, buf: buf.subarray(0, off) }
  } catch {
    return fail('unreadable')
  } finally {
    if (fd >= 0) closeSync(fd)
  }
}

export function createProjectsService(deps: ProjectsDeps): {
  state: () => ProjectsState
  create: (req: { name: string; instructions?: string }) => ProjectsState
  update: (req: { id: string; name?: string; instructions?: string }) => ProjectsState
  remove: (req: { id: string }) => ProjectsState
  pickFiles: (req: { id: string }) => Promise<ProjectPickedFile[] | null>
  addPicked: (req: { id: string; token: string }) => Promise<ProjectAddResult>
  addBytes: (req: { id: string; name: string; base64: string }) => Promise<ProjectAddResult>
  removeFile: (req: { id: string; fileId: string }) => ProjectsState
  assign: (req: { sessionId: string; projectId: string | null }) => ProjectsState
  context: (req: { sessionId: string; query: string; recent?: string }) => ProjectContextResult | null
} {
  const store = deps.store
  const now = deps.now ?? Date.now
  const pending = new Map<string, Pending>()

  const state = (): ProjectsState => ({ projects: store.list(), assignments: store.assignments(), limits: projectLimits() })

  const wrap = <T>(fn: () => T): T => {
    try {
      return fn()
    } catch (e) {
      if (e instanceof ProjectStoreError) throw new ProjectError(e.code)
      throw e
    }
  }

  /** Lee, valida y guarda un archivo. Siempre devuelve la ficha (lista o con su motivo); los fallos de disco sí lanzan. */
  const ingest = async (projectId: string, name: string, buf: Buffer): Promise<ProjectFileInfo> => {
    const cleanFileName = cleanName(basename(name.replace(/\\/g, '/')), 200)
    return wrap(async () => {
      const failed = (reason: ProjectFileFailReason): ProjectFileInfo =>
        store.addFailed(projectId, { name: cleanFileName || '?', bytes: buf.length, reason }, now())
      store.readyFiles(projectId) // lanza notFound si el proyecto no existe
      const bad = cleanFileName ? checkFileName(cleanFileName) : 'unsupported'
      if (bad) return failed(bad)
      if (buf.length > PROJECT_LIMITS.maxFileBytes) return failed('tooBig')
      const replacing = store.fileByName(projectId, cleanFileName)
      const ready = store.readyFiles(projectId)
      if (replacing?.status !== 'ready' && ready.length >= PROJECT_LIMITS.maxFilesPerProject) return failed('tooManyFiles')
      const usedBytes = store.usedFileBytes(projectId) - (replacing?.status === 'ready' ? replacing.bytes : 0)
      if (usedBytes + buf.length > PROJECT_LIMITS.maxProjectBytes) return failed('projectFull')
      const ex = await extractKnowledgeText(cleanFileName, buf)
      if (!ex.ok) return failed(ex.reason)
      // Tope de texto de todo el proyecto (medido sobre los pasajes que de verdad quedan en el índice): lo que sobre se recorta;
      // si ya no queda sitio, se rechaza.
      const room = PROJECT_LIMITS.maxCharsPerProject - store.usedChars(projectId, replacing?.id)
      if (room < 1000) return failed('projectFull')
      let chunks = chunksForFile('pending', cleanFileName, ex.text)
      let truncated = ex.truncated
      let chars = 0
      const kept: typeof chunks = []
      for (const c of chunks) {
        if (chars + c.text.length > room) {
          truncated = true
          break
        }
        kept.push(c)
        chars += c.text.length
      }
      chunks = kept
      if (chunks.length === 0) return failed('empty')
      return store.addReady(projectId, { name: cleanFileName, bytes: buf, chunks, chars, truncated }, now())
    })
  }

  return {
    state,
    create: ({ name, instructions }) =>
      wrap(() => {
        store.create(name, instructions ?? '', now())
        return state()
      }),
    update: ({ id, name, instructions }) =>
      wrap(() => {
        store.update(id, { name, instructions }, now())
        return state()
      }),
    remove: ({ id }) =>
      wrap(() => {
        store.delete(id)
        for (const [token, p] of pending) if (p.expires < now()) pending.delete(token)
        return state()
      }),
    pickFiles: async ({ id }) => {
      wrap(() => store.readyFiles(id))
      const paths = await deps.pickFiles()
      if (paths.length === 0) return null
      for (const [token, p] of pending) if (p.expires < now()) pending.delete(token)
      const out: ProjectPickedFile[] = []
      for (const path of paths.slice(0, MAX_PICKS)) {
        const token = randomBytes(16).toString('hex')
        let bytes = 0
        try {
          bytes = lstatSync(path).size
        } catch {
          // se informará al leerlo
        }
        pending.set(token, { path, name: basename(path), bytes, expires: now() + PICK_TOKEN_TTL_MS })
        out.push({ token, name: basename(path), bytes })
      }
      return out
    },
    addPicked: async ({ id, token }) => {
      const p = pending.get(token)
      pending.delete(token) // un solo uso, salga bien o mal
      if (!p || now() > p.expires) throw new ProjectError('expired')
      wrap(() => store.readyFiles(id))
      const r = readPicked(p.path)
      const file =
        'buf' in r
          ? await ingest(id, r.name, r.buf)
          : wrap(() => store.addFailed(id, { name: r.name, bytes: r.bytes, reason: r.reason }, now()))
      return { state: state(), file }
    },
    addBytes: async ({ id, name, base64 }) => {
      const buf = Buffer.from(base64, 'base64')
      const file = await ingest(id, name, buf)
      return { state: state(), file }
    },
    removeFile: ({ id, fileId }) =>
      wrap(() => {
        store.removeFile(id, fileId, now())
        return state()
      }),
    assign: ({ sessionId, projectId }) =>
      wrap(() => {
        store.assign(sessionId, projectId)
        return state()
      }),
    context: ({ sessionId, query, recent }) => {
      const p = store.projectOf(sessionId)
      if (!p) return null
      const ready = store.readyFiles(p.id)
      const hasFiles = ready.length > 0
      let passages: ProjectContextResult['passages'] = []
      if (hasFiles) {
        const index = store.searchIndex(p.id)
        let found = index.search(query)
        // Una pregunta de seguimiento muy corta («¿y la garantía?») se apoya en el mensaje anterior de la persona.
        if (found.length === 0 && recent && recent.trim()) found = index.search(`${recent}\n${query}`)
        passages = selectPassages(found)
      }
      return { projectId: p.id, name: p.name, instructions: p.instructions, hasFiles, passages }
    }
  }
}

export type ProjectsService = ReturnType<typeof createProjectsService>
export type { ProjectInfo }
