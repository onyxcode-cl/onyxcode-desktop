#!/usr/bin/env node
import { readFile, writeFile, mkdir, mkdtemp, rm, copyFile, stat, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { CASES, FORMATS, makePrompt } from './cases.mjs'
import { fingerprint, summarize, METRIC_VERSION } from './measure.mjs'
import { writeSynthetic } from './synthetic.mjs'

const here = dirname(fileURLToPath(import.meta.url)),
  repo = resolve(here, '../..')
const hash = (value) => createHash('sha256').update(value).digest('hex')
const json = async (file) => JSON.parse(await readFile(file, 'utf8'))
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })

export function parseArgs(argv) {
  const out = { command: argv[0] ?? 'help', repeats: 3, timeout: 300, budget: 100000, threshold: 0.88, guides: [] }
  const flags = new Set(['allow-model', 'real'])
  const options = new Set([
    'out',
    'manifest',
    'before',
    'after',
    'motor',
    'model',
    'auth-file',
    'provider-config',
    'deckcraft',
    'wordcraft',
    'python',
    'chromium',
    'assets',
    'pdftohtml',
    'source-root',
    'guides-root',
    'cases',
    'formats',
    'variant',
    'repeats',
    'timeout',
    'budget',
    'threshold',
    'guide'
  ])
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '')
    if (flags.has(key)) out[key] = true
    else if (options.has(key)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Falta valor de --' + key)
      const value = argv[++i]
      if (key === 'guide') out.guides.push(resolve(value))
      else out[key] = ['repeats', 'timeout', 'budget', 'threshold'].includes(key) ? Number(value) : value
    } else throw new Error('Opción desconocida: ' + argv[i])
  }
  for (const key of ['repeats', 'timeout', 'budget'])
    if (!Number.isInteger(out[key]) || out[key] < 1) throw new Error('--' + key + ' debe ser entero positivo')
  if (!(out.threshold > 0 && out.threshold <= 1)) throw new Error('--threshold debe estar entre 0 y 1')
  return out
}

export function extractSource(events, format) {
  const text = events
    .filter((e) => e.type === 'text')
    .map((e) => e.part?.text ?? e.text ?? '')
    .join('\n')
  const tag = format === 'pdf' ? 'html' : format
  const candidates = [...text.matchAll(/```([a-z]*)[^\n]*\n([\s\S]*?)```/gi)]
    .filter((m) => m[1].toLowerCase() === tag || (format !== 'pdf' && m[1].toLowerCase() === 'json'))
    .map((m) => m[2].trim())
  if (candidates.length !== 1) throw new Error(`Se esperaba un bloque ${tag}; recibidos ${candidates.length}`)
  if (format !== 'pdf') JSON.parse(candidates[0])
  if (Buffer.byteLength(candidates[0]) > 5 * 1024 * 1024) throw new Error('Fuente demasiado grande')
  return candidates[0]
}

export function usage(events) {
  let input = 0,
    output = 0,
    cacheRead = 0,
    cacheWrite = 0,
    steps = 0,
    cost = 0,
    hasCost = false
  for (const event of events)
    if (event.type === 'step_finish') {
      const t = event.part?.tokens ?? {}
      steps++
      input += t.input ?? 0
      output += t.output ?? 0
      cacheRead += t.cache?.read ?? 0
      cacheWrite += t.cache?.write ?? 0
      if (typeof event.part?.cost === 'number') {
        hasCost = true
        cost += event.part.cost
      }
    }
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    steps,
    toolCalls: events.filter((e) => e.type === 'tool_use').length,
    reportedCost: hasCost ? cost : null,
    visionTokens: null,
    corrections: 0
  }
}

export function aggregateUsage(runs) {
  const stats = (values) => {
    const sorted = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b)
    if (!sorted.length) return { count: 0, median: null, p90: null }
    const middle = Math.floor(sorted.length / 2)
    return {
      count: sorted.length,
      median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
      p90: sorted[Math.ceil(sorted.length * 0.9) - 1]
    }
  }
  return Object.fromEntries(
    FORMATS.map((format) => {
      const group = runs.filter((r) => r.format === format)
      return [
        format,
        {
          attempted: group.length,
          rendered: group.filter((r) => r.status === 'rendered').length,
          metrics: Object.fromEntries(
            ['input', 'output', 'cacheRead', 'cacheWrite', 'steps', 'toolCalls', 'modelMs', 'renderMs', 'reportedCost', 'corrections'].map(
              (key) => [key, stats(group.map((r) => r[key]))]
            )
          )
        }
      ]
    })
  )
}

export async function measureManifest(manifestPath, options = {}) {
  const manifest = await json(manifestPath),
    base = dirname(manifestPath),
    measured = [],
    failures = [...(manifest.failures ?? [])]
  if (!Array.isArray(manifest.documents)) throw new Error('El manifiesto necesita documents[]')
  for (const document of manifest.documents) {
    try {
      const file = resolve(base, document.path)
      const fp = await fingerprint(file, document.format, options)
      measured.push({ ...document, sha256: hash(await readFile(file)), fingerprint: fp })
    } catch (error) {
      failures.push({ id: document.id, error: String(error.message) })
    }
  }
  return { ...summarize(measured, options.threshold), synthetic: manifest.synthetic ?? false, documents: measured, failures }
}

async function requireFile(file, name) {
  if (!file || !(await stat(resolve(file))).isFile()) throw new Error('Falta archivo válido: ' + name)
  return resolve(file)
}

async function realRun(options) {
  if (!options.real || !options['allow-model']) throw new Error('No se llama al modelo sin ambas opciones: --real --allow-model')
  if (!options.model || !options.out) throw new Error('Se requieren --model y --out')
  const formats = options.formats?.split(',') ?? FORMATS
  if (formats.some((f) => !FORMATS.includes(f))) throw new Error('Formatos permitidos: pptx,docx,pdf')
  const requested = options.cases?.split(',') ?? CASES.map((c) => c.id)
  if (requested.some((id) => !CASES.some((c) => c.id === id))) throw new Error('Caso desconocido')
  const selected = CASES.filter((c) => requested.includes(c.id))
  const motor = await requireFile(options.motor, '--motor')
  const sourceRoot = resolve(options['source-root'] ?? repo),
    guidesRoot = resolve(options['guides-root'] ?? sourceRoot)
  const rendererOptions = { pdfScript: join(sourceRoot, 'resources/opencode/skills/pdf/scripts/build_chat_pdf.py') }
  if (formats.includes('pptx')) rendererOptions.deckcraft = await requireFile(options.deckcraft, '--deckcraft')
  if (formats.includes('docx')) rendererOptions.wordcraft = await requireFile(options.wordcraft, '--wordcraft')
  if (formats.includes('pdf')) {
    rendererOptions.python = await requireFile(options.python, '--python')
    if (options.chromium) rendererOptions.chromium = await requireFile(options.chromium, '--chromium')
    const poppler = spawnSync(options.pdftohtml ?? 'pdftohtml', ['-v'], { encoding: 'utf8', timeout: 10000 })
    if (poppler.error || poppler.status !== 0) throw new Error('Instala Poppler/pdftohtml antes de gastar llamadas en PDF')
  }
  const assets = []
  if (selected.some((c) => c.id === 'D10'))
    for (const name of ['brand-logo.png', 'brand-photo.jpg']) {
      if (!options.assets) throw new Error('D10 requiere --assets con brand-logo.png y brand-photo.jpg aportados por la persona')
      const file = await requireFile(join(options.assets, name), name)
      assets.push({ name, file, sha256: hash(await readFile(file)) })
    }
  const config = options['provider-config'] ? await json(options['provider-config']) : {}
  // Only provider/model connection settings are accepted. A benchmark cannot smuggle plugins or tools through config.
  if (Object.keys(config).some((key) => key !== 'provider')) throw new Error('--provider-config acepta únicamente {provider:{…}}')
  const auth = options['auth-file'] ? await requireFile(options['auth-file'], '--auth-file') : null
  const guideSets = {}
  for (const format of formats) {
    const files = options.guides.length
      ? options.guides
      : [join(guidesRoot, 'resources/opencode/agents/chat.md'), join(guidesRoot, `resources/opencode/skills/${format}/SKILL.md`)]
    guideSets[format] = {
      files: files.map((p) => p.replace(guidesRoot, '<guides>')),
      content: (await Promise.all(files.map((p) => readFile(p, 'utf8')))).join('\n\n')
    }
  }
  const out = resolve(options.out)
  await mkdir(out, { recursive: true })
  try {
    await access(join(out, 'bench.json'))
    throw new Error('La salida ya contiene una tanda; usa otra carpeta')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const tmp = await mkdtemp(join(tmpdir(), 'lazunox-design-bench-'))
  try {
    const bundle = join(tmp, 'render.cjs')
    await build({
      entryPoints: [join(here, 'render.ts')],
      outfile: bundle,
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      alias: { '@shared': join(sourceRoot, 'src/shared') },
      plugins: [
        {
          name: 'selected-engine',
          setup(b) {
            b.onResolve({ filter: /^\.\.\/\.\.\/src\// }, (args) => ({
              path: resolve(sourceRoot, args.path.replace(/^\.\.\/\.\.\//, '')) + '.ts'
            }))
          }
        }
      ],
      logLevel: 'silent'
    })
    const render = createRequire(import.meta.url)(bundle).renderDesignFile
    const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8', timeout: 10000 })
    const version = spawnSync(motor, ['--version'], { encoding: 'utf8', timeout: 10000 })
    const metadata = {
      schema: 1,
      started: new Date().toISOString(),
      model: options.model,
      repeats: options.repeats,
      formats,
      cases: selected.map((c) => c.id),
      mode: 'compact-spec-no-tools',
      sourceCommit: git.status === 0 ? git.stdout.trim() : null,
      rendererBundleSha256: hash(await readFile(bundle)),
      rendererBundleIncludesUncommittedChanges: true,
      motorSha256: hash(await readFile(motor)),
      motorVersion: version.status === 0 ? version.stdout.trim() : null,
      node: process.version,
      platform: process.platform,
      metricVersion: METRIC_VERSION,
      threshold: options.threshold,
      guideSha256: Object.fromEntries(formats.map((f) => [f, hash(guideSets[f].content)])),
      assets: assets.map(({ name, sha256 }) => ({ name, sha256 })),
      timeoutSeconds: options.timeout,
      tokenBudget: options.budget,
      limits: [
        'Sin revisión/reparación con modelo: initial y final coinciden.',
        'DOCX mide flujo OOXML, no paginación Office.',
        'Preferencia a ciegas, integridad de contenido y apertura Windows requieren revisión aparte.'
      ]
    }
    await save(join(out, 'bench.json'), metadata)
    const documents = [],
      runs = []
    for (const item of selected)
      for (const format of formats)
        for (let rep = 1; rep <= options.repeats; rep++) {
          const id = `${item.id}-${format}-r${String(rep).padStart(2, '0')}`,
            dir = join(out, id)
          await mkdir(dir) // no reuse, no overwrite
          await mkdir(join(dir, 'assets'))
          for (const asset of assets) await copyFile(asset.file, join(dir, 'assets', asset.name))
          const sessionRoot = join(tmp, id),
            work = join(sessionRoot, 'work')
          await mkdir(work, { recursive: true })
          for (const sub of ['.config', '.local/share/opencode', '.cache', '.local/state', 'tmp'])
            await mkdir(join(sessionRoot, sub), { recursive: true })
          if (auth) await copyFile(auth, join(sessionRoot, '.local/share/opencode/auth.json'))
          const prompt = makePrompt(item, format, guideSets[format].content)
          await writeFile(join(dir, 'prompt.txt'), prompt, { flag: 'wx' })
          const env = {
            PATH: process.env.PATH,
            LANG: 'C.UTF-8',
            HOME: sessionRoot,
            USERPROFILE: sessionRoot,
            TMPDIR: join(sessionRoot, 'tmp'),
            TMP: join(sessionRoot, 'tmp'),
            TEMP: join(sessionRoot, 'tmp'),
            ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
            XDG_CONFIG_HOME: join(sessionRoot, '.config'),
            XDG_DATA_HOME: join(sessionRoot, '.local/share'),
            XDG_CACHE_HOME: join(sessionRoot, '.cache'),
            XDG_STATE_HOME: join(sessionRoot, '.local/state'),
            OPENCODE_DISABLE_AUTOUPDATE: '1',
            OPENCODE_DISABLE_MODELS_FETCH: '1',
            OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
            OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
            OPENCODE_DISABLE_SHARE: '1',
            OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
              ...config,
              autoupdate: false,
              share: 'disabled',
              model: options.model,
              small_model: options.model,
              permission: { '*': 'deny' }
            })
          }
          const start = Date.now()
          const result = spawnSync(
            motor,
            [
              'run',
              '--format',
              'json',
              '--permisos',
              'ninguno',
              '--max-steps',
              '2',
              '--presupuesto-tokens',
              String(options.budget),
              '--model',
              options.model
            ],
            { cwd: work, env, input: prompt, encoding: 'utf8', timeout: options.timeout * 1000, maxBuffer: 32 * 1024 * 1024 }
          )
          const events = (result.stdout ?? '')
            .split('\n')
            .filter(Boolean)
            .flatMap((line) => {
              try {
                return [JSON.parse(line)]
              } catch {
                return []
              }
            })
          await writeFile(join(dir, 'events.jsonl'), result.stdout ?? '', { flag: 'wx' })
          await writeFile(join(dir, 'stderr.txt'), result.stderr ?? '', { flag: 'wx' })
          const run = { id, topic: item.topic, format, modelMs: Date.now() - start, ...usage(events), status: 'failed' }
          try {
            if (result.error || result.status !== 0) throw new Error(result.error?.message ?? `Motor terminó con ${result.status}`)
            if (events.some((e) => e.type === 'error')) throw new Error('El motor informó error; revisar events.jsonl')
            const source = extractSource(events, format),
              ext = format === 'pdf' ? 'html' : 'json'
            await writeFile(join(dir, `initial.${ext}`), source, { flag: 'wx' })
            const final = join(dir, `final.${ext}`)
            await writeFile(final, source, { flag: 'wx' })
            const output = join(dir, `document.${format}`),
              renderStart = Date.now()
            await render(format, final, output, rendererOptions)
            run.renderMs = Date.now() - renderStart
            const fp = await fingerprint(output, format, options)
            await save(join(dir, 'fingerprint.json'), fp)
            run.status = 'rendered'
            run.sha256 = hash(await readFile(output))
            documents.push({ id, topic: item.topic, format, path: `${id}/document.${format}` })
          } catch (error) {
            run.error = error.message
          }
          runs.push(run)
          await save(join(dir, 'run.json'), run)
          await rm(sessionRoot, { recursive: true, force: true })
          console.log(`${id}: ${run.status}`)
        }
    await save(join(out, 'runs.json'), runs)
    await save(join(out, 'usage-summary.json'), aggregateUsage(runs))
    await save(join(out, 'manifest.json'), {
      synthetic: false,
      documents,
      failures: runs.filter((r) => r.status !== 'rendered').map((r) => ({ id: r.id, error: r.error }))
    })
    const summary = await measureManifest(join(out, 'manifest.json'), options)
    summary.attempted = runs.length
    summary.rendered = documents.length
    await save(join(out, 'similarity.json'), summary)
    return { output: out, rendered: documents.length, attempted: runs.length, failures: runs.filter((r) => r.status !== 'rendered').length }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

export function validateComparison(before, after) {
  if (before.metricVersion !== after.metricVersion || before.threshold !== after.threshold)
    throw new Error('Métrica o umbral diferentes: repetir medición con parámetros idénticos')
  if (before.failures?.length || after.failures?.length) throw new Error('Hay mediciones fallidas; no comparar una cohorte incompleta')
  if (Boolean(before.synthetic) !== Boolean(after.synthetic)) throw new Error('No comparar fixtures sintéticos con documentos reales')
  const cohort = (result) => result.documents.map((d) => `${d.id}:${d.topic}:${d.format}`).sort()
  if (!before.documents?.length || !after.documents?.length || JSON.stringify(cohort(before)) !== JSON.stringify(cohort(after)))
    throw new Error('Cohortes distintas o vacías: deben coincidir id, tema, formato y repeticiones')
}

export async function main(argv) {
  const options = parseArgs(argv)
  if (options.command === 'list') {
    console.log(CASES.map((c) => `${c.id}\t${c.title}\t${c.topic}`).join('\n'))
    return
  }
  if (options.command === 'synthetic') {
    if (!options.out) throw new Error('Falta --out')
    await writeSynthetic(resolve(options.out), options.variant ?? 'diverse')
    const result = await measureManifest(join(resolve(options.out), 'manifest.json'), options)
    await save(join(resolve(options.out), 'similarity.json'), result)
    console.log(JSON.stringify({ synthetic: true, ...result.byFormat, failures: result.failures }, null, 2))
    return
  }
  if (options.command === 'measure') {
    if (!options.manifest || !options.out) throw new Error('Se requieren --manifest y --out (JSON nuevo)')
    const result = await measureManifest(resolve(options.manifest), options)
    await save(resolve(options.out), result)
    console.log(JSON.stringify(result.byFormat, null, 2))
    if (result.failures.length) throw new Error(`Fallaron ${result.failures.length} documentos; revisar ${options.out}`)
    return
  }
  if (options.command === 'compare') {
    const before = await json(options.before),
      after = await json(options.after)
    validateComparison(before, after)
    const comparison = Object.fromEntries(
      FORMATS.map((f) => {
        const a = before.byFormat[f].fraction,
          b = after.byFormat[f].fraction
        return [
          f,
          { before: a, after: b, relativeReduction: a > 0 && b !== null ? (a - b) / a : null, comparable: a !== null && b !== null }
        ]
      })
    )
    if (options.out) await save(resolve(options.out), comparison)
    console.log(JSON.stringify(comparison, null, 2))
    return
  }
  if (options.command === 'run') {
    const result = await realRun(options)
    console.log(JSON.stringify(result, null, 2))
    if (result.failures) throw new Error('La tanda tiene fallos; no aceptar una mejora con documentos omitidos')
    return
  }
  if (!['help', '--help', '-h'].includes(options.command)) throw new Error('Comando desconocido: ' + options.command)
  console.log(
    'Banco de diseño: list | synthetic --out DIR [--variant same|diverse] | measure --manifest JSON --out JSON | compare --before JSON --after JSON | run --real --allow-model --motor PATH --model proveedor/modelo --out DIR [opciones]. Ver scripts/design-bench/README.md.'
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
