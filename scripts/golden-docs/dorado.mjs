#!/usr/bin/env node
// `npm run docs:dorado` — corre el set dorado y compara con la línea base versionada (scripts/golden-docs/baseline.json).
//   --save-baseline   guarda el resultado como nueva línea base
//   --only d02,x03    solo algunos casos (no compara el total, solo los casos corridos)
// Sale con código 1 si algún caso deja de pasar o si los defectos SUBEN (total, por tipo o por caso). No es parte de la suite normal:
// tarda ~20 s y usa el Python incluido de la app (resources/python-bin) y ArtCraft en la caché (`node scripts/golden-docs.mjs --setup`).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = join(HERE, 'baseline.json')
const args = process.argv.slice(2)
const save = args.includes('--save-baseline')
const rest = args.filter((a) => a !== '--save-baseline')
const out = mkdtempSync(join(tmpdir(), 'golden-run-'))
try {
  const r = spawnSync(process.execPath, [resolve(HERE, '..', 'golden-docs.mjs'), '--label', 'dorado', '--out', out, ...rest], { stdio: ['ignore', 'ignore', 'inherit'], encoding: 'utf8' })
  const jp = join(out, 'golden-latest.json')
  if (r.status !== 0 || !existsSync(jp)) { console.error('El set dorado no terminó (¿falta ArtCraft? corre `node scripts/golden-docs.mjs --setup`).'); process.exit(2) }
  const rep = JSON.parse(readFileSync(jp, 'utf8'))
  const cur = { casos: rep.summary.cases, pasan: rep.summary.pass, defectos: rep.summary.defectsTotal, porTipo: {}, porCaso: {} }
  for (const [k, v] of Object.entries(rep.summary.byKind)) cur.porTipo[k] = v.defects
  for (const x of rep.results) cur.porCaso[x.id] = { pasa: !!x.pass, defectos: x.defect_total, detalle: Object.fromEntries(Object.entries(x.defects || {}).filter(([, v]) => v)) }

  console.log(`Set dorado: ${cur.pasan}/${cur.casos} casos pasan · ${cur.defectos} defectos`)
  console.log('Por tipo: ' + Object.entries(cur.porTipo).map(([k, v]) => `${k} ${v}`).join(', '))
  console.log('Por caso con defectos:')
  for (const [id, c] of Object.entries(cur.porCaso)) if (c.defectos || !c.pasa) console.log(`  ${id}${c.pasa ? '' : ' (NO PASA)'}: ${c.defectos} ${JSON.stringify(c.detalle)}`)

  if (save) {
    if (rest.includes('--only')) { console.error('No se guarda una línea base parcial (quita --only).'); process.exit(2) }
    writeFileSync(BASE, JSON.stringify(cur, null, 1) + '\n')
    console.log('Línea base guardada en scripts/golden-docs/baseline.json')
    process.exit(0)
  }
  if (!existsSync(BASE)) { console.log('Sin línea base (usa --save-baseline).'); process.exit(0) }
  const b = JSON.parse(readFileSync(BASE, 'utf8'))
  const peor = []
  const parcial = rest.includes('--only')
  if (!parcial && cur.defectos > b.defectos) peor.push(`total ${b.defectos} -> ${cur.defectos}`)
  if (!parcial) for (const [k, v] of Object.entries(cur.porTipo)) if (v > (b.porTipo[k] ?? 0)) peor.push(`${k} ${b.porTipo[k] ?? 0} -> ${v}`)
  for (const [id, c] of Object.entries(cur.porCaso)) {
    const o = b.porCaso[id]
    if (!o) continue
    if (c.defectos > o.defectos) peor.push(`${id} ${o.defectos} -> ${c.defectos}`)
    if (o.pasa && !c.pasa) peor.push(`${id} dejó de pasar`)
  }
  if (peor.length) { console.log('\nEMPEORÓ respecto de la línea base: ' + peor.join('; ')); process.exit(1) }
  console.log(`\nSin empeorar respecto de la línea base (${b.pasan}/${b.casos}, ${b.defectos} defectos)${cur.defectos < b.defectos && !parcial ? ': MEJORÓ, considera --save-baseline' : ''}.`)
} finally { rmSync(out, { recursive: true, force: true }) }
