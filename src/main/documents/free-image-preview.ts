/** Preview bytes are display-only, never a licensed resource. The marker survives ordinary copies/renames. */
export const FREE_IMAGE_PREVIEW_MARKER = 'lazunox-free-image-preview:not-for-document-use:v1'
export function isFreeImagePreview(bytes: Buffer): boolean {
  return bytes.includes(FREE_IMAGE_PREVIEW_MARKER)
}
/** JPEG COM before the original first segment; does not change its decoded pixels. */
export function markFreeImagePreview(jpeg: Buffer): Buffer {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('Vista previa JPEG inválida.')
  const comment = Buffer.from(FREE_IMAGE_PREVIEW_MARKER)
  const header = Buffer.from([0xff, 0xfe, 0, 0])
  header.writeUInt16BE(comment.length + 2, 2)
  return Buffer.concat([jpeg.subarray(0, 2), header, comment, jpeg.subarray(2)])
}

/** Inline HTML/CSS images bypass local paths, so check their bytes before the PDF renderer too. */
export function htmlHasFreeImagePreview(html: string): boolean {
  const codepoint = (raw: string, base: number): string => {
    const value = parseInt(raw, base)
    return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '\ufffd'
  }
  const named: Record<string, string> = { colon: ':', sol: '/', semi: ';', comma: ',', equals: '=', plus: '+', Tab: '\t', NewLine: '\n' }
  const normalized = html
    .replace(/&#(?:x([0-9a-f]+)|(\d+));?/gi, (_, hex: string, decimal: string) => codepoint(hex || decimal, hex ? 16 : 10))
    .replace(/&(colon|sol|semi|comma|equals|plus|Tab|NewLine);/g, (_, name: string) => named[name])
    .replace(/\\([0-9a-f]{1,6})\s?|\\([^\r\n])/gi, (_, hex: string, literal: string) => (hex ? codepoint(hex, 16) : literal))
    .replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/[\r\n\t]/g, '')
  if (normalized.includes(FREE_IMAGE_PREVIEW_MARKER)) return true
  // Browsers sniff image bytes even with an omitted or generic MIME type.
  for (const match of normalized.matchAll(/data:[a-z0-9.+/-]*(?:;[a-z0-9=.-]+)*;base64,([a-z0-9+/_=\s-]+)/gi))
    if (isFreeImagePreview(Buffer.from(match[1], 'base64'))) return true
  return false
}
