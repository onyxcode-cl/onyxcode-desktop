/**
 * ¿La persona está pidiendo traducir el PDF que adjuntó? (F8-B200). Puro y conservador: solo ofrece la herramienta (la persona confirma
 * con un clic), así que un falso positivo cuesta un clic y un falso negativo se arregla con el ícono del compositor.
 */
import { DOCX_MIME, TRANSLATE_LANGS, type TranslateKind, type TranslateLangCode } from './translate-pdf'

export interface TranslateIntent {
  /** Posición del PDF o Word dentro de los adjuntos. */
  fileIndex: number
  kind: TranslateKind
  target: TranslateLangCode
}

const VERB = /\b(traduc\w*|traduzc\w*|translat\w*|pasa(?:lo|la|r|me)?\s+(?:a|al|en)\b|version\s+en)/i
/** Lo que indica que no quiere el documento entero traducido (resumen, un párrafo, explicación…). */
const PARTIAL =
  /\b(resum\w*|summar\w*|explic\w*|explain|parrafo\w*|paragraph|frase|oracion|sentence|solo\s+(?:la|el|las|los)|only\s+(?:the|page)|pagina\s+\d|page\s+\d)\b/i

const LANG_WORDS: [TranslateLangCode, RegExp][] = [
  ['en', /\b(ingles|english)\b/i],
  ['es', /\b(espanol|castellano|spanish)\b/i],
  ['pt', /\b(portugues|portuguese)\b/i],
  ['fr', /\b(frances|french)\b/i],
  ['de', /\b(aleman|german)\b/i],
  ['it', /\b(italiano|italian)\b/i]
]

/** Sin tildes ni mayúsculas: «Tradúcelo», «inglés» e «INGLES» son lo mismo. */
const plain = (t: string): string =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00f1/g, 'n')

/** Idioma que nombra el texto, o `null`. Si nombra varios gana el ÚLTIMO que sigue a «a/al/en/to/into/in» («este contrato en español al inglés» → inglés). */
export function languageIn(text: string): TranslateLangCode | null {
  const t = plain(text)
  const after = t.match(/\b(?:a|al|en|to|into|in)\s+(?:el\s+|la\s+)?(\S+)/gi) ?? []
  for (const frag of [...after].reverse()) for (const [code, re] of LANG_WORDS) if (re.test(frag)) return code
  for (const [code, re] of LANG_WORDS) if (re.test(t)) return code
  return null
}

export function detectTranslateIntent(text: string, files: readonly { mime: string }[], uiLang: 'es' | 'en'): TranslateIntent | null {
  const docs = files
    .map((f, i) => ({ f, i, kind: (f.mime === 'application/pdf' ? 'pdf' : f.mime === DOCX_MIME ? 'docx' : null) as TranslateKind | null }))
    .filter((x) => x.kind !== null)
  if (docs.length !== 1) return null
  const t = plain(text)
  if (!VERB.test(t) || PARTIAL.test(t)) return null
  const fallback: TranslateLangCode = uiLang === 'en' ? 'es' : 'en'
  const target = languageIn(text) ?? fallback
  return TRANSLATE_LANGS.some((l) => l.code === target) ? { fileIndex: docs[0].i, kind: docs[0].kind as TranslateKind, target } : null
}
