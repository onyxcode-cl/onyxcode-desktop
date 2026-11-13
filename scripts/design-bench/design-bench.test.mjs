import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import JSZip from 'jszip'
import { CASES, makePrompt } from './cases.mjs'
import { pptxFingerprint, docxFingerprint, pdfLayoutFingerprint, compare, summarize } from './measure.mjs'
import { syntheticPptx, syntheticDocx, syntheticPdfLayout, writeSynthetic } from './synthetic.mjs'
import { parseArgs, extractSource, usage, aggregateUsage, measureManifest, validateComparison } from './run.mjs'

test('diez pedidos concretos cubren tres formatos y conservan datos y marca', () => {
  assert.equal(CASES.length, 10)
  assert.equal(new Set(CASES.map((c) => c.topic)).size, 10)
  for (const item of CASES)
    for (const format of ['pptx', 'docx', 'pdf']) {
      const prompt = makePrompt(item, format, 'GUÍA DE CONTROL')
      assert.match(prompt, /GUÍA DE CONTROL/)
      for (const fact of item.facts) assert.ok(prompt.includes(fact))
      assert.match(prompt, /No uses herramientas/)
    }
  assert.match(makePrompt(CASES[9], 'docx', ''), /brand-logo.png/)
})

test('PPTX normaliza por completo el texto sin confundirlo con diversidad', async () => {
  const a = await pptxFingerprint(await syntheticPptx('Museo de la costa'))
  const b = await pptxFingerprint(await syntheticPptx('Finanzas 123'))
  assert.equal(compare(a, b).score, 1)
  assert.deepEqual(a.pages, b.pages)
  assert.equal(JSON.stringify(a).includes('Museo'), false)
})

test('PPTX distingue paleta, fuentes, geometría y secuencia finales', async () => {
  const a = await pptxFingerprint(await syntheticPptx('Tema', 0))
  const b = await pptxFingerprint(await syntheticPptx('Tema', 4))
  const result = compare(a, b)
  for (const key of ['palette', 'fonts', 'geometry', 'sequence']) assert.ok(result[key] < 1, key)
  assert.ok(result.score < 0.88)
  assert.equal(compare(a, b).score, compare(b, a).score)
})

test('la secuencia sigue relaciones y orden del documento, no el nombre del archivo', async () => {
  const bytes = await syntheticPptx('Tema', 1),
    zip = await JSZip.loadAsync(bytes)
  const before = await pptxFingerprint(bytes)
  const presentation = await zip.file('ppt/presentation.xml').async('string')
  zip.file(
    'ppt/presentation.xml',
    presentation.replace('r:id="rId1"', 'r:id="TEMP"').replace('r:id="rId2"', 'r:id="rId1"').replace('r:id="TEMP"', 'r:id="rId2"')
  )
  const after = await pptxFingerprint(await zip.generateAsync({ type: 'nodebuffer' }))
  assert.deepEqual(after.sequence, before.sequence.toReversed())
  assert.ok(compare(before, after).sequence < 1)
})

test('DOCX usa fuentes y colores efectivos de estilos, sin contar texto', async () => {
  const a = await docxFingerprint(await syntheticDocx('Informe', 1))
  const b = await docxFingerprint(await syntheticDocx('Otro contenido 999', 1))
  assert.equal(compare(a, b).score, 1)
  assert.ok(a.fonts.georgia > 0)
  assert.ok(a.palette['384938'] > 0)
  assert.match(a.coverage, /NO son coordenadas paginadas/)
  const c = await docxFingerprint(await syntheticDocx('Informe', 3))
  assert.ok(compare(a, c).geometry < 1)
})

test('PDF descarta texto y explicita qué componentes no mide', () => {
  const a = pdfLayoutFingerprint(syntheticPdfLayout('Marino', 1))
  const b = pdfLayoutFingerprint(syntheticPdfLayout('Corporativo', 1))
  assert.equal(compare(a, b).score, 1)
  assert.match(a.coverage, /no incluye fondos/)
  assert.throws(() => pdfLayoutFingerprint('<pdf2xml/>'), /No hay páginas/)
})

test('solo compara temas diferentes dentro de cada formato', async () => {
  const fp = await pptxFingerprint(await syntheticPptx('A'))
  const doc = await docxFingerprint(await syntheticDocx('B'))
  const report = summarize([
    { id: '1', topic: 'A', fingerprint: fp },
    { id: '2', topic: 'A', fingerprint: fp },
    { id: '3', topic: 'B', fingerprint: fp },
    { id: '4', topic: 'B', fingerprint: doc }
  ])
  assert.equal(report.pairs.length, 2)
  assert.ok(report.pairs.every((p) => p.nearDuplicate))
  assert.throws(() => compare(fp, doc), /mismo formato/)
})

test('eventos extraen la fuente única y registran costo desconocido como null', () => {
  assert.equal(extractSource([{ type: 'text', part: { text: '```pptx\n{"slides":[]}\n```' } }], 'pptx'), '{"slides":[]}')
  assert.throws(() => extractSource([{ type: 'text', part: { text: 'sin bloque' } }], 'docx'), /Se esperaba/)
  assert.throws(() => extractSource([{ type: 'text', part: { text: '```docx\n{}\n```\n```docx\n{}\n```' } }], 'docx'), /recibidos 2/)
  assert.equal(usage([]).reportedCost, null)
  assert.deepEqual(
    usage([{ type: 'step_finish', part: { cost: 0.12, tokens: { input: 100, output: 50, cache: { read: 20, write: 5 } } } }]),
    { input: 100, output: 50, cacheRead: 20, cacheWrite: 5, steps: 1, toolCalls: 0, reportedCost: 0.12, visionTokens: null, corrections: 0 }
  )
})

test('llamar al modelo exige las dos opciones explícitas antes de cualquier proceso', () => {
  for (const args of [[], ['--real'], ['--allow-model']]) {
    const result = spawnSync(process.execPath, ['scripts/design-bench/run.mjs', 'run', ...args], { encoding: 'utf8', timeout: 10000 })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /No se llama al modelo/)
  }
  assert.throws(() => parseArgs(['run', '--repeats', '0']), /entero positivo/)
})

test('autoprueba completa: 30 fixtures, 135 pares y diferencia al cambiar diseño', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lazunox-design-test-'))
  try {
    await writeSynthetic(join(dir, 'same'), 'same')
    await writeSynthetic(join(dir, 'diverse'), 'diverse')
    const before = await measureManifest(join(dir, 'same/manifest.json'))
    const after = await measureManifest(join(dir, 'diverse/manifest.json'))
    validateComparison(before, after)
    assert.equal(before.documents.length, 30)
    assert.equal(before.failures.length, 0)
    assert.equal(before.pairs.length, 135)
    for (const format of ['pptx', 'docx', 'pdf']) {
      assert.equal(before.byFormat[format].nearDuplicates, 45)
      assert.ok(after.byFormat[format].nearDuplicates < 45)
    }
    assert.throws(() => validateComparison(before, { ...after, documents: after.documents.slice(1) }), /Cohortes distintas/)
    assert.throws(() => validateComparison(before, { ...after, failures: [{ id: 'missing' }] }), /mediciones fallidas/)
    assert.throws(() => validateComparison(before, { ...after, threshold: 0.95 }), /umbral diferentes/)
    assert.throws(() => validateComparison(before, { ...after, synthetic: false }), /fixtures sintéticos/)
    assert.throws(
      () => validateComparison(before, { ...after, documents: after.documents.map((d, i) => (i ? d : { ...d, topic: 'otro' })) }),
      /Cohortes distintas/
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('fallos de generación persisten al volver a medir el manifiesto', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lazunox-design-fail-'))
  try {
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ documents: [], failures: [{ id: 'D01', error: 'render falló' }] }))
    assert.equal((await measureManifest(join(dir, 'manifest.json'))).failures[0].id, 'D01')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test(
  'comando real completo con motor de respuesta fijo y DeckCraft/WordCraft reales, sin modelo',
  { skip: !process.env.DECKCRAFT_CLI || !process.env.WORDCRAFT_CLI, timeout: 90000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lazunox-design-cli-'))
    try {
      const motor = join(dir, 'fake-motor'),
        out = join(dir, 'results')
      const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'"
      const code = `#!/bin/sh\n':' //; exec ${quote(process.execPath)} "$0" "$@"\nconst fs = require('node:fs');\nif (process.argv.includes('--version')) { console.log('fixture-no-network-1'); process.exit(0) }\nconst prompt = fs.readFileSync(0, 'utf8');\nconst pptx = prompt.includes('Devuelve una presentación editable');\nconst spec = pptx ? { slides: Array.from({length:6}, (_,i) => ({title:'Museo marino '+i, bullets:['Doce playas observadas','Cuatro humedales'],layout:i===0?'cover':'bullets'})) } : {title:'Museo marino',blocks:[{type:'heading',level:1,text:'Conservación'},{type:'paragraph',text:'El museo observa doce playas y cuatro humedales.'}]};\nconsole.log(JSON.stringify({type:'text',part:{text:'\x60\x60\x60'+(pptx?'pptx':'docx')+'\\n'+JSON.stringify(spec)+'\\n\x60\x60\x60'}}));\nconsole.log(JSON.stringify({type:'step_finish',part:{cost:0,tokens:{input:100,output:50}}}));\n`
      await writeFile(motor, code)
      await chmod(motor, 0o700)
      const result = spawnSync(
        process.execPath,
        [
          'scripts/design-bench/run.mjs',
          'run',
          '--real',
          '--allow-model',
          '--motor',
          motor,
          '--model',
          'fixture/no-network',
          '--cases',
          'D01',
          '--formats',
          'pptx,docx',
          '--repeats',
          '1',
          '--timeout',
          '20',
          '--deckcraft',
          process.env.DECKCRAFT_CLI,
          '--wordcraft',
          process.env.WORDCRAFT_CLI,
          '--out',
          out
        ],
        { encoding: 'utf8', timeout: 80000, maxBuffer: 5 * 1024 * 1024 }
      )
      if (result.status !== 0) {
        let detail = ''
        try {
          detail = await readFile(join(out, 'runs.json'), 'utf8')
        } catch {}
        assert.fail(result.stderr + result.stdout + detail)
      }
      const metadata = JSON.parse(await readFile(join(out, 'bench.json'), 'utf8'))
      assert.equal(metadata.motorVersion, 'fixture-no-network-1')
      assert.equal(metadata.rendererBundleSha256.length, 64)
      const runs = JSON.parse(await readFile(join(out, 'runs.json'), 'utf8'))
      assert.equal(runs.length, 2)
      assert.ok(runs.every((r) => r.status === 'rendered' && r.reportedCost === 0))
      const measured = JSON.parse(await readFile(join(out, 'similarity.json'), 'utf8'))
      assert.equal(measured.documents.length, 2)
      assert.equal(measured.failures.length, 0)
      for (const run of runs)
        assert.equal(await readFile(join(out, run.id, 'initial.json'), 'utf8'), await readFile(join(out, run.id, 'final.json'), 'utf8'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
)

test('resumen de costo publica mediana/p90 sin transformar costo ausente en cero', () => {
  const out = aggregateUsage([
    { format: 'pptx', status: 'rendered', output: 10, reportedCost: null },
    { format: 'pptx', status: 'failed', output: 30, reportedCost: null }
  ])
  assert.deepEqual(out.pptx.metrics.output, { count: 2, median: 20, p90: 30 })
  assert.deepEqual(out.pptx.metrics.reportedCost, { count: 0, median: null, p90: null })
  assert.equal(out.pptx.attempted, 2)
  assert.equal(out.pptx.rendered, 1)
})
