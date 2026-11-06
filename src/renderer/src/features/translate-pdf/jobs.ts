/**
 * Traducciones del Chat como TRABAJOS dentro de la conversación (no una ventana): cada una es una tarjeta viva sobre el cuadro de
 * escribir, con su progreso, «Cancelar» y, al terminar, abrir/guardar (y la versión limpia de un escaneo). Se puede seguir
 * escribiendo mientras tanto. El motor es `translatePdf` (probado con un modelo falso); aquí solo se guarda el estado y se conecta
 * con main y con el modelo del Chat. Los trabajos viven mientras la app está abierta (el archivo queda en la carpeta del trabajo
 * hasta el limpiado diario de main).
 */
import { create } from 'zustand'
import { t as tr } from '@shared/i18n'
import { DOCX_MIME, type PdfFailReason, type TranslateKind, type TranslateLangCode } from '@shared/translate-pdf'
import { call } from '../../lib/api'
import { announce } from '../../lib/announce'
import { useServer } from '../../stores/server'
import { askModel } from '../code/impl/pr/pr-ai'
import { chatModelSeesImages } from './model-info'
import { TranslateError, translatePdf, type TranslateDeps, type TranslateOutcome, type TranslateProgress } from './translate'

/** Traducción ya decidida: qué archivo y a qué idioma. */
export interface TranslatePreset {
  name: string
  base64: string
  kind?: TranslateKind
  target: TranslateLangCode
}

export type JobState =
  | { kind: 'running'; progress: TranslateProgress }
  | { kind: 'done'; outcome: TranslateOutcome; saved: boolean }
  | { kind: 'error'; reason: PdfFailReason | 'model' | 'aborted' | 'tooManyFailures'; detail?: string }

export interface TranslateJob {
  id: string
  preset: TranslatePreset
  state: JobState
}

interface JobsStore {
  jobs: TranslateJob[]
}
export const useTranslateJobs = create<JobsStore>(() => ({ jobs: [] }))

const controllers = new Map<string, AbortController>()
let seq = 0

function patch(id: string, state: JobState): void {
  useTranslateJobs.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, state } : j)) }))
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** PDF o Word según el tipo/extensión del archivo; `null` si no es ninguno. */
export function fileKind(f: { type: string; name: string }): TranslateKind | null {
  if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) return 'pdf'
  if (f.type === DOCX_MIME || /\.docx$/i.test(f.name)) return 'docx'
  return null
}

export function realDeps(): TranslateDeps {
  const dir = useServer.getState().connection?.chatDirectory ?? ''
  return {
    extract: (req) => call('translate:pdfExtract', req),
    apply: (req) => call('translate:pdfApply', req),
    discard: (jobId) => call('translate:pdfDiscard', { jobId }),
    ask: (prompt, signal, images) => askModel(dir, prompt, { mode: 'chat', signal, timeoutMs: 240_000, images }),
    pageImage: (req) => call('translate:pdfPageImage', req),
    clean: (req) => call('translate:pdfClean', req)
  }
}

/**
 * Arranca una traducción como trabajo de la conversación y devuelve su id. `deps` solo se cambia en las pruebas.
 * Nunca lanza: cualquier fallo queda en el estado del trabajo.
 */
export function startTranslateJob(preset: TranslatePreset, deps: TranslateDeps = realDeps(), vision = chatModelSeesImages()): string {
  const id = `tj-${Date.now().toString(36)}-${++seq}`
  const ctrl = new AbortController()
  controllers.set(id, ctrl)
  useTranslateJobs.setState((s) => ({
    jobs: [...s.jobs, { id, preset, state: { kind: 'running', progress: { phase: 'reading', done: 0, total: 0 } } }]
  }))
  void (async () => {
    try {
      const outcome = await translatePdf(deps, {
        name: preset.name,
        base64: preset.base64,
        kind: preset.kind,
        target: preset.target,
        signal: ctrl.signal,
        onProgress: (progress) => patch(id, { kind: 'running', progress }),
        // la IA ve las hojas escaneadas como imagen (si el modelo lee imágenes) y arma una ficha del documento antes de traducir
        vision,
        card: true,
        // en escaneos, además un PDF nuevo y limpio (la IA reconstruye cada hoja)
        clean: true
      })
      patch(id, { kind: 'done', outcome, saved: false })
      announce(tr('translate.pdf.doneTitle', { name: outcome.outName }), 'polite')
    } catch (e) {
      if (e instanceof TranslateError) patch(id, { kind: 'error', reason: e.reason, detail: e.reason === 'model' ? e.message : undefined })
      else patch(id, { kind: 'error', reason: 'failed' })
    } finally {
      controllers.delete(id)
    }
  })()
  return id
}

/** Cancela un trabajo en curso (`translatePdf` borra lo que haya empezado). */
export function cancelTranslateJob(id: string): void {
  controllers.get(id)?.abort()
}

/** Quita la tarjeta; si seguía en curso, lo cancela. El archivo ya hecho queda hasta el limpiado diario de main. */
export function dismissTranslateJob(id: string): void {
  controllers.get(id)?.abort()
  useTranslateJobs.setState((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }))
}

/** Reintenta un trabajo que falló o se canceló: reemplaza la tarjeta por una nueva. */
export function retryTranslateJob(id: string, deps?: TranslateDeps): void {
  const job = useTranslateJobs.getState().jobs.find((j) => j.id === id)
  if (!job) return
  dismissTranslateJob(id)
  startTranslateJob(job.preset, deps)
}

export function markJobSaved(id: string): void {
  useTranslateJobs.setState((s) => ({
    jobs: s.jobs.map((j) => (j.id === id && j.state.kind === 'done' ? { ...j, state: { ...j.state, saved: true } } : j))
  }))
}
