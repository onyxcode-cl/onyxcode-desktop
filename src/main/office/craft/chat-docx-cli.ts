/**
 * `node build_chat_docx.cjs spec.json salida.docx`: Word de las TAREAS con el mismo motor que el Chat (`isDocxSpec` + `renderChatDocx`,
 * WordCraft). Se empaqueta con `scripts/build-chat-office.mjs` en la skill `docx`. Ver `chat-doc-cli.ts` para el contrato y los códigos.
 */
import { isDocxSpec, type DocxSpec } from '@shared/chat-doc-spec'
import { explainDocx } from './doc-explain'
import { runChatDocCli, runIfMain, type ChatDocCliDeps, type ChatDocCliKind } from './chat-doc-cli'
import { renderChatDocx } from './chat-word'

export { explainDocx }

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
