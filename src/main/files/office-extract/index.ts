/**
 * Convierte un documento de oficina (Word, Excel, PowerPoint, OpenDocument, RTF) en texto Markdown para adjuntarlo al Chat.
 * Módulo sin Electron. Reglas:
 *  - todo se lee en memoria con lectores de solo lectura (JSZip, SheetJS, un XML propio sin DOCTYPE): no se ejecutan macros ni
 *    fórmulas, no se siguen vínculos ni contenido externo, no se abre ningún programa del sistema ni se escribe en disco;
 *  - topes de bytes (archivo y partes descomprimidas), de filas/columnas/hojas/diapositivas y de caracteres: lo que se recorta
 *    se avisa a la persona y a la IA;
 *  - el texto sale enmarcado como DATOS del archivo (no instrucciones), con una marca de cierre aleatoria que el contenido no
 *    puede imitar.
 */
import { randomBytes } from 'node:crypto'
import {
  OFFICE_MAX_BYTES,
  OFFICE_MAX_CHARS,
  OFFICE_UNIT_BY_FAMILY,
  officeExt,
  officeFamilyOf,
  type OfficeExtractRequest,
  type OfficeExtractResult,
  type OfficeFamily,
  type OfficeUnit
} from '@shared/attach-office'
import { t } from '@shared/i18n'
import { extractDocx } from './docx'
import { extractOdp, extractOdt } from './odf'
import { extractPptx } from './pptx'
import { extractRtf } from './rtf'
import { extractSheets } from './sheet'
import { cleanLine } from './markdown'
import type { Extracted } from './types'
import { cfbIsEncryptedPackage, ExtractError, isCfb, isZip, openZip } from './zip'

const ZIP_ONLY = new Set(['docx', 'docm', 'pptx', 'pptm', 'xlsx', 'xlsm', 'xlsb', 'ods', 'odt', 'odp'])

/** Texto de «3 páginas» / «1 hoja» / «12 diapositivas». */
export function unitsLabel(unit: OfficeUnit, n: number): string {
  return t(`attach.office.units.${unit}.${n === 1 ? 'one' : 'other'}`, { n })
}

export function kindLabel(family: OfficeFamily): string {
  return t(`attach.office.kind.${family}`)
}

function safeName(name: string): string {
  return cleanLine(name.replace(/[\r\n]+/g, ' ')).slice(0, 120) || '?'
}

/** Marco que ve la IA: qué archivo es, que su contenido son datos y los avisos de recorte. */
export function frameText(args: { name: string; family: OfficeFamily; units: number | null; body: string; notes: string[] }): string {
  const mark = randomBytes(6).toString('hex')
  const unit = OFFICE_UNIT_BY_FAMILY[args.family]
  const what = args.units ? `${kindLabel(args.family)}, ${unitsLabel(unit, args.units)}` : kindLabel(args.family)
  const open = `<<<FILE_CONTENT-${mark}>>>`
  const close = `<<<END_FILE_CONTENT-${mark}>>>`
  const lines = [
    t('attach.office.frame.head', { name: safeName(args.name), what }),
    t('attach.office.frame.notice', { open, close }),
    open,
    args.body,
    close
  ]
  if (args.notes.length) lines.push(t('attach.office.frame.truncated'), ...args.notes.map((n) => `- ${n}`))
  return lines.join('\n')
}

async function run(ext: string, buf: Uint8Array): Promise<Extracted> {
  if (ext === 'doc' || ext === 'ppt') throw new ExtractError('legacy')
  const cfb = isCfb(buf)
  if (ZIP_ONLY.has(ext) || ext === 'xls') {
    if (cfb) {
      // Un OOXML con contraseña es un contenedor antiguo con `EncryptedPackage`; un `.docx` que en realidad es binario viejo, no.
      if (ext === 'xls') return extractSheets(buf)
      throw new ExtractError(cfbIsEncryptedPackage(buf) ? 'encrypted' : 'legacy')
    }
    if (!isZip(buf)) throw new ExtractError('corrupt')
  }
  switch (ext) {
    case 'docx':
    case 'docm':
      return extractDocx(await openZip(buf))
    case 'pptx':
    case 'pptm':
      return extractPptx(await openZip(buf))
    case 'odt':
      return extractOdt(await openZip(buf))
    case 'odp':
      return extractOdp(await openZip(buf))
    case 'xlsx':
    case 'xlsm':
    case 'xlsb':
    case 'xls':
    case 'ods':
      return extractSheets(buf)
    case 'rtf':
      return extractRtf(buf)
    default:
      throw new ExtractError('unsupported')
  }
}

export async function extractOffice(req: OfficeExtractRequest): Promise<OfficeExtractResult> {
  const ext = officeExt(req.name)
  const family = officeFamilyOf(req.name)
  if (!family) return { ok: false, reason: 'unsupported' }
  const buf = Buffer.from(req.base64, 'base64')
  if (buf.length === 0) return { ok: false, reason: 'unreadable' }
  if (buf.length > OFFICE_MAX_BYTES) return { ok: false, reason: 'tooBig' }
  let ex: Extracted
  try {
    ex = await run(ext, buf)
  } catch (e) {
    if (e instanceof ExtractError) return { ok: false, reason: e.reason }
    return { ok: false, reason: 'corrupt' }
  }
  if (!ex.body.trim()) return { ok: false, reason: 'empty' }
  const notes = [...ex.notes]
  if (ex.truncated) notes.push(t('attach.office.note.chars', { max: String(OFFICE_MAX_CHARS) }))
  const text = frameText({ name: req.name, family, units: ex.units, body: ex.body, notes })
  return {
    ok: true,
    text,
    family,
    units: ex.units,
    unit: OFFICE_UNIT_BY_FAMILY[family],
    truncated: notes.length > 0,
    notes
  }
}
