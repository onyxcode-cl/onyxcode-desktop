/**
 * Revisión de calidad de un Word/Excel/PowerPoint ya entregado, para el indicador de la tarjeta del archivo. Se calcula sobre los bytes
 * del archivo en el momento de pedirla (la misma lista de `documents/review.ts`), sin guardar nada: así sirve igual si el archivo lo
 * creó `documentos_crear` o lo armó el agente con `bash` (Mac y WSL), y si el usuario lo cambió después se revisa de nuevo, nunca queda
 * un ✔ viejo. La ruta debe venir YA validada con `TasksManager.assertInsideApproved`.
 */
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import type { TasksFileReview } from '@shared/ipc-tasks'
import { reviewDocument } from '../documents/review'

const KINDS = { '.docx': 'docx', '.xlsx': 'xlsx', '.pptx': 'pptx' } as const
const MAX_BYTES = 25 * 1024 * 1024
const UNAVAILABLE: TasksFileReview = { status: 'unavailable', items: [] }

export async function reviewFile(path: string, review: typeof reviewDocument = reviewDocument): Promise<TasksFileReview> {
  const kind = (KINDS as Record<string, 'docx' | 'xlsx' | 'pptx' | undefined>)[extname(path).toLowerCase()]
  if (!kind) return UNAVAILABLE
  try {
    const st = await stat(path)
    if (!st.isFile() || st.size > MAX_BYTES) return UNAVAILABLE
    const res = await review(kind, await readFile(path))
    return {
      status: res.ok ? 'ok' : 'issues',
      items: res.items.map((i) => (i.note ? { ok: i.ok, text: i.text, note: true } : { ok: i.ok, text: i.text }))
    }
  } catch {
    return UNAVAILABLE
  }
}
