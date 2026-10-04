#!/usr/bin/env node
// Informe de tamaños de la PWA del celular (`pwa/dist`, ya compilada con `npm run build:pwa`) contra `pwa/budget.json`.
// Por cada .js/.css: KB minificados y gzip-9, y si entra en el ARRANQUE (lo que se baja antes del primer pintado: mismo criterio que
// scripts/build-pwa.mjs). Sin opciones solo informa (código 0). Con `--check` sale con código 1 si se pasa algún límite.
// Todavía NO forma parte de `npm run verify`: es una guía para quien toque el peso (ver docs/MOBILE-UI.md).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'pwa', 'dist')
const check = process.argv.includes('--check')
const KB = 1024
const kb = (n) => n / KB
const fmt = (n) => kb(n).toFixed(1).padStart(8)

if (!existsSync(dist)) {
  console.error('[size:pwa] no existe pwa/dist: corre `npm run build:pwa` antes.')
  process.exit(check ? 1 : 0)
}
const budget = JSON.parse(readFileSync(join(root, 'pwa', 'budget.json'), 'utf8'))

const files = []
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (['.js', '.css'].includes(extname(name))) files.push(p)
  }
}
walk(dist)

const info = new Map()
for (const f of files) {
  const buf = readFileSync(f)
  info.set(f, { min: buf.length, gz: gzipSync(buf, { level: 9 }).length })
}
/** `assets/boot-Dr6iGfwq.css` → `boot.css` (quita la huella de Vite: último tramo tras «-»). */
const nameOf = (f) => {
  const base = f.split(/[\\/]/).pop()
  const ext = extname(base)
  return `${base.slice(0, -ext.length).replace(/-[A-Za-z0-9_-]{8}$/, '')}${ext}`
}

// Arranque: misma lógica que build-pwa.mjs (index ligero + entrada de la interfaz completa y sus dependencias estáticas + boot).
const startup = new Set()
for (const f of files) if (/[\\/]assets[\\/](index|style)-/.test(f) && !f.startsWith(join(dist, 'app'))) startup.add(f)
const entry = join(dist, 'app', 'entry.json')
if (existsSync(entry)) {
  const e = JSON.parse(readFileSync(entry, 'utf8'))
  const abs = (n) => join(dist, 'app', n)
  startup.add(abs(e.js))
  for (const c of e.css ?? []) startup.add(abs(c))
  const deps = (js) => {
    const text = readFileSync(abs(js), 'utf8')
    const stat = [...text.matchAll(/(?:from|import)\s*["']\.\/([A-Za-z0-9._-]+\.js)["']/g)].map((m) => m[1])
    const boot = [...text.matchAll(/import\(\s*["']\.\/(boot-[A-Za-z0-9._-]+\.js)["']\s*\)/g)].map((m) => m[1])
    return [...stat, ...boot].map((n) => `assets/${n}`)
  }
  const seen = new Set([e.js])
  const queue = deps(e.js)
  for (const j of queue) {
    if (seen.has(j)) continue
    seen.add(j)
    startup.add(abs(j))
    queue.push(...deps(j))
  }
  for (const f of files) if (/[\\/]app[\\/]assets[\\/]boot-[^\\/]*\.css$/.test(f)) startup.add(f)
}

const rows = [...info].map(([f, v]) => ({ f, name: nameOf(f), ...v, boot: startup.has(f) })).sort((a, b) => b.gz - a.gz)
console.log(`${'archivo'.padEnd(46)} ${'min KB'.padStart(8)} ${'gzip KB'.padStart(8)}  arranque`)
for (const r of rows) console.log(`${relative(dist, r.f).padEnd(46)} ${fmt(r.min)} ${fmt(r.gz)}  ${r.boot ? 'sí' : ''}`)

const boot = rows.filter((r) => r.boot)
const sum = (rs, k) => rs.reduce((n, r) => n + r[k], 0)
const startupGz =
  kb(sum(boot, 'gz')) +
  (existsSync(join(dist, 'index.html')) ? kb(gzipSync(readFileSync(join(dist, 'index.html')), { level: 9 }).length) : 0)
// JS minificado de la interfaz completa (main + boot + estáticos), sin el arranque ligero: es la cifra del plan de rendimiento.
const startupMin = kb(
  sum(
    boot.filter((r) => r.f.endsWith('.js') && r.f.includes(join(dist, 'app'))),
    'min'
  )
)
console.log(
  `\narranque: ${startupGz.toFixed(1)} KB gzip (con index.html) · ${startupMin.toFixed(0)} KB de JS minificado de la interfaz completa`
)

const problems = []
const over = (what, got, max) => {
  const ok = got <= max
  console.log(`${ok ? 'ok     ' : 'EXCEDE '} ${what}: ${got.toFixed(1)} / ${max} KB`)
  if (!ok) problems.push(what)
}
over('arranque gzip', startupGz, budget.startupGzipKB)
over('arranque JS minificado', startupMin, budget.startupJsMinKB)
for (const [name, lim] of Object.entries(budget.chunks ?? {})) {
  const r = rows.find((x) => x.name === name)
  if (!r) {
    if (!/^(markdown|highlight)\./.test(name)) console.log(`falta   ${name} (no hay trozo con ese nombre)`)
    continue
  }
  if (lim.gz != null) over(`${name} gzip`, kb(r.gz), lim.gz)
  if (lim.min != null) over(`${name} min`, kb(r.min), lim.min)
}
const known = new Set(Object.keys(budget.chunks ?? {}))
for (const r of rows.filter((x) => !x.boot && !known.has(x.name) && x.f.includes(`${join(dist, 'app')}`)))
  over(`perezoso ${r.name} gzip`, kb(r.gz), budget.lazyChunkGzipKB)

if (problems.length) console.log(`\n${problems.length} límite(s) superado(s): ${problems.join('; ')}`)
process.exit(check && problems.length ? 1 : 0)
