/**
 * `node build_chat_xlsx.cjs spec.json salida.xlsx`: Excel de las TAREAS con el mismo motor que el Chat (`isXlsxSpec` + `renderChatGrid`,
 * GridCraft). Se empaqueta con `scripts/build-chat-office.mjs` en la skill `xlsx`. Ver `chat-doc-cli.ts` para el contrato y los códigos.
 */
import { isXlsxSpec, type XlsxSpec } from '@shared/chat-doc-spec'
import { runChatDocCli, runIfMain, type ChatDocCliDeps, type ChatDocCliKind } from './chat-doc-cli'
import { renderChatGrid } from './chat-grid'

/** Primera hoja inválida (el Chat valida cada hoja: filas, formatos de columna, gráficos con rango A1). */
export function explainXlsx(v: unknown): string {
  if (!v || typeof v !== 'object') return 'Debe ser un objeto con `sheets`.'
  const sheets = (v as Record<string, unknown>).sheets
  if (!Array.isArray(sheets) || sheets.length === 0) return '`sheets` debe ser una lista con al menos una hoja (hasta 10).'
  const bad = sheets.findIndex((s) => !isXlsxSpec({ sheets: [s] }))
  if (bad >= 0)
    return `La hoja sheets[${bad}] no es válida: necesita name (texto) y rows (hasta 5000 filas de hasta 60 celdas: texto, número, null o {"formula":"SUM(B2:B5)","value":123}); columnFormats solo con currency, integer, decimal, percent o null; charts hasta 4, con type column/bar/line/pie/area, range tipo "A1:C7" y, opcionales, title, at, width y height (120 a 1200).`
  return 'Revisa que haya entre 1 y 10 hojas.'
}

export const xlsxKind: ChatDocCliKind<XlsxSpec> = {
  ext: '.xlsx',
  script: 'build_chat_xlsx',
  engineName: 'GridCraft',
  envVar: 'LAZUNOX_GRIDCRAFT',
  fallback: 'usa build_xlsx.py (diseño estándar).',
  isSpec: isXlsxSpec,
  explain: explainXlsx,
  render: (binary, spec, ms) => renderChatGrid(binary, spec, ms),
  summary: (s) => `${s.sheets.length} hojas`
}

export const runChatXlsxCli = (argv: string[], deps?: ChatDocCliDeps): Promise<number> => runChatDocCli(xlsxKind, argv, deps)

declare const require: NodeJS.Require | undefined
declare const module: NodeJS.Module | undefined
runIfMain(xlsxKind, typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module)
