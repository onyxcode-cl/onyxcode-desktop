/**
 * Estado de «Proyectos» del Chat (F8-B185): lista, conversación → proyecto, pantalla de proyecto abierta, proyecto elegido para la
 * conversación que aún no existe y el progreso de lectura de archivos. Todo lo que toca disco o archivos pasa por `main`
 * (`projects:*`); aquí solo se guarda una copia del estado para pintar.
 */
import { create } from 'zustand'
import type { ProjectFileFailReason, ProjectInfo, ProjectsState } from '@shared/ipc-extras'
import { PROJECT_LIMITS } from '@shared/project-knowledge'
import { getExtras } from '../../lib/extrasApi'
import { errorMessage } from '../../lib/opencode'
import { isRemoteSurface } from '../../lib/platform'

export type UploadStatus = 'waiting' | 'reading' | 'ready' | 'error'

export interface UploadItem {
  key: string
  name: string
  status: UploadStatus
  reason?: ProjectFileFailReason
  /** El rechazo ocurrió aquí (antes de leer nada) y no quedó anotado en el proyecto. */
  local?: boolean
}

export interface UploadRun {
  projectId: string
  items: UploadItem[]
  /** Terminó (todos los archivos quedaron `ready` o `error`). */
  done: boolean
}

/** Un archivo que entra: una ficha del diálogo nativo o un archivo arrastrado. */
export type UploadSource = { kind: 'picked'; token: string; name: string; bytes: number } | { kind: 'dropped'; file: File }

interface ProjectsStore {
  state: ProjectsState | null
  loading: boolean
  error: string | null
  /** Proyecto cuya pantalla está abierta en la zona principal del Chat. */
  viewId: string | null
  /** Proyecto elegido para la conversación NUEVA (aún sin sesión). */
  pendingId: string | null
  upload: UploadRun | null
  load: () => Promise<void>
  create: (name: string, instructions?: string) => Promise<ProjectInfo | null>
  update: (id: string, patch: { name?: string; instructions?: string }) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
  openProject: (id: string) => void
  closeProject: () => void
  setPending: (id: string | null) => void
  assign: (sessionId: string, projectId: string | null) => Promise<void>
  removeFile: (id: string, fileId: string) => Promise<void>
  addFiles: (projectId: string, sources: UploadSource[]) => Promise<void>
  clearUpload: () => void
  clearError: () => void
}

/** Texto de error de `main` (códigos de `ProjectError`) o genérico. */
export function projectErrorCode(err: unknown): string {
  const m = errorMessage(err)
  return /^(notFound|tooMany|invalid|expired)$/.test(m) ? m : 'unknown'
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(r.error ?? new Error('read'))
    r.onload = () => {
      const s = typeof r.result === 'string' ? r.result : ''
      resolve(s.slice(s.indexOf(',') + 1))
    }
    r.readAsDataURL(file)
  })
}

export const useProjects = create<ProjectsStore>((set, get) => {
  const invoke = <T>(run: (x: NonNullable<ReturnType<typeof getExtras>>) => Promise<T>): Promise<T> => {
    const x = getExtras()
    if (!x) return Promise.reject(new Error('unavailable'))
    return run(x)
  }
  const patchItem = (key: string, patch: Partial<UploadItem>): void =>
    set((s) => (s.upload ? { upload: { ...s.upload, items: s.upload.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) } } : {}))

  return {
    state: null,
    loading: false,
    error: null,
    viewId: null,
    pendingId: null,
    upload: null,
    load: async () => {
      if (isRemoteSurface() || !getExtras()) return
      set({ loading: true, error: null })
      try {
        set({ state: await invoke((x) => x.invoke('projects:list')), loading: false })
      } catch (err) {
        set({ loading: false, error: errorMessage(err) })
      }
    },
    create: async (name, instructions) => {
      try {
        const next = await invoke((x) => x.invoke('projects:create', { name, ...(instructions ? { instructions } : {}) }))
        set({ state: next, error: null })
        // El proyecto recién creado es el más reciente.
        return next.projects[0] ?? null
      } catch (err) {
        set({ error: errorMessage(err) })
        return null
      }
    },
    update: async (id, patch) => {
      try {
        set({ state: await invoke((x) => x.invoke('projects:update', { id, ...patch })), error: null })
        return true
      } catch (err) {
        set({ error: errorMessage(err) })
        return false
      }
    },
    remove: async (id) => {
      try {
        const next = await invoke((x) => x.invoke('projects:delete', { id }))
        set((s) => ({
          state: next,
          error: null,
          viewId: s.viewId === id ? null : s.viewId,
          pendingId: s.pendingId === id ? null : s.pendingId
        }))
        return true
      } catch (err) {
        set({ error: errorMessage(err) })
        return false
      }
    },
    openProject: (id) => set({ viewId: id }),
    closeProject: () => set({ viewId: null }),
    setPending: (pendingId) => set({ pendingId }),
    assign: async (sessionId, projectId) => {
      try {
        set({ state: await invoke((x) => x.invoke('projects:assign', { sessionId, projectId })), error: null })
      } catch (err) {
        set({ error: errorMessage(err) })
      }
    },
    removeFile: async (id, fileId) => {
      try {
        set({ state: await invoke((x) => x.invoke('projects:removeFile', { id, fileId })), error: null })
      } catch (err) {
        set({ error: errorMessage(err) })
      }
    },
    addFiles: async (projectId, sources) => {
      if (sources.length === 0) return
      const items: UploadItem[] = sources.map((s, i) => ({
        key: `${Date.now()}-${i}`,
        name: s.kind === 'picked' ? s.name : s.file.name,
        status: 'waiting'
      }))
      set({ upload: { projectId, items, done: false } })
      for (let i = 0; i < sources.length; i++) {
        const src = sources[i]
        const key = items[i].key
        patchItem(key, { status: 'reading' })
        try {
          const size = src.kind === 'picked' ? src.bytes : src.file.size
          if (size > PROJECT_LIMITS.maxFileBytes) {
            // No vale la pena leer ni enviar un archivo que se va a rechazar.
            patchItem(key, { status: 'error', reason: 'tooBig', local: true })
            continue
          }
          const res =
            src.kind === 'picked'
              ? await invoke((x) => x.invoke('projects:addPicked', { id: projectId, token: src.token }))
              : await invoke(async (x) =>
                  x.invoke('projects:addBytes', { id: projectId, name: src.file.name, base64: await fileToBase64(src.file) })
                )
          set({ state: res.state })
          patchItem(key, res.file.status === 'ready' ? { status: 'ready' } : { status: 'error', reason: res.file.reason ?? 'unreadable' })
        } catch {
          patchItem(key, { status: 'error', reason: 'unreadable' })
        }
      }
      set((s) => (s.upload && s.upload.projectId === projectId ? { upload: { ...s.upload, done: true } } : {}))
      void get().load() // refresca los espacios y la lista tal como quedaron en disco
    },
    clearUpload: () => set({ upload: null }),
    clearError: () => set({ error: null })
  }
})

/** Proyecto de una conversación (o `null`). */
export function projectOfSession(state: ProjectsState | null, sessionId: string | null | undefined): ProjectInfo | null {
  if (!state || !sessionId) return null
  const pid = state.assignments[sessionId]
  return pid ? (state.projects.find((p) => p.id === pid) ?? null) : null
}

/** Texto corto del tamaño: «850 KB», «12,4 MB». */
export function formatBytes(n: number, locale?: string): string {
  const nf = (v: number, d: number): string => v.toLocaleString(locale, { maximumFractionDigits: d, minimumFractionDigits: 0 })
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${nf(n / 1024, 0)} KB`
  return `${nf(n / (1024 * 1024), 1)} MB`
}
