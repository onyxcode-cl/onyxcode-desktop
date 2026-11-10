#!/usr/bin/env node
// Set dorado de calidad de documentos (PowerPoint, Word, Excel, PDF) — medición REPETIBLE, sin IA y sin LibreOffice.
//
//   node scripts/golden-docs.mjs --setup                 # una vez: baja ArtCraft (con su sha256 de resources/craft/pin.json) y crea el Python de análisis
//   node scripts/golden-docs.mjs                         # corre los 20 casos y escribe el informe
//   node scripts/golden-docs.mjs --only d02,x03          # solo algunos (prefijo del id, separados por coma)
//   node scripts/golden-docs.mjs --baseline <golden-*.json>   # compara con una corrida anterior (antes/después)
//   node scripts/golden-docs.mjs --out <carpeta>         # dónde escribir (por defecto capturas-1-8-9/calidad-docs/golden junto al repo de respaldo)
//
// Qué hace por cada caso de scripts/golden-docs/cases.json: genera el archivo POR EL CAMINO DE LA APP (los mismos renderChatDeck /
// renderChatDocx / renderChatGrid empaquetados con esbuild —igual que los build_chat_*.cjs de las skills— con ArtCraft; el PDF sale de
// Chromium de Electron con las mismas opciones que renderHtmlToPdf), lo renderiza a imágenes con los programas de ArtCraft (PNG) y aplica:
//   · FILTROS DUROS (pasa/no pasa): se genera, abre (ZIP/XML válidos + `info` de ArtCraft, o PDF legible), cero errores de fórmula,
//     cero restos de plantilla.
//   · CONTEOS de defectos (menos es mejor): contenido pedido que no aparece, letra chica, fuera de la lámina/página, cajas de texto
//     montadas, última página casi vacía, tabla con el Total solo en la página siguiente, negrita contagiada, índice en inglés,
//     valor declarado de una fórmula distinto del calculado, nº de páginas/láminas fuera de lo esperado.
// No hay modelo de IA en el bucle: el contenido de cada caso es fijo, así que la corrida es DETERMINISTA y cualquier cambio entre noches
// viene de la app (guías/código/ArtCraft), no del azar. Un juez de IA con imágenes (otra familia de modelo) queda como paso opcional
// aparte: las hojas de contacto de `sheets/` son su entrada.
// Solo macOS (ArtCraft de macOS). No toca el repo ni el motor `lazunox-motor`; todo lo que escribe va a --out y a la caché.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HERE = join(ROOT, 'scripts', 'golden-docs')
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const flag = (n) => process.argv.includes(n)
const CACHE = arg('--cache', process.env.GOLDEN_HOME || join(homedir(), '.cache', 'lazunox-golden'))
// Python con PyMuPDF y Pillow: por defecto el Python incluido de la app (sin pip ni red). Se puede forzar con GOLDEN_PY.
const PY_BUNDLED = 'resources/python-bin/mac-arm64/python/bin/python3'
const PY = process.env.GOLDEN_PY || [join(ROOT, PY_BUNDLED), join(homedir(), '.lzx-work/v1813/app-int', PY_BUNDLED), join(CACHE, 'venv', 'bin', 'python')].find((p) => existsSync(p)) || join(CACHE, 'venv', 'bin', 'python')
// Los CLI empaquetados van a una carpeta propia de cada árbol de trabajo (varios árboles pueden correr a la vez).
const CLI_DIR = join(CACHE, 'cli-' + createHash('sha256').update(ROOT).digest('hex').slice(0, 8))
const node = process.execPath
const log = (...a) => console.log('[golden]', ...a)

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), ms: 0 }
}
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

// ───────────────────────── setup ─────────────────────────
function craftBin(tool) {
  const base = join(CACHE, 'craft', tool)
  if (!existsSync(base)) return null
  const d = readdirSync(base).find((x) => existsSync(join(base, x, `${tool}-cli`)))
  return d ? join(base, d, `${tool}-cli`) : null
}

async function setup() {
  mkdirSync(CACHE, { recursive: true })
  const pin = JSON.parse(readFileSync(join(ROOT, 'resources/craft/pin.json'), 'utf8'))
  const key = `${process.platform}-${process.arch}`
  for (const [tool, def] of Object.entries(pin.tools)) {
    if (craftBin(tool)) continue
    const a = def.assets[key]
    if (!a) throw new Error(`Sin binario de ${tool} para ${key}`)
    const dir = join(CACHE, 'craft', tool)
    mkdirSync(dir, { recursive: true })
    const zip = join(CACHE, 'craft', `${tool}.zip`)
    log('descargando', tool, a.url)
    const r = await fetch(a.url)
    if (!r.ok) throw new Error(`HTTP ${r.status} en ${a.url}`)
    writeFileSync(zip, Buffer.from(await r.arrayBuffer()))
    if (sha(zip) !== a.sha256) throw new Error(`sha256 de ${tool} no coincide con pin.json`)
    execFileSync('unzip', ['-q', '-o', zip, '-d', dir])
    try { execFileSync('xattr', ['-dr', 'com.apple.quarantine', dir]) } catch { /* sin atributo */ }
  }
  if (!existsSync(PY)) {
    log('creando Python de análisis (pymupdf, pillow)')
    execFileSync('python3', ['-m', 'venv', join(CACHE, 'venv')])
    execFileSync(PY, ['-m', 'pip', '-q', 'install', 'pymupdf', 'pillow'], { stdio: 'inherit' })
  }
  buildClis()
  log('listo en', CACHE)
}

function buildClis() {
  mkdirSync(CLI_DIR, { recursive: true })
  const esb = join(ROOT, 'node_modules/.bin/esbuild')
  const targets = { deck: 'chat-deck-cli', docx: 'chat-docx-cli', xlsx: 'chat-xlsx-cli' }
  for (const [k, f] of Object.entries(targets)) {
    const r = sh(esb, [join(ROOT, `src/main/office/craft/${f}.ts`), '--bundle', '--platform=node', '--target=node22', '--format=cjs',
      `--alias:@shared=${join(ROOT, 'src/shared')}`, `--outfile=${join(CLI_DIR, k + '.cjs')}`, '--log-level=warning'])
    if (r.code !== 0) throw new Error(`esbuild ${k}: ${r.out}`)
  }
}

// ───────────────────────── corrida ─────────────────────────
function gitInfo() {
  const g = (a) => { try { return execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' }).trim() } catch { return '?' } }
  return { commit: g(['rev-parse', '--short', 'HEAD']), branch: g(['rev-parse', '--abbrev-ref', 'HEAD']), dirty: g(['status', '--short', '--', 'src', 'resources']).length > 0 }
}

async function run() {
  const bins = { deckcraft: craftBin('deckcraft'), wordcraft: craftBin('wordcraft'), gridcraft: craftBin('gridcraft') }
  if (!bins.deckcraft || !bins.wordcraft || !bins.gridcraft || !existsSync(PY)) throw new Error('Falta ArtCraft o el Python de análisis: corre `node scripts/golden-docs.mjs --setup`.')
  buildClis() // siempre desde el código actual: así se mide la rama en la que estás
  const outRoot = resolve(arg('--out', join(CACHE, 'runs')))
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
  const label = arg('--label', gitInfo().branch.replace(/[^\w.-]/g, '_'))
  const runDir = join(outRoot, `${stamp}-${label}`)
  mkdirSync(join(runDir, 'files'), { recursive: true })
  const cases = JSON.parse(readFileSync(join(HERE, 'cases.json'), 'utf8'))
  const only = (arg('--only', '') || '').split(',').filter(Boolean)
  const list = cases.cases.filter((c) => only.length === 0 || only.some((p) => c.id.startsWith(p)))
  const env = { ...process.env, LAZUNOX_DECKCRAFT: bins.deckcraft, LAZUNOX_WORDCRAFT: bins.wordcraft, LAZUNOX_GRIDCRAFT: bins.gridcraft }
  const meta = { date: new Date().toISOString(), repo: gitInfo(), artcraft: JSON.parse(readFileSync(join(ROOT, 'resources/craft/pin.json'), 'utf8')).version, casesVersion: cases.version, node: process.version }

  // 1) generar
  const gen = {}
  const pdfCases = []
  for (const c of list) {
    const spec = join(HERE, c.file)
    const out = join(runDir, 'files', `${c.id}.${c.kind}`)
    const t0 = Date.now()
    if (c.kind === 'pdf') { pdfCases.push({ id: c.id, html: spec, out }); continue }
    const cli = { pptx: 'deck', docx: 'docx', xlsx: 'xlsx' }[c.kind]
    const r = sh(node, [join(CLI_DIR, cli + '.cjs'), spec, out], { env, timeout: 180000 })
    gen[c.id] = { ok: r.code === 0 && existsSync(out), error: r.code === 0 ? '' : r.out.slice(-300), ms: Date.now() - t0 }
    log(c.id, gen[c.id].ok ? 'generado' : 'no generó: ' + gen[c.id].error.slice(0, 80).replace(/\n/g, ' '))
  }
  if (pdfCases.length) {
    const electron = join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    for (const p of pdfCases) { // una ventana por ejecución: más lento pero evita el fallo de la segunda carga
      const t0 = Date.now()
      const r = sh(electron, [join(HERE, 'pdf-main.cjs')], { env: { ...process.env, GOLDEN_HTML: p.html, GOLDEN_OUT: p.out, GOLDEN_UD: join(CACHE, 'eprof') }, timeout: 120000 })
      gen[p.id] = { ok: existsSync(p.out), error: existsSync(p.out) ? '' : r.out.slice(-300), ms: Date.now() - t0 }
      log(p.id, gen[p.id].ok ? 'generado' : 'FALLÓ')
    }
  }

  // 2) renderizar + analizar (Python hace el trabajo con los programas de ArtCraft)
  const results = []
  for (const c of list) {
    const t0 = Date.now()
    const file = join(runDir, 'files', `${c.id}.${c.kind}`)
    const imgDir = join(runDir, 'png', c.id)
    mkdirSync(imgDir, { recursive: true })
    let metrics
    if ((c.tags || []).includes('espera-rechazo')) {
      const rejected = !gen[c.id].ok && /ERROR en el contenido/.test(gen[c.id].error)
      metrics = { gen_ok: false, pass: rejected, hard: { rechaza_con_mensaje: rejected }, defects: { rechazo_total_por_un_dato: 1 }, notes: [gen[c.id].error.replace(/\s+/g, ' ').slice(0, 220)] }
    } else if (!gen[c.id].ok) metrics = { gen_ok: false, pass: false, hard: { genera: false }, defects: {}, notes: [gen[c.id].error] }
    else {
      const r = sh(PY, ['-I', join(HERE, 'analyze.py'), JSON.stringify({ case: c, spec: join(HERE, c.file), file, imgDir, bins })], { env, timeout: 300000 })
      try { metrics = JSON.parse(r.out.slice(r.out.indexOf('{'))) } catch { metrics = { gen_ok: true, hard: { analiza: false }, defects: {}, notes: ['analyze.py falló: ' + r.out.slice(-400)] } }
    }
    metrics.gen_ms = gen[c.id].ms
    metrics.analyze_ms = Date.now() - t0
    metrics.sha256 = existsSync(file) ? sha(file).slice(0, 16) : null
    results.push({ id: c.id, kind: c.kind, title: c.title, tags: c.tags, ...metrics })
    log(c.id, metrics.pass ? 'PASA' : 'NO PASA', JSON.stringify(metrics.defects))
  }

  // 3) hojas de contacto (entrada de un juez de IA o de una mirada humana)
  sh(PY, ['-I', join(HERE, 'sheets.py'), join(runDir, 'png'), join(runDir, 'sheets')])

  // 4) informe
  const summary = summarize(results)
  const report = { meta, summary, results }
  writeFileSync(join(runDir, 'golden.json'), JSON.stringify(report, null, 1))
  const baselinePath = arg('--baseline', '')
  const baseline = baselinePath && existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null
  const md = markdown(report, baseline, baselinePath)
  writeFileSync(join(runDir, 'golden.md'), md)
  copyFileSync(join(runDir, 'golden.json'), join(outRoot, 'golden-latest.json'))
  copyFileSync(join(runDir, 'golden.md'), join(outRoot, 'golden-latest.md'))
  log('informe:', join(runDir, 'golden.md'))
  console.log(md.split('\n').slice(0, 40).join('\n'))
  if (flag('--fail-on-hard') && summary.hardFailed > 0) process.exitCode = 1
}

function summarize(rs) {
  const byKind = {}
  let total = 0
  for (const r of rs) {
    const d = Object.values(r.defects || {}).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0)
    r.defect_total = d
    total += d
    const k = (byKind[r.kind] ||= { n: 0, pass: 0, defects: 0 })
    k.n++; if (r.pass) k.pass++; k.defects += d
  }
  const pass = rs.filter((r) => r.pass).length
  return { cases: rs.length, pass, passRate: rs.length ? +(pass / rs.length).toFixed(3) : 0, hardFailed: rs.length - pass, defectsTotal: total, defectsPerDoc: rs.length ? +(total / rs.length).toFixed(2) : 0, byKind }
}

function markdown(rep, base, basePath) {
  const L = []
  const s = rep.summary
  L.push(`# Set dorado de documentos — ${rep.meta.date.slice(0, 16).replace('T', ' ')}`)
  L.push('', `Rama \`${rep.meta.repo.branch}\` @ \`${rep.meta.repo.commit}\`${rep.meta.repo.dirty ? ' (con cambios sin commit)' : ''} · ArtCraft ${rep.meta.artcraft} · casos v${rep.meta.casesVersion} · determinista (sin IA en el bucle).`)
  L.push('', `**Aprobados (filtros duros): ${s.pass}/${s.cases} (${Math.round(s.passRate * 100)} %) · Defectos por documento: ${s.defectsPerDoc} · Total de defectos: ${s.defectsTotal}**`)
  if (base) L.push('', `Comparado con \`${basePath.split('/').slice(-2).join('/')}\`: aprobados ${base.summary.pass}/${base.summary.cases} → ${s.pass}/${s.cases}; defectos/doc ${base.summary.defectsPerDoc} → ${s.defectsPerDoc}.`)
  L.push('', '| Formato | Casos | Aprobados | Defectos |', '|---|---|---|---|')
  for (const [k, v] of Object.entries(s.byKind)) L.push(`| ${k} | ${v.n} | ${v.pass} | ${v.defects} |`)
  L.push('', '## Por caso', '', '| Caso | Pasa | Defectos | Detalle |', '|---|---|---|---|')
  const bmap = base ? Object.fromEntries(base.results.map((r) => [r.id, r])) : {}
  for (const r of rep.results) {
    const det = Object.entries(r.defects || {}).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(', ') || '—'
    const hard = Object.entries(r.hard || {}).filter(([, v]) => v === false).map(([k]) => k).join(', ')
    const b = bmap[r.id]
    const delta = b ? ` (antes ${b.defect_total ?? '?'}${b.pass !== r.pass ? `, antes ${b.pass ? 'pasaba' : 'no pasaba'}` : ''})` : ''
    L.push(`| ${r.id} | ${r.pass ? '✅' : '❌ ' + hard} | ${r.defect_total}${delta} | ${det} |`)
  }
  const notes = rep.results.filter((r) => (r.notes || []).length)
  if (notes.length) { L.push('', '## Notas'); for (const r of notes) for (const n of r.notes) L.push(`- **${r.id}**: ${n}`) }
  L.push('', '## Qué mide y qué no', '- Filtros duros: se genera, abre, 0 errores de fórmula, 0 restos de plantilla.', '- Conteos: ver cabecera del script. No mide contraste de color, jerarquía ni estética: para eso, las hojas de contacto en `sheets/` (juez de IA de otra familia o mirada humana).', '- El render es el de ArtCraft, no PowerPoint/Word/Excel reales; no incluye Windows.')
  return L.join('\n') + '\n'
}

if (flag('--setup')) await setup()
else await run()
