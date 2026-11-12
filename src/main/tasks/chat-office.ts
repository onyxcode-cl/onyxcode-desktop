/** Puente de bytes del Chat: solo originales OOXML, siempre a una carpeta propia recién creada. */
import { OFFICE_MAX_BYTES, type OfficeExtractRequest } from '@shared/attach-office'
import { MAX_ATTACHMENTS, MAX_TOTAL_BYTES } from '@shared/attach-classify'
import type { TasksResponse } from '@shared/ipc-tasks'
import { t } from '@shared/i18n'
import { openZip } from '../files/office-extract/zip'
import type { TasksManager } from './manager'
import { describeDeliverable, writeNewFile } from './files'

const PARTS = { docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml' } as const
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

async function validate(file: OfficeExtractRequest): Promise<{ stem: string; ext: string; bytes: Buffer }> {
  const fail = (): never => {
    throw new Error(t('chat.overdrive.invalid'))
  }
  if (typeof file?.name !== 'string' || file.name.length > 240 || /[\\/\x00-\x1f]/.test(file.name)) return fail()
  const match = /^(.+)\.(docx|xlsx|pptx)$/i.exec(file.name)
  if (!match || typeof file.base64 !== 'string' || !file.base64.length || file.base64.length > Math.ceil(OFFICE_MAX_BYTES / 3) * 4)
    return fail()
  if (file.base64.length % 4 !== 0 || !BASE64.test(file.base64)) return fail()
  const bytes = Buffer.from(file.base64, 'base64')
  if (!bytes.length || bytes.length > OFFICE_MAX_BYTES || bytes.toString('base64') !== file.base64) return fail()
  // Firma ZIP local exacta y parte propia de la familia: un PDF o un ZIP renombrado no pasa.
  if (!bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]))) return fail()
  const ext = match[2].toLowerCase() as keyof typeof PARTS
  try {
    const zip = await openZip(bytes) // acota entradas; no descomprime el contenido para copiarlo
    if (!zip.has('[Content_Types].xml') || !zip.has(PARTS[ext])) return fail()
  } catch {
    return fail()
  }
  // Nombre portátil: sin separadores, ADS, caracteres reservados ni dispositivos de Windows.
  let stem = match[1].replace(/[<>:"|?*]/g, '_').replace(/^[. ]+|[. ]+$/g, '')
  stem = Array.from(stem).slice(0, 60).join('') || 'archivo'
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem)) stem = `_${stem}`
  return { stem, ext: `.${ext}`, bytes }
}

export async function prepareChatOffice(
  req: { files: OfficeExtractRequest[] },
  tasks: Pick<TasksManager, 'createChatFolder' | 'assertInsideApproved'>
): Promise<TasksResponse<'tasks:chatOffice:prepare'>> {
  if (!Array.isArray(req.files) || !req.files.length || req.files.length > MAX_ATTACHMENTS) throw new Error(t('chat.overdrive.invalid'))
  // Valida el lote entero ANTES de crear o escribir. Tampoco se admite una ruta de destino del renderer.
  const decoded: Awaited<ReturnType<typeof validate>>[] = []
  let total = 0
  for (const file of req.files) {
    const data = await validate(file)
    total += data.bytes.length
    if (total > MAX_TOTAL_BYTES) throw new Error(t('chat.overdrive.invalid'))
    decoded.push(data)
  }
  const folder = await tasks.createChatFolder() // puertas de plataforma/política + aprobación existentes
  const root = tasks.assertInsideApproved(folder.path)
  const files = decoded.map(({ stem, ext, bytes }) => describeDeliverable(writeNewFile(root, stem, ext, bytes), root))
  return { folder, files }
}
