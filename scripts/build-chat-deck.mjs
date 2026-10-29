#!/usr/bin/env node
/**
 * Empaqueta `src/main/office/craft/chat-deck-cli.ts` (el motor de presentaciones del Chat, `chatDeckCommands` + `runCraft`) en UN archivo
 * CommonJS autocontenido que ejecuta cualquier Node (sin Electron ni node_modules). Uso: `node scripts/build-chat-deck.mjs [--out ruta.cjs]`.
 * Por defecto escribe `resources/opencode/skills/pptx/scripts/build_chat_deck.cjs` (generado: no se versiona; `npm run build`/`dev` lo
 * regenera; ya está bajo `asarUnpack` de las skills y la app lo copia con el resto de la skill a `userData/opencode-config/skills`).
 */
import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const i = process.argv.indexOf('--out')
const outfile = i > 0 ? resolve(process.argv[i + 1]) : resolve(root, 'resources/opencode/skills/pptx/scripts/build_chat_deck.cjs')

await build({
  entryPoints: [resolve(root, 'src/main/office/craft/chat-deck-cli.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  alias: { '@shared': resolve(root, 'src/shared') },
  legalComments: 'none',
  logLevel: 'warning'
})
console.log(outfile)
