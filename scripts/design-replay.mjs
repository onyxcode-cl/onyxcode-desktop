#!/usr/bin/env node
/** Repite specs guardadas, sin modelo ni app, con el código y CLI indicados. */
import { build } from 'esbuild'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'

const argv = process.argv.slice(2)
const arg = (name) => argv[argv.indexOf(name) + 1]
if (!['--source', '--inputs', '--out', '--deckcraft'].every((key) => argv.includes(key))) {
  console.error('Uso: node scripts/design-replay.mjs --source árbol --inputs manifiesto.json --out carpeta-nueva --deckcraft CLI')
  process.exit(2)
}
const source = resolve(arg('--source'))
const inputFile = resolve(arg('--inputs'))
const out = resolve(arg('--out'))
const deckcraft = resolve(arg('--deckcraft'))
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const inputs = JSON.parse(await readFile(inputFile, 'utf8'))
// Carpeta nueva: conserva cada corrida y evita mezclar imágenes de versiones distintas.
await mkdir(out)
const temp = await mkdtemp(join(tmpdir(), 'lzx-design-replay-'))
const require = createRequire(import.meta.url)
try {
  const exports = [
    ['renderChatDeck,chatDeckCommands,foldSubtitles', 'src/main/office/craft/chat-deck.ts'],
    ['renderPreview', 'src/main/documents/preview.ts'],
    ['reviewDocument', 'src/main/documents/review.ts'],
    ['normalizeDocumentExtras', 'src/main/documents/normalize-extras.ts'],
    ['isPptxSpec', 'src/shared/chat-doc-spec.ts'],
    ['resolveDocumentIdentity', 'src/shared/document-identity.ts']
  ]
  const entry = exports.map(([names, path]) => `export {${names}} from ${JSON.stringify(join(source, path))};`).join('\n')
  const bundle = join(temp, 'replay.cjs')
  await build({
    stdin: { contents: entry, resolveDir: source, loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: bundle,
    alias: { '@shared': join(source, 'src/shared') },
    nodePaths: [resolve('node_modules')],
    logLevel: 'warning'
  })
  const api = require(bundle)
  const manifest = {
    source,
    rendererBundleSha256: sha(await readFile(bundle)),
    inputsSha256: sha(await readFile(inputFile)),
    cliSha256: sha(await readFile(deckcraft)),
    node: process.version,
    platform: process.platform,
    synthetic: false,
    method: 'Repetición de specs de una sesión previa; no se llama al modelo ni se abre la app.',
    documents: []
  }
  for (const sample of inputs.documents) {
    const { id, topic } = sample
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error('ID de muestra inválido')
    const raw = await readFile(resolve(dirname(inputFile), sample.spec))
    if (sample.sha256 && sha(raw) !== sample.sha256) throw new Error(id + ': cambió la spec de entrada')
    const normalized = api.normalizeDocumentExtras('pptx', JSON.parse(raw))
    const spec = normalized.spec
    if (!api.isPptxSpec(spec)) throw new Error(id + ': spec no válida para este armador')
    if (spec.slides.some((slide) => slide.image))
      throw new Error(id + ': esta repetición requiere specs sin fotos; no se omiten recursos silenciosamente')
    await writeFile(join(out, id + '-input.json'), raw)
    await writeFile(join(out, id + '-effective.json'), JSON.stringify(spec, null, 2) + '\n')
    await writeFile(join(out, id + '-identity.json'), JSON.stringify(api.resolveDocumentIdentity(api.foldSubtitles(spec)), null, 2) + '\n')
    const bytes = await api.renderChatDeck(deckcraft, spec, 90_000)
    await writeFile(join(out, id + '.pptx'), bytes)
    const preview = await api.renderPreview('pptx', bytes, { deckcraft, wordcraft: null }, { totalMs: 90_000 })
    if (!preview || preview.truncated || preview.images.length !== spec.slides.length) throw new Error(id + ': vista incompleta')
    for (let i = 0; i < preview.images.length; i++)
      await writeFile(join(out, `${id}-${String(i + 1).padStart(2, '0')}.png`), preview.images[i])
    const review = await api.reviewDocument('pptx', bytes, spec)
    await writeFile(join(out, id + '-revision.json'), JSON.stringify(review, null, 2) + '\n')
    await writeFile(join(out, id + '-commands.json'), JSON.stringify(api.chatDeckCommands(spec), null, 2) + '\n')
    manifest.documents.push({ id, topic, format: 'pptx', path: id + '.pptx', pages: preview.pages, review, warnings: normalized.warnings })
    await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    console.log(`${id}: ${preview.pages} láminas; revisión ${review.ok ? 'OK' : 'con hallazgos'}`)
  }
} finally {
  await rm(temp, { recursive: true, force: true })
}
