#!/usr/bin/env node
// Examen del Control del Mac. Uso (Node 22):
//   node tools/computer-bench/bench.mjs list              tareas y su comprobación
//   node tools/computer-bench/bench.mjs setup [id ...]    deja el Escritorio listo (todas si no se dan ids)
//   node tools/computer-bench/bench.mjs prompts           imprime los textos para pegar en tareas nuevas
//   node tools/computer-bench/bench.mjs report [--label x] lee las sesiones, comprueba el estado final y mide
//   node tools/computer-bench/bench.mjs clean             borra todo lo que empieza por bench- del Escritorio
// El examen NO lanza el agente: cada prompt se pega a mano en una tarea nueva (Control total), porque el plan y el
// control real los aprueba una persona. `report` encuentra la sesión de cada tarea por su texto exacto.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { TASKS, cleanDesktop } from './tasks.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DB_DIR = join(homedir(), 'Library', 'Application Support', 'Lazunox', 'opencode-data', 'opencode')

const [cmd = 'list', ...rest] = process.argv.slice(2)
const flag = (name) => {
  const i = rest.indexOf(name)
  return i >= 0 ? rest[i + 1] : undefined
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: HERE, encoding: 'utf8' }).trim()
  } catch {
    return '?'
  }
}

/** Copia la BD (con su WAL) para leer sin tocar la de la app. */
function openDb() {
  const dir = mkdtempSync(join(tmpdir(), 'cbench-'))
  for (const f of ['opencode.db', 'opencode.db-wal', 'opencode.db-shm']) {
    if (existsSync(join(DB_DIR, f))) copyFileSync(join(DB_DIR, f), join(dir, f))
  }
  return new DatabaseSync(join(dir, 'opencode.db'))
}

function sessionFor(db, prompt) {
  const rows = db
    .prepare("select id, model, cost, time_created, time_updated from session where agent = 'computer' and title = ? order by time_created desc")
    .all(prompt.slice(0, 80))
  return rows[0]
}

function metrics(db, s) {
  const parts = db
    .prepare(
      `select p.data as pd, m.data as md from part p join message m on m.id = p.message_id
       where p.session_id = ? order by p.time_created`
    )
    .all(s.id)
  let calls = 0
  let errors = 0
  let answer = ''
  for (const { pd, md } of parts) {
    const part = JSON.parse(pd)
    const role = JSON.parse(md).role
    if (part.type === 'tool') {
      calls++
      if (part.state?.status === 'error') errors++
      else if (part.state?.status === 'completed' && /^(Esperabas|Modo segundo plano|Todavía no hay un plan)/.test(String(part.state.output ?? ''))) errors++
    } else if (part.type === 'text' && role === 'assistant' && part.text?.trim()) {
      answer = part.text // el último texto del asistente es la respuesta final
    }
  }
  let model = '?'
  try {
    model = JSON.parse(s.model).id
  } catch {
    // modelo ilegible
  }
  return { calls, errors, answer, model, seconds: Math.round((s.time_updated - s.time_created) / 1000), cost: Number(s.cost ?? 0) }
}

const pad = (v, n) => String(v).padEnd(n)

if (cmd === 'list') {
  for (const t of TASKS) console.log(`${pad(t.id, 18)} ${pad(t.kind, 10)} ${t.prompt}`)
} else if (cmd === 'setup') {
  const ids = rest.filter((a) => !a.startsWith('--'))
  for (const t of TASKS.filter((t) => ids.length === 0 || ids.includes(t.id))) {
    t.setup?.()
    console.log(`listo: ${t.id}`)
  }
} else if (cmd === 'prompts') {
  TASKS.forEach((t, i) => console.log(`${i + 1}. [${t.id}]\n${t.prompt}\n`))
} else if (cmd === 'clean') {
  cleanDesktop()
  console.log('Escritorio limpio de archivos bench-*')
} else if (cmd === 'report') {
  const db = openDb()
  const rows = []
  for (const t of TASKS) {
    const s = sessionFor(db, t.prompt)
    if (!s) {
      rows.push({ id: t.id, kind: t.kind, run: false })
      continue
    }
    const m = metrics(db, s)
    let verdict
    try {
      verdict = t.check({ answer: m.answer })
    } catch (err) {
      verdict = { pass: false, why: `error al comprobar: ${err.message}` }
    }
    rows.push({ id: t.id, kind: t.kind, run: true, session: s.id, ...m, pass: verdict.pass, why: verdict.why, answer: m.answer.slice(0, 400) })
  }
  const done = rows.filter((r) => r.run)
  console.log(`${pad('tarea', 18)} ${pad('tipo', 10)} ${pad('resultado', 10)} ${pad('llamadas', 9)} ${pad('errores', 8)} ${pad('seg', 5)} costo   modelo`)
  for (const r of rows) {
    if (!r.run) console.log(`${pad(r.id, 18)} ${pad(r.kind, 10)} sin correr`)
    else
      console.log(
        `${pad(r.id, 18)} ${pad(r.kind, 10)} ${pad(r.pass ? 'OK' : 'FALLÓ', 10)} ${pad(r.calls, 9)} ${pad(r.errors, 8)} ${pad(r.seconds, 5)} $${r.cost.toFixed(3)}  ${r.model}`
      )
  }
  for (const r of done.filter((r) => !r.pass)) console.log(`  ✗ ${r.id}: ${r.why}\n    respuesta: ${r.answer.replace(/\n/g, ' ').slice(0, 200)}`)
  const passed = done.filter((r) => r.pass).length
  const sum = (k) => done.reduce((a, r) => a + r[k], 0)
  console.log(
    `\n${passed}/${done.length} correctas (de ${rows.length} tareas) · ${sum('calls')} llamadas · ${sum('seconds')} s · $${sum('cost').toFixed(3)}`
  )
  const out = {
    label: flag('--label') ?? '',
    at: new Date().toISOString(),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    commit: git(['rev-parse', '--short', 'HEAD']),
    dirty: git(['status', '--porcelain', '--', 'src']) !== '',
    rows
  }
  mkdirSync(join(HERE, 'results'), { recursive: true })
  const file = join(HERE, 'results', `${out.at.replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, JSON.stringify(out, null, 1))
  console.log(`guardado: ${file}`)
} else {
  console.error('comando desconocido: ' + cmd)
  process.exit(2)
}
