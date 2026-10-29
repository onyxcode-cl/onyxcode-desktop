/**
 * `node build_chat_docx.cjs spec.json salida.docx`: Word de las TAREAS con el mismo motor que el Chat (`isDocxSpec` + `renderChatDocx`,
 * WordCraft). Se empaqueta con `scripts/build-chat-office.mjs` en la skill `docx`. Ver `chat-doc-cli.ts` para el contrato y los códigos.
 */
import { isDocxSpec, type DocxSpec } from '@shared/chat-doc-spec'
import { runChatDocCli, runIfMain, type ChatDocCliDeps, type ChatDocCliKind } from './chat-doc-cli'
import { renderChatDocx } from './chat-word'

/** Primer bloque inválido (el esquema es estricto: claves desconocidas, textos largos, filas de otro largo…). */
export function explainDocx(v: unknown): string {
  if (!v || typeof v !== 'object') return 'Debe ser un objeto con `blocks`.'
  const d = v as Record<string, unknown>
  const blocks = d.blocks
  if (!Array.isArray(blocks) || blocks.length === 0) return '`blocks` debe ser una lista con al menos un bloque.'
  const bad = blocks.findIndex((b) => !isDocxSpec({ blocks: [b] }))
  if (bad >= 0) {
    const t = (blocks[bad] as { type?: unknown } | null)?.type
    return `El bloque blocks[${bad}] (type ${JSON.stringify(t)}) no es válido: tipos permitidos heading, paragraph, bullets, numbered, table, page_break; sin claves extra; las filas de table con tantas celdas como columns.`
  }
  return 'Revisa los campos del documento (solo title, subtitle, author, date, header, footer, page_numbers, toc, blocks; textos de hasta 200 caracteres en esos campos).'
}

export const docxKind: ChatDocCliKind<DocxSpec> = {
  ext: '.docx',
  script: 'build_chat_docx',
  engineName: 'WordCraft',
  envVar: 'LAZUNOX_WORDCRAFT',
  fallback: 'usa build_docx.py (diseño estándar).',
  isSpec: isDocxSpec,
  explain: explainDocx,
  render: (binary, spec, ms) => renderChatDocx(binary, spec, ms),
  summary: (s) => `${s.blocks.length} bloques`
}

export const runChatDocxCli = (argv: string[], deps?: ChatDocCliDeps): Promise<number> => runChatDocCli(docxKind, argv, deps)

declare const require: NodeJS.Require | undefined
declare const module: NodeJS.Module | undefined
runIfMain(docxKind, typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module)
