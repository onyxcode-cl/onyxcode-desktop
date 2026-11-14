#!/usr/bin/env node
/** Galería V26: seis entradas de ronda 2 + dos HTML. No publica ni abre la app instalada. */
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const arg = (name) => {
  const i = argv.indexOf(name)
  if (i < 0 || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Falta ${name}`)
  return resolve(argv[i + 1])
}
const docs = arg('--documents')
const deckcraft = arg('--deckcraft')
const out = arg('--out')
const nativeOnly = argv.includes('--native-only')
const run = promisify(execFile)
const temp = await mkdtemp(join(tmpdir(), 'lazunox-v26-gallery-'))
const results = []
const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
await mkdir(out) // exige destino nuevo: nunca sobrescribe una galería anterior.
try {
  const bundle = join(temp, 'render.cjs')
  await build({
    entryPoints: [join(root, 'src/main/office/craft/chat-deck.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    alias: { '@shared': join(root, 'src/shared') },
    logLevel: 'warning'
  })
  const { renderChatDeck } = createRequire(import.meta.url)(bundle)
  const topics = ['Solar', 'Dinosaurios', 'Pastelería', 'Clínica dental', 'Rock', 'Minera']
  for (const [i, topic] of topics.entries()) {
    const id = `d${i + 1}`
    const dir = join(out, id)
    await mkdir(dir)
    const source = join(docs, 'v1826/diseno-muestras/ronda2/specs', `${id}.json`)
    const spec = JSON.parse(await readFile(source, 'utf8'))
    await copyFile(source, join(dir, 'spec.json'))
    const pptx = join(dir, `${id}.pptx`)
    // Fixtures históricos de aceptación: conservan incluso el pie largo original de Rock.
    // Sin saneamiento que borre contenido para superar el esquema actual de entrada del modelo.
    await writeFile(pptx, await renderChatDeck(deckcraft, spec, 90_000), { flag: 'wx' })
    await run(deckcraft, ['render', pptx, '--all', '--scale', '1', join(dir, 'png')], { timeout: 90_000, maxBuffer: 1024 * 1024 })
    const pngs = (await readdir(join(dir, 'png'))).filter((name) => name.endsWith('.png')).sort()
    if (pngs.length !== spec.slides.length) throw new Error(`${topic}: ${pngs.length} imágenes para ${spec.slides.length} láminas`)
    results.push({
      id,
      topic,
      kind: 'PPTX nativo · DeckCraft CLI',
      count: pngs.length,
      pngs: pngs.map((name) => `${id}/png/${name}`),
      artifact: `${id}/${id}.pptx`
    })
    console.log(`${topic}: ${pngs.length} láminas renderizadas`)
  }
  for (const id of ['dinosaurios', 'rock']) {
    const dir = join(out, `html-${id}`)
    await mkdir(dir)
    const html = join(dir, `${id}.html`)
    await copyFile(join(docs, 'v1826/html-export/diseno', `${id}.html`), html)
    if (nativeOnly) {
      results.push({
        id: `html-${id}`,
        topic: `HTML · ${id}`,
        kind: 'Pendiente: no se ejecutó Electron',
        pngs: [],
        artifact: `html-${id}/${id}.html`
      })
      continue
    }
    // Captura real con el exportador de la app. El proceso usa userData temporal.
    await run(
      process.execPath,
      [join(root, 'scripts/verify-slides-4k.mjs'), '--html', html, '--out', join(dir, 'captura'), '--expected-slides', '5'],
      { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }
    )
    const pngs = (await readdir(join(dir, 'captura'))).filter((name) => name.endsWith('.png')).sort()
    if (pngs.length !== 5) throw new Error(`${id}: se esperaban cinco láminas, hay ${pngs.length}`)
    results.push({
      id: `html-${id}`,
      topic: `HTML · ${id}`,
      kind: 'HTML · captura real Electron 4K',
      count: pngs.length,
      pngs: pngs.map((name) => `html-${id}/captura/${name}`),
      artifact: `html-${id}/${id}.html`
    })
  }
} finally {
  await rm(temp, { recursive: true, force: true })
  await writeFile(
    join(out, 'manifest.json'),
    JSON.stringify(
      {
        created: new Date().toISOString(),
        visualApproval: false,
        note: 'Renderizar y contar no aprueba el diseño. Revisar sujeto, encuadre, jerarquía, ritmo, legibilidad y créditos. No se ha abierto PowerPoint.',
        results
      },
      null,
      2
    ) + '\n'
  )
  await writeFile(
    join(out, 'index.html'),
    `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Galería V26</title><style>body{font:17px system-ui;margin:32px;background:#f3f3ef;color:#19231f}h1,h2{line-height:1.2}.slides{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:18px}img{width:100%;display:block}figure{margin:0}figcaption{padding:8px 0}section{margin:42px 0}a{color:#17594f}</style><h1>Galería V26 · revisión pendiente</h1><p>Los seis temas conservan las entradas de la segunda ronda. Revisar todas las láminas: sujeto y encuadre, jerarquía del contenido, ritmo y crédito legible. Un cambio de paleta o la ausencia de desbordes no aprueban el diseño. Estas vistas no certifican PowerPoint ni Windows.</p>${results.map((r) => `<section><h2>${escape(r.topic)}</h2><p>${escape(r.kind)} · <a href="${escape(r.artifact)}">Abrir original</a></p><div class="slides">${r.pngs.map((src, i) => `<figure><a href="${escape(src)}"><img loading="lazy" src="${escape(src)}" alt="${escape(r.topic)} · lámina ${i + 1}"></a><figcaption>Lámina ${i + 1}</figcaption></figure>`).join('')}</div></section>`).join('')}</html>`
  )
}
console.log(join(out, 'index.html'))
