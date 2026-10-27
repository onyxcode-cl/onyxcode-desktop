#!/usr/bin/env node
// Une las corridas del comparativo 7.19 (un JSON por tarea y repetición, con la `etiqueta` de la corrida) con el registro del proxy
// (`proxy.jsonl`: una línea por petición al modelo, con el `usage` real de OpenCode Go) y escribe tablas Markdown + un JSON.
// La medida es la MISMA para los tres motores: viene del proxy, no de lo que cada motor dice de sí mismo.
//
//   node comparativo-agregar.mjs --proxy proxy.jsonl --lazunox <carpetaCorridas>[,<otra>] --opencode2 <…> --codex <…> --salida <carpeta>
//
// Definiciones (todas por corrida; luego mediana entre repeticiones):
//   paso            = petición al modelo CON herramientas (la del bucle del agente).
//   auxiliar        = petición sin herramientas (título de la sesión, etc.). Cuenta en los totales, no en los pasos.
//   tokens enviados = suma de `prompt_tokens` de TODAS las peticiones (incluye los que salen de caché del proveedor).
//   tokens/paso     = `prompt_tokens` de cada paso; mediana y p90 dentro de la corrida (luego mediana entre corridas).
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const arg = (n) => {
  const i = process.argv.indexOf(n)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const MOTORES = ['lazunox', 'opencode2', 'codex']
const NOMBRES = { lazunox: 'Lazunox', opencode2: 'OpenCode 2.2.0', codex: 'Codex 0.164.0' }

const med = (l) => {
  const v = l.filter(Number.isFinite).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}
const pct = (l, p) => {
  const v = l.filter(Number.isFinite).sort((a, b) => a - b)
  return v.length ? v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)] : null
}
const fmt = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString('es-CL', { maximumFractionDigits: d }))

const proxy = readFileSync(arg('--proxy'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const porEtiqueta = new Map()
for (const r of proxy) {
  if (!porEtiqueta.has(r.etiqueta)) porEtiqueta.set(r.etiqueta, [])
  porEtiqueta.get(r.etiqueta).push(r)
}

function cargar(dirs) {
  const corridas = []
  for (const d of (dirs ?? '').split(',').filter(Boolean)) {
    if (!existsSync(d)) continue
    for (const n of readdirSync(d).filter((x) => /^T\d\d-r\d+\.json$/.test(x)).sort()) {
      const j = JSON.parse(readFileSync(join(d, n), 'utf8'))
      corridas.push({ tarea: j.tarea, nombre: j.nombre, rep: j.repeticion, fase: d, c: j.corrida })
    }
  }
  return corridas
}

function medir(x) {
  const reqs = (porEtiqueta.get(x.c.etiqueta) ?? []).filter((r) => /^\/(chat\/completions|responses)/.test(r.ruta))
  const buenas = reqs.filter((r) => r.estado === 200)
  const pasos = buenas.filter((r) => r.herramientas > 0)
  const aux = buenas.filter((r) => !(r.herramientas > 0))
  const porPaso = pasos.map((r) => r.entrada)
  return {
    tarea: x.tarea,
    nombre: x.nombre,
    ok: x.c.ok,
    cuota: x.c.cuota,
    detalle: x.c.detalle,
    enviados: buenas.reduce((a, r) => a + r.entrada, 0),
    enviados_pasos: pasos.reduce((a, r) => a + r.entrada, 0),
    salida: buenas.reduce((a, r) => a + r.salida, 0),
    cache: buenas.reduce((a, r) => a + (r.cache_leida ?? 0), 0),
    pasos: pasos.length,
    auxiliares: aux.length,
    primer_paso: porPaso[0] ?? null,
    todos_pasos: porPaso,
    paso_med: med(porPaso),
    paso_p90: pct(porPaso, 90),
    peticiones_fallidas: reqs.length - buenas.length,
    http429: reqs.filter((r) => r.estado === 429).length,
    ms: x.c.tiempo_ms,
    costo: buenas.reduce((a, r) => a + (r.costo_lista ?? 0), 0),
    motivo: x.c.motivo,
    errores: x.c.errores
  }
}

const datos = {}
for (const m of MOTORES) datos[m] = cargar(arg(`--${m}`)).map(medir)

const tareas = [...new Set(MOTORES.flatMap((m) => datos[m].map((r) => r.tarea)))].sort()
const nombre = Object.fromEntries(MOTORES.flatMap((m) => datos[m].map((r) => [r.tarea, r.nombre])))
const resumen = {}
for (const m of MOTORES) {
  resumen[m] = {}
  for (const t of tareas) {
    const rs = datos[m].filter((r) => r.tarea === t && !r.cuota)
    if (!rs.length) continue
    const exitos = rs.filter((r) => r.ok)
    resumen[m][t] = {
      n: rs.length,
      exitos: exitos.length,
      enviados: med(rs.map((r) => r.enviados)),
      enviados_min: Math.min(...rs.map((r) => r.enviados)),
      enviados_max: Math.max(...rs.map((r) => r.enviados)),
      salida: med(rs.map((r) => r.salida)),
      pasos: med(rs.map((r) => r.pasos)),
      paso_med: med(rs.map((r) => r.paso_med)),
      paso_p90: med(rs.map((r) => r.paso_p90)),
      min: med(rs.map((r) => r.ms / 60000)),
      costo: med(rs.map((r) => r.costo)),
      por_exito: exitos.length ? med(exitos.map((r) => r.enviados + r.salida)) : null,
      fallos: rs.filter((r) => !r.ok).map((r) => `${r.detalle ?? ''} [${r.motivo}${r.errores ? '; ' + r.errores.join(' | ') : ''}]`.slice(0, 220)),
      http_no200: rs.reduce((a, r) => a + r.peticiones_fallidas, 0)
    }
  }
}

const celdaExito = (m, t) => (resumen[m][t] ? `${resumen[m][t].exitos}/${resumen[m][t].n}` : '—')
const L = []
L.push('### Éxito y tokens enviados por tarea', '', '| Tarea | Éxito Lazunox | Éxito OpenCode | Éxito Codex | Tokens enviados Lazunox (mediana [mín–máx]) | OpenCode | Codex |', '|---|---|---|---|---:|---:|---:|')
const rango = (m, t) => {
  const r = resumen[m][t]
  return r ? `${fmt(r.enviados)} [${fmt(r.enviados_min)}–${fmt(r.enviados_max)}]` : '—'
}
for (const t of tareas) L.push(`| ${t} ${nombre[t]} | ${celdaExito('lazunox', t)} | ${celdaExito('opencode2', t)} | ${celdaExito('codex', t)} | ${rango('lazunox', t)} | ${rango('opencode2', t)} | ${rango('codex', t)} |`)
L.push('', '### Pasos, tokens por paso y tiempo por tarea (mediana entre repeticiones)', '', '| Tarea | Pasos L | Pasos O | Pasos C | Tokens/paso mediana · p90 L | O | C | Min L | Min O | Min C |', '|---|---:|---:|---:|---|---|---|---:|---:|---:|')
const pp = (m, t) => (resumen[m][t] ? `${fmt(resumen[m][t].paso_med)} · ${fmt(resumen[m][t].paso_p90)}` : '—')
for (const t of tareas) L.push(`| ${t} | ${MOTORES.map((m) => fmt(resumen[m][t]?.pasos, 1)).join(' | ')} | ${MOTORES.map((m) => pp(m, t)).join(' | ')} | ${MOTORES.map((m) => fmt(resumen[m][t]?.min, 2)).join(' | ')} |`)

// Totales sobre las tareas medidas con el mismo n por los tres motores.
const comunes = tareas.filter((t) => MOTORES.every((m) => resumen[m][t] && resumen[m][t].n >= 3))
const unaVez = tareas.filter((t) => MOTORES.every((m) => resumen[m][t]) && !comunes.includes(t))
const tot = {}
for (const m of MOTORES) {
  const corr = datos[m].filter((r) => comunes.includes(r.tarea) && !r.cuota)
  const ex = corr.filter((r) => r.ok)
  tot[m] = {
    corridas: corr.length,
    exitos: ex.length,
    enviados: corr.reduce((a, r) => a + r.enviados, 0),
    salida: corr.reduce((a, r) => a + r.salida, 0),
    pasos: corr.reduce((a, r) => a + r.pasos, 0),
    por_exito: med(ex.map((r) => r.enviados + r.salida)),
    min_total: corr.reduce((a, r) => a + r.ms, 0) / 60000,
    paso_med: med(corr.flatMap((r) => r.todos_pasos)),
    paso_p90: pct(corr.flatMap((r) => r.todos_pasos), 90),
    primer_paso: med(corr.map((r) => r.primer_paso)),
    costo: corr.reduce((a, r) => a + r.costo, 0),
    fallidas: corr.reduce((a, r) => a + r.peticiones_fallidas, 0)
  }
}
L.push('', `### Totales (${comunes.length} tareas medidas por los tres motores: ${comunes.join(', ')})`, '', '| | ' + MOTORES.map((m) => NOMBRES[m]).join(' | ') + ' |', '|---|---:|---:|---:|')
const fila = (et, f, d = 0) => L.push(`| ${et} | ${MOTORES.map((m) => fmt(f(tot[m]), d)).join(' | ')} |`)
fila('Corridas', (x) => x.corridas)
fila('Éxitos', (x) => x.exitos)
fila('Tokens enviados (suma)', (x) => x.enviados)
fila('Tokens de salida (suma)', (x) => x.salida)
fila('Pasos (suma)', (x) => x.pasos)
fila('Tokens por paso, todos los pasos juntos: mediana', (x) => x.paso_med)
fila('Tokens por paso, todos los pasos juntos: p90', (x) => x.paso_p90)
fila('Tokens enviados en el primer paso (mediana)', (x) => x.primer_paso)
fila('Mediana de tokens enviados+salida por éxito', (x) => x.por_exito)
fila('Tiempo total (min)', (x) => x.min_total, 1)
fila('Costo de lista de OpenCode Go (USD, suma)', (x) => x.costo, 3)
fila('Peticiones al modelo que no fueron 200', (x) => x.fallidas)

if (unaVez.length) {
  L.push('', `### Tareas medidas una sola vez por motor (n = 1; no se suman a los totales): ${unaVez.join(', ')}`, '', '| Tarea | Motor | Éxito | Tokens enviados | Pasos | Tokens/paso mediana · p90 | Minutos |', '|---|---|---|---:|---:|---|---:|')
  for (const t of unaVez) for (const m of MOTORES) {
    const r = resumen[m][t]
    L.push(`| ${t} | ${NOMBRES[m]} | ${r.exitos}/${r.n} | ${fmt(r.enviados)} | ${fmt(r.pasos)} | ${fmt(r.paso_med)} · ${fmt(r.paso_p90)} | ${fmt(r.min, 2)} |`)
  }
}
const fallos = []
for (const m of MOTORES) for (const t of tareas) for (const f of resumen[m][t]?.fallos ?? []) fallos.push(`- ${NOMBRES[m]} ${t}: ${f}`)
if (fallos.length) L.push('', '### Corridas fallidas', '', ...fallos)

const salida = arg('--salida')
if (salida) {
  mkdirSync(salida, { recursive: true })
  writeFileSync(join(salida, 'resumen.json'), JSON.stringify({ resumen, tot, comunes }, null, 2) + '\n')
  writeFileSync(join(salida, 'tablas.md'), L.join('\n') + '\n')
}
console.log(L.join('\n'))
