/**
 * `node build_chat_xlsx.cjs spec.json salida.xlsx`: Excel de las TAREAS con el mismo motor que el Chat (`isXlsxSpec` + `renderChatGrid`,
 * GridCraft). Se empaqueta con `scripts/build-chat-office.mjs` en la skill `xlsx`. Ver `chat-doc-cli.ts` para el contrato y los códigos.
 */
import { isXlsxSpec, type XlsxSpec } from '@shared/chat-doc-spec'
import { explainXlsx } from './doc-explain'
import { runChatDocCli, runIfMain, type ChatDocCliDeps, type ChatDocCliKind } from './chat-doc-cli'
import { renderChatGrid } from './chat-grid'

export { explainXlsx }

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
