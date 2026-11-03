/**
 * Indicador de revisión de calidad en la tarjeta de un Word/Excel/PowerPoint entregado: «Revisado ✔», «N avisos ✘» o «Sin revisar», con la
 * lista ✔/✘ al desplegarlo. La revisión se pide al main sobre el archivo tal como está (clave ruta+fecha+tamaño): si cambió, se vuelve a
 * revisar y mientras llega o si no se pudo, dice «Sin revisar»; nunca muestra un ✔ de una versión anterior.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, CircleDashed } from 'lucide-react'
import type { TasksFileReview } from '@shared/ipc-tasks'
import { useT } from '../../../lib/i18n'
import { cw } from './bridge'
import { baseName } from './util'

const REVIEWABLE = /\.(docx|xlsx|pptx)$/i
export const canReview = (path: string): boolean => REVIEWABLE.test(path)

const cache = new Map<string, TasksFileReview>()
const inflight = new Map<string, Promise<TasksFileReview>>()
const keyOf = (f: { path: string; mtime: number; size: number }): string => `${f.path}|${f.mtime}|${f.size}`

function load(f: { path: string; mtime: number; size: number }): Promise<TasksFileReview> {
  const key = keyOf(f)
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)
  let p = inflight.get(key)
  if (!p) {
    p = cw('tasks:reviewFile', { path: f.path })
      .catch((): TasksFileReview => ({ status: 'unavailable', items: [] }))
      .then((r) => {
        cache.set(key, r)
        if (cache.size > 200) cache.delete(cache.keys().next().value as string)
        inflight.delete(key)
        return r
      })
    inflight.set(key, p)
  }
  return p
}

export function useFileReview(f: { path: string; mtime: number; size: number }): TasksFileReview | null {
  const key = keyOf(f)
  const [state, setState] = useState<{ key: string; review: TasksFileReview } | null>(null)
  useEffect(() => {
    if (!canReview(f.path)) return
    let live = true
    void load(f).then((review) => live && setState({ key, review }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` ya resume path/mtime/size
  }, [key])
  // Un resultado de otra versión del archivo no cuenta.
  return state && state.key === key ? state.review : (cache.get(key) ?? null)
}

export function FileReview({ file }: { file: { path: string; mtime: number; size: number } }): React.JSX.Element | null {
  const t = useT()
  const [open, setOpen] = useState(false)
  const review = useFileReview(file)
  if (!canReview(file.path)) return null
  const bad = review ? review.items.filter((i) => !i.ok && !i.note).length : 0
  const status = !review || review.status === 'unavailable' ? 'none' : review.status === 'ok' ? 'ok' : 'issues'
  const label = status === 'ok' ? t('tasks.review.ok') : status === 'issues' ? t('tasks.review.issues', { n: bad }) : t('tasks.review.none')
  const Icon = status === 'ok' ? CheckCircle2 : status === 'issues' ? AlertTriangle : CircleDashed
  const tone = status === 'ok' ? 'text-success' : status === 'issues' ? 'text-warning' : 'text-muted'
  const detail = status === 'none' ? [] : (review?.items ?? [])
  const full = `${label} · ${baseName(file.path)}`
  return (
    <div className="basis-full">
      <button
        type="button"
        data-testid="file-review"
        data-status={status}
        aria-expanded={open}
        title={`${full}. ${t('tasks.review.hint')}`}
        aria-label={full}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-meta font-medium hover:bg-hover ${tone}`}
      >
        <Icon size={12} aria-hidden /> {label}
        {detail.length > 0 && <ChevronDown size={11} aria-hidden className={open ? 'rotate-180' : ''} />}
      </button>
      {open && (
        <ul
          role="list"
          aria-label={t('tasks.review.title', { name: baseName(file.path) })}
          className="mt-0.5 grid max-w-md gap-0.5 rounded-ctl bg-elevated p-2 text-meta ring-1 ring-inset ring-border"
        >
          {detail.length === 0 && <li className="text-muted">{t('tasks.review.unavailable')}</li>}
          {detail.map((i, n) => (
            <li key={n} className="flex gap-1.5">
              <span aria-hidden className={i.note ? 'text-muted' : i.ok ? 'text-success' : 'text-warning'}>
                {i.note ? 'ℹ' : i.ok ? '✔' : '✘'}
              </span>
              <span>{i.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
