#!/usr/bin/env node
/**
 * Empaqueta los motores de Word y Excel del Chat para las Tareas: `src/main/office/craft/chat-docx-cli.ts` (`renderChatDocx`, WordCraft) y
 * `chat-xlsx-cli.ts` (`renderChatGrid`, GridCraft) en un archivo CommonJS autocontenido por skill, que ejecuta cualquier Node (sin Electron ni
 * node_modules). Mismo patrón que `build-chat-deck.mjs`. Uso: `node scripts/build-chat-office.mjs`.
 * Escribe `resources/opencode/skills/docx/scripts/build_chat_docx.cjs` y `resources/opencode/skills/xlsx/scripts/build_chat_xlsx.cjs`
 * (generados: no se versionan; `npm run build`/`dev` los regenera; ya están bajo `asarUnpack` de las skills).
 */
import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TARGETS = [
  ['src/main/office/craft/chat-docx-cli.ts', 'resources/opencode/skills/docx/scripts/build_chat_docx.cjs'],
  ['src/main/office/craft/chat-xlsx-cli.ts', 'resources/opencode/skills/xlsx/scripts/build_chat_xlsx.cjs']
]

for (const [entry, out] of TARGETS) {
  await build({
    entryPoints: [resolve(root, entry)],
    outfile: resolve(root, out),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    alias: { '@shared': resolve(root, 'src/shared') },
    legalComments: 'none',
    logLevel: 'warning'
  })
  console.log(resolve(root, out))
}
