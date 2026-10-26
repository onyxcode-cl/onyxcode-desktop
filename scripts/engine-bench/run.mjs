#!/usr/bin/env node
// Banco de tareas del motor (plan maestro, §5 «Medición» y paquete 1A; ola 6, paquete 6.1: T19-T23 más duras): 23 tareas pequeñas y REPRODUCIBLES (programación y oficina),
// cada una con su carpeta inicial generada por el propio script, un pedido natural en español y un VERIFICADOR determinista (un comando
// o una comprobación de archivos; nunca un juez con modelo). Sirve para medir «el motor mejoró» antes/después, con el modelo gratuito.
//
// REGLA: corre SOLO dentro de un contenedor del VPS (el motor real ejecuta comandos con permisos de bash; nunca en el Mac de Ben).
// El ejecutor se niega a correr motores en macOS/Windows o fuera de un contenedor (`/.dockerenv` o BENCH_EN_CONTENEDOR=1).
//
//   (en el VPS de pruebas, por ssh con la clave de despliegue)
//   docker run --rm --cpus=4 --memory=8g -e BENCH_EN_CONTENEDOR=1 \
//     -v /opt/lzx-b1app:/app -v /opt/lzx-fork/out-linux-x64-1:/motor:ro -v /opt/lzx-b1/salida:/out \
//     -v /opt/lzx-fork/src/node_modules/typescript:/ts:ro -w /app node:22-bookworm \
//     node scripts/engine-bench/run.mjs --motor /motor --repeticiones 3 --typescript /ts --salida /out
//   (el motor es un binario linux-x64 compilado con `targets.sh`; con `--proveedor-falso` no hace falta red ni modelo)
//
// Uso:
//   node scripts/engine-bench/run.mjs --motor <binario> [--tareas T01,T05] [--repeticiones 3] [--modelo opencode/deepseek-v4.1-flash-free]
//        [--proveedor-falso [--sin-guion T05,T09]] [--env K=V ...] [--config-global '<json>'] [--max-pasos 60] [--presupuesto-tokens 400000] [--timeout-min 15]
//        [--auth-archivo <auth.json>] [--typescript <carpeta de typescript>] [--salida <archivo|carpeta>] [--conservar] [--espera-cuota-seg 60]
//        [--guardar-corridas <carpeta>]   (un JSON por tarea y repetición, escrito apenas termina cada corrida: `T19-r03.json`; si ya existe
//        y no es de cuota, esa repetición se SALTA y se reutiliza, así una tanda de ≥5 repeticiones se reparte en varios días)
//   node scripts/engine-bench/run.mjs --motor <binario> --tareas T17,T18 --reanudar bench-….json   (repite SOLO esas tareas, p. ej. tras agotar la cuota,
//        y deja un archivo nuevo con el resto tal cual estaba; mismo modelo y motor)
//   node scripts/engine-bench/run.mjs --comparar antes.json despues.json     (imprime el antes/después con mediana y rango por tarea y, con ≥5
//        repeticiones en ambos lados, si la diferencia de tokens/pasos queda «dentro del ruido»; acepta también carpetas de --guardar-corridas;
//        no corre el motor)
//   node scripts/engine-bench/run.mjs --lista                                (las tareas)
//   node scripts/engine-bench/run.mjs --autoprueba [--tareas T01] [--typescript <dir>]   (sin motor: cada verificador debe FALLAR en la carpeta
//        inicial y PASAR tras aplicar el guion de la tarea con herramientas simuladas; también solo en contenedor)
//
// Cada corrida: carpeta temporal con `git init` y un commit; el motor arranca con HOME/XDG_* temporales, permisos acotados
// (`external_directory: deny`, sin red de herramientas) y `run --format json --permisos ninguno --max-steps N --presupuesto-tokens M`,
// con el pedido por stdin. Se suman `tokens` de cada `step_finish`; después corre el verificador y se mide el reloj.
// Cuota gratuita agotada («Free usage limit reached»): se reintenta una vez tras esperar y, si sigue, la corrida se marca `cuota`
// y NO cuenta como fallo.
// Salida: `bench-<fecha>.json` + tabla Markdown. Métricas por tarea (mediana de las corridas): éxito (k de n), tokens enviados
// (`input + cache.read`), tokens de salida, caché leída / enviados, pasos, llamadas, minutos y tokens por éxito.
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mediana, percentil } from './lib.mjs'
import { iniciarProveedorFalso } from './proveedor-falso.mjs'
import { cargarTareas } from './tareas/index.mjs'

const aqui = dirname(fileURLToPath(import.meta.url))
const MODELO_GRATIS = 'opencode/deepseek-v4.1-flash-free'

// ── Argumentos ────────────────────────────────────────────────────────────────────────────────────────────────────────────
function leerArgs(argv) {
  const a = { env: [], repeticiones: 1, maxPasos: 60, presupuesto: 400_000, timeoutMin: 15, esperaCuotaSeg: 60 }
  const valor = (i, n) => {
    if (i + 1 >= argv.length) throw new Error(`falta el valor de ${n}`)
    return argv[i + 1]
  }
  for (let i = 0; i < argv.length; i++) {
    const n = argv[i]
    switch (n) {
      case '--motor': a.motor = valor(i++, n); break
      case '--tareas': a.tareas = valor(i++, n).split(',').map((x) => x.trim().toUpperCase()).filter(Boolean); break
      case '--repeticiones': a.repeticiones = Number(valor(i++, n)); break
      case '--modelo': a.modelo = valor(i++, n); break
      case '--env': a.env.push(valor(i++, n)); break
      case '--config-global': a.configGlobal = valor(i++, n); break
      case '--max-pasos': a.maxPasos = Number(valor(i++, n)); break
      case '--presupuesto-tokens': a.presupuesto = Number(valor(i++, n)); break
      case '--timeout-min': a.timeoutMin = Number(valor(i++, n)); break
      case '--typescript': a.typescript = valor(i++, n); break
      case '--salida': a.salida = valor(i++, n); break
      case '--espera-cuota-seg': a.esperaCuotaSeg = Number(valor(i++, n)); break
      case '--comparar': a.comparar = [valor(i, n), argv[i + 2]]; if (!a.comparar[1]) throw new Error('--comparar necesita dos archivos'); i += 2; break
      case '--proveedor-falso': a.falso = true; break
      case '--conservar': a.conservar = true; break
      case '--guardar-corridas': a.guardarCorridas = valor(i++, n); break
      case '--auth-archivo': a.authArchivo = valor(i++, n); break
      case '--reanudar': a.reanudar = valor(i++, n); break
      case '--sin-guion': a.sinGuion = valor(i++, n).split(',').map((x) => x.trim().toUpperCase()); break
      case '--lista': a.lista = true; break
      case '--autoprueba': a.autoprueba = true; break
      case '--ayuda': case '-h': case '--help': a.ayuda = true; break
      default: throw new Error(`argumento desconocido: ${n}`)
    }
  }
  for (const [k, v] of [['--repeticiones', a.repeticiones], ['--max-pasos', a.maxPasos], ['--presupuesto-tokens', a.presupuesto], ['--timeout-min', a.timeoutMin]])
    if (!Number.isInteger(v) || v <= 0) throw new Error(`${k} debe ser un entero positivo`)
  return a
}

// ── Una corrida de una tarea ──────────────────────────────────────────────────────────────────────────────────────────────
const CUOTA = /free usage|usage limit|rate.?limit|quota|too many requests|\b429\b/i

function configMotor(cfg, tarea, proveedor) {
  const config = {
    autoupdate: false,
    share: 'disabled',
    // Permisos acotados: todo lo que el pedido necesita dentro de la carpeta; nada fuera de ella ni hacia la red de herramientas.
    permission: {
      read: 'allow', edit: 'allow', bash: 'allow', glob: 'allow', grep: 'allow', list: 'allow', todowrite: 'allow', task: 'allow',
      external_directory: 'deny', webfetch: 'deny', websearch: 'deny', question: 'deny'
    },
    ...(proveedor
      ? {
          provider: { fake: { npm: '@ai-sdk/openai-compatible', name: 'Fake', options: { baseURL: proveedor.url, apiKey: 'no-usado' }, models: { m: { name: 'm', tool_call: true } } } },
          model: 'fake/m',
          small_model: 'fake/m'
        }
      : {}),
    ...(tarea.mcp
      ? { mcp: { almacen: { type: 'local', command: [process.execPath, join(aqui, 'mcp-bench.mjs')], enabled: true } } }
      : {})
  }
  return JSON.stringify(config)
}

function entornoMotor(cfg, root, home, proj, tarea, proveedor) {
  const extra = Object.fromEntries(cfg.env.map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]))
  return {
    PATH: [dirname(process.execPath), '/usr/local/bin', '/usr/bin', '/bin'].join(':'),
    HOME: home,
    PWD: proj,
    SHELL: existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh',
    LANG: 'C.UTF-8',
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local/share'),
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_STATE_HOME: join(home, '.local/state'),
    TMPDIR: join(root, 'tmp'),
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
    OPENCODE_DISABLE_CLAUDE_CODE: '1',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
    OPENCODE_DISABLE_SHARE: '1',
    OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
    OPENCODE_CONFIG_CONTENT: configMotor(cfg, tarea, proveedor),
    ...extra
  }
}

/** Lanza `motor run …` con el pedido por stdin; devuelve { eventos, stderr, codigo, ms, cortePorTiempo }. */
function lanzarRun(cfg, entorno, proj, argv, pedido) {
  return new Promise((res) => {
    const t0 = Date.now()
    const hijo = spawn(cfg.motor, argv, { cwd: proj, env: entorno, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
    let out = ''
    let err = ''
    let cortePorTiempo = false
    hijo.stdout.on('data', (d) => (out += d))
    hijo.stderr.on('data', (d) => (err += d))
    hijo.stdin.on('error', () => {})
    hijo.stdin.end(pedido)
    const matar = () => {
      try {
        process.kill(-hijo.pid, 'SIGKILL')
      } catch {
        /* ya terminó */
      }
    }
    const reloj = setTimeout(() => {
      cortePorTiempo = true
      matar()
    }, cfg.timeoutMin * 60_000)
    hijo.on('close', (codigo) => {
      clearTimeout(reloj)
      matar() // el conector MCP y el shell del motor viven en su grupo
      const eventos = out
        .split('\n')
        .filter((l) => l.startsWith('{'))
        .map((l) => {
          try {
            return JSON.parse(l)
          } catch {
            return null
          }
        })
        .filter(Boolean)
      res({ eventos, stderr: err, codigo: codigo ?? -1, ms: Date.now() - t0, cortePorTiempo })
    })
    hijo.on('error', (e) => res({ eventos: [], stderr: String(e), codigo: 127, ms: Date.now() - t0, cortePorTiempo: false }))
  })
}

function acumular(m, r) {
  m.ms += r.ms
  for (const e of r.eventos) {
    m.sessionID ??= e.sessionID
    if (e.type === 'step_finish') {
      const t = e.part?.tokens ?? {}
      m.entrada += t.input ?? 0
      m.salida += t.output ?? 0
      m.cache_leida += t.cache?.read ?? 0
      m.porPaso.push((t.input ?? 0) + (t.cache?.read ?? 0))
      m.pasos += 1
    } else if (e.type === 'tool_use') {
      const h = e.part?.tool ?? '?'
      m.herramientas[h] = (m.herramientas[h] ?? 0) + 1
      m.llamadas += 1
      m.bytes_resultados += String(e.part?.state?.output ?? e.part?.state?.error ?? '').length
    } else if (e.type === 'informe') {
      m.motor = e // el informe del motor de la última invocación
      m.motivos.push(e.motivo)
    } else if (e.type === 'error') {
      m.errores.push(JSON.stringify(e.error ?? e).slice(0, 300))
    } else if (e.type === 'permiso_negado') m.permisos_negados += 1
  }
  m.stderr += r.stderr.slice(-1500)
}

async function unaCorrida(cfg, tarea, ctx) {
  const root = mkdtempSync(join(tmpdir(), 'lz-bench-'))
  const proj = join(root, 'proyecto')
  const home = join(root, 'home')
  for (const d of [proj, home, join(root, 'tmp')]) mkdirSync(d, { recursive: true })
  const m = { porPaso: [], ms: 0, entrada: 0, salida: 0, cache_leida: 0, pasos: 0, llamadas: 0, herramientas: {}, bytes_resultados: 0, errores: [], motivos: [], permisos_negados: 0, stderr: '', motor: null }
  let proveedor = null
  let verificacion
  try {
    tarea.preparar(proj, ctx)
    // Proveedor con clave (p. ej. un plan de pago): se copia el auth.json indicado al HOME temporal de la corrida (0600). La clave nunca
    // se lee ni se guarda en el resultado; el HOME temporal se borra al terminar.
    const auth = cfg.authArchivo ?? process.env.BENCH_AUTH_FILE
    if (auth && !cfg.falso) {
      const dst = join(home, '.local/share/opencode')
      mkdirSync(dst, { recursive: true })
      copyFileSync(auth, join(dst, 'auth.json'))
      chmodSync(join(dst, 'auth.json'), 0o600)
    }
    // Configuración GLOBAL del motor (p. ej. {"compaction":{"umbral":60000}}): va al opencode.json del HOME temporal, nunca al proyecto.
    if (cfg.configGlobal) {
      const dc = join(home, '.config/opencode')
      mkdirSync(dc, { recursive: true })
      writeFileSync(join(dc, 'opencode.json'), cfg.configGlobal)
    }
    spawnSync('git', ['init', '-q'], { cwd: proj })
    spawnSync('git', ['add', '-A'], { cwd: proj })
    spawnSync('git', ['-c', 'user.name=banco', '-c', 'user.email=banco@lazunox.local', 'commit', '-qm', 'inicio', '--allow-empty'], { cwd: proj })
    if (cfg.falso) proveedor = await iniciarProveedorFalso(cfg.sinGuion?.includes(tarea.id) ? null : (tarea.guion?.(proj) ?? null))
    const entorno = entornoMotor(cfg, root, home, proj, tarea, proveedor)
    const modelo = cfg.falso ? 'fake/m' : (cfg.modelo ?? MODELO_GRATIS)
    let sessionID
    for (let i = 0; i < tarea.pedidos.length; i++) {
      const argv = [
        'run', '--format', 'json', '--permisos', 'ninguno',
        '--max-steps', String(cfg.maxPasos),
        '--presupuesto-tokens', String(Math.max(1, Math.max(cfg.presupuesto, tarea.presupuesto ?? 0) - m.entrada - m.salida)),
        '--model', modelo,
        ...(sessionID ? ['--session', sessionID] : [])
      ]
      const r = await lanzarRun(cfg, entorno, proj, argv, tarea.pedidos[i])
      acumular(m, r)
      sessionID ??= m.sessionID
      if (r.cortePorTiempo) m.errores.push(`tiempo agotado (${cfg.timeoutMin} min)`)
      if (r.cortePorTiempo || m.motivos.at(-1) === 'max_pasos' || m.motivos.at(-1) === 'presupuesto_tokens') break
      if (!sessionID && tarea.pedidos.length > 1) {
        m.errores.push('no se obtuvo el id de sesión para encadenar los pedidos')
        break
      }
    }
    try {
      verificacion = tarea.verificar(proj, ctx)
    } catch (e) {
      verificacion = { ok: false, detalle: `el verificador lanzó: ${String(e?.message ?? e).slice(0, 200)}` }
    }
  } finally {
    await proveedor?.detener()
    if (!cfg.conservar) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
  const cuota = !verificacion.ok && CUOTA.test(`${m.errores.join(' ')} ${m.stderr} ${m.motor?.detalle ?? ''}`)
  const enviados = m.entrada + m.cache_leida
  return {
    ok: verificacion.ok,
    cuota,
    detalle: verificacion.detalle,
    motivo: m.motivos.at(-1) ?? (m.errores.length ? 'error' : 'sin_informe'),
    tokens: { entrada: m.entrada, salida: m.salida, cache_leida: m.cache_leida, enviados },
    pasos: m.pasos,
    tokens_por_paso: { med: mediana(m.porPaso), p90: percentil(m.porPaso, 90) },
    llamadas: m.llamadas,
    herramientas: m.herramientas,
    bytes_resultados: m.bytes_resultados,
    permisos_negados: m.permisos_negados,
    tiempo_ms: m.ms,
    peticiones_modelo: proveedor?.peticiones() ?? null,
    ...(m.errores.length ? { errores: m.errores.slice(0, 5) } : {}),
    ...(cfg.conservar ? { carpeta: root } : {})
  }
}

// ── Resumen y tabla ───────────────────────────────────────────────────────────────────────────────────────────────────────
function resumir(corridas) {
  const validas = corridas.filter((c) => !c.cuota)
  const exitos = validas.filter((c) => c.ok)
  const enviados = mediana(validas.map((c) => c.tokens.enviados))
  const exitosEnviados = exitos.map((c) => c.tokens.enviados + c.tokens.salida)
  return {
    n: validas.length,
    cuota: corridas.length - validas.length,
    exitos: exitos.length,
    tokens_enviados_med: enviados,
    tokens_salida_med: mediana(validas.map((c) => c.tokens.salida)),
    cache_pct_med: mediana(validas.map((c) => (c.tokens.enviados ? (100 * c.tokens.cache_leida) / c.tokens.enviados : 0))),
    pasos_med: mediana(validas.map((c) => c.pasos)),
    tokens_por_paso_med: mediana(validas.map((c) => c.tokens_por_paso?.med)),
    tokens_por_paso_p90: mediana(validas.map((c) => c.tokens_por_paso?.p90)),
    llamadas_med: mediana(validas.map((c) => c.llamadas)),
    minutos_med: mediana(validas.map((c) => c.tiempo_ms / 60_000)),
    tokens_por_exito: exitos.length ? mediana(exitosEnviados) : null
  }
}

function agregados(porTarea) {
  const filas = Object.values(porTarea).filter((t) => !t.omitida)
  const todas = filas.flatMap((t) => t.corridas).filter((c) => !c.cuota)
  const exitos = todas.filter((c) => c.ok)
  return {
    corridas: todas.length,
    exitos: exitos.length,
    tasa_exito: todas.length ? exitos.length / todas.length : null,
    tokens_por_exito_med: exitos.length ? mediana(exitos.map((c) => c.tokens.enviados + c.tokens.salida)) : null,
    minutos_p90: percentil(todas.map((c) => c.tiempo_ms / 60_000), 90)
  }
}

const num = (v, d = 0) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('es-CL', { maximumFractionDigits: d }))

function imprimirTabla(salida) {
  const L = ['| Tarea | Éxito | Tokens enviados (med) | Tokens salida (med) | Caché % | Pasos (med) | Tokens/paso (med · p90) | Llamadas (med) | Min (med) | Tokens/éxito |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|']
  for (const [id, t] of Object.entries(salida.tareas)) {
    if (t.omitida) {
      L.push(`| ${id} ${t.nombre} | omitida (${t.omitida}) | | | | | | | | |`)
      continue
    }
    const r = t.resumen
    const exito = `${r.exitos}/${r.n}${r.cuota ? ` (+${r.cuota} cuota)` : ''}`
    L.push(`| ${id} ${t.nombre} | ${exito} | ${num(r.tokens_enviados_med)} | ${num(r.tokens_salida_med)} | ${num(r.cache_pct_med, 1)} | ${num(r.pasos_med, 1)} | ${num(r.tokens_por_paso_med)} · ${num(r.tokens_por_paso_p90)} | ${num(r.llamadas_med, 1)} | ${num(r.minutos_med, 2)} | ${num(r.tokens_por_exito)} |`)
  }
  const a = salida.agregados
  L.push('', `Éxito total: ${a.exitos}/${a.corridas}${a.tasa_exito === null ? '' : ` (${(100 * a.tasa_exito).toFixed(0)} %)`} · mediana de tokens por éxito: ${num(a.tokens_por_exito_med)} · p90 de minutos: ${num(a.minutos_p90, 2)}`)
  console.log(L.join('\n'))
}

// ── Comparar dos resultados ───────────────────────────────────────────────────────────────────────────────────────────────
const delta = (a, b) => (a === null || b === null || a === undefined || b === undefined ? '—' : a === 0 ? (b === 0 ? '0 %' : '+∞') : `${b >= a ? '+' : ''}${(((b - a) / a) * 100).toFixed(0)} %`)

/** Mediana y rango [mín, máx] de una lista de números (ignora los que no lo son). */
export function dispersion(lista) {
  const v = lista.filter((x) => Number.isFinite(x))
  if (!v.length) return { n: 0, med: null, min: null, max: null }
  return { n: v.length, med: mediana(v), min: Math.min(...v), max: Math.max(...v) }
}

/** Mínimo de repeticiones válidas (por lado) para opinar sobre el ruido. */
export const MIN_REPS_RUIDO = 5

/**
 * ¿La diferencia entre dos series cae dentro del ruido? Con menos de MIN_REPS_RUIDO corridas válidas en algún lado no hay veredicto
 * (`null`). Con suficientes, es «ruido» si los rangos [mín, máx] se solapan; si no se solapan, la serie «después» queda por debajo o por encima.
 */
export function veredictoRuido(antes, despues) {
  const a = dispersion(antes)
  const d = dispersion(despues)
  if (a.n < MIN_REPS_RUIDO || d.n < MIN_REPS_RUIDO) return { veredicto: null, a, d }
  if (d.min <= a.max && a.min <= d.max) return { veredicto: 'ruido', a, d }
  return { veredicto: d.max < a.min ? 'menor' : 'mayor', a, d }
}

const rango = (x) => (x.n ? `${num(x.med)} [${num(x.min)}–${num(x.max)}]` : '—')
const validas = (t) => (t.corridas ?? []).filter((c) => !c.cuota)

/** Lee un resultado: un archivo `.json` del banco o una carpeta de `--guardar-corridas` (un JSON por tarea/repetición). */
export function cargarResultado(ruta) {
  if (!statSync(ruta).isDirectory()) return JSON.parse(readFileSync(ruta, 'utf8'))
  const archivos = readdirSync(ruta).filter((n) => /^T\d\d-r\d+\.json$/.test(n)).sort()
  if (!archivos.length) throw new Error(`${ruta}: no hay archivos TNN-rNN.json`)
  let salida = null
  for (const n of archivos) {
    const j = JSON.parse(readFileSync(join(ruta, n), 'utf8'))
    salida ??= { version: 1, fecha: j.fecha, motor: j.motor, modelo: j.modelo, proveedorFalso: j.proveedorFalso, config: j.config, tareas: {} }
    salida.fecha = j.fecha > salida.fecha ? j.fecha : salida.fecha
    const t = (salida.tareas[j.tarea] ??= { nombre: j.nombre, mide: j.mide, categoria: j.categoria, corridas: [] })
    t.corridas.push(j.corrida)
  }
  for (const t of Object.values(salida.tareas)) t.resumen = resumir(t.corridas)
  salida.repeticiones = Math.max(...Object.values(salida.tareas).map((t) => t.corridas.length))
  salida.agregados = agregados(salida.tareas)
  return salida
}

function comparar(rutaA, rutaB) {
  const A = cargarResultado(rutaA)
  const B = cargarResultado(rutaB)
  console.log(`Antes: ${rutaA} (motor ${A.motor?.version ?? '?'}, ${A.proveedorFalso ? 'proveedor falso' : A.modelo}, ${A.fecha})`)
  console.log(`Después: ${rutaB} (motor ${B.motor?.version ?? '?'}, ${B.proveedorFalso ? 'proveedor falso' : B.modelo}, ${B.fecha})`)
  if (A.proveedorFalso !== B.proveedorFalso || (!A.proveedorFalso && A.modelo !== B.modelo)) console.log('AVISO: no se compara el mismo modelo/proveedor; las diferencias pueden no ser del motor.')
  if (!A.proveedorFalso && A.fecha?.slice(0, 10) !== B.fecha?.slice(0, 10)) console.log('AVISO: las corridas son de días distintos; un modelo gratuito o de plan puede cambiar de un día a otro (conviene medir ambos motores el mismo día).')
  const L = ['', '| Tarea | Éxito antes → después | Tokens enviados: mediana [rango] antes → después | Δ tokens | Pasos: mediana [rango] antes → después | Δ pasos | Minutos Δ | Ruido |', '|---|---|---|---:|---|---:|---:|---|']
  let sumaA = 0
  let sumaB = 0
  const caidas = []
  const pocas = []
  const ruido = []
  const ids = [...new Set([...Object.keys(A.tareas), ...Object.keys(B.tareas)])].sort()
  for (const id of ids) {
    const a = A.tareas[id]
    const b = B.tareas[id]
    if (!a || !b || a.omitida || b.omitida) {
      L.push(`| ${id} | ${!a ? 'solo en después' : !b ? 'solo en antes' : 'omitida'} | | | | | | |`)
      continue
    }
    const ra = a.resumen
    const rb = b.resumen
    if (ra.n) sumaA += ra.exitos / ra.n
    if (rb.n) sumaB += rb.exitos / rb.n
    if (ra.n && rb.n && ra.exitos === ra.n && rb.exitos === 0) caidas.push(id)
    const tok = veredictoRuido(validas(a).map((c) => c.tokens.enviados), validas(b).map((c) => c.tokens.enviados))
    const pas = veredictoRuido(validas(a).map((c) => c.pasos), validas(b).map((c) => c.pasos))
    let nota
    if (tok.veredicto === null) {
      nota = `n<${MIN_REPS_RUIDO}: sin veredicto`
      pocas.push(id)
    } else if (tok.veredicto === 'ruido') {
      nota = 'dentro del ruido'
      ruido.push(id)
    } else nota = `fuera del ruido (tokens ${tok.veredicto})${pas.veredicto === 'ruido' ? '; pasos dentro del ruido' : ''}`
    L.push(`| ${id} ${b.nombre} | ${ra.exitos}/${ra.n} → ${rb.exitos}/${rb.n} | ${rango(tok.a)} → ${rango(tok.d)} | ${delta(ra.tokens_enviados_med, rb.tokens_enviados_med)} | ${rango(pas.a)} → ${rango(pas.d)} | ${delta(ra.pasos_med, rb.pasos_med)} | ${delta(ra.minutos_med, rb.minutos_med)} | ${nota} |`)
    if (ra.tokens_por_paso_med != null && rb.tokens_por_paso_med != null) L.push(`| ↳ tokens por paso (med · p90) | | ${num(ra.tokens_por_paso_med)} · ${num(ra.tokens_por_paso_p90)} → ${num(rb.tokens_por_paso_med)} · ${num(rb.tokens_por_paso_p90)} | ${delta(ra.tokens_por_paso_med, rb.tokens_por_paso_med)} | | | | |`)
  }
  console.log(L.join('\n'))
  const aa = A.agregados
  const ab = B.agregados
  console.log(`\nÉxito total: ${aa.exitos}/${aa.corridas} → ${ab.exitos}/${ab.corridas} · tokens por éxito (med): ${num(aa.tokens_por_exito_med)} → ${num(ab.tokens_por_exito_med)} (${delta(aa.tokens_por_exito_med, ab.tokens_por_exito_med)}) · p90 de minutos: ${num(aa.minutos_p90, 2)} → ${num(ab.minutos_p90, 2)}`)
  if (pocas.length) console.log(`\nRUIDO: con menos de ${MIN_REPS_RUIDO} repeticiones por lado no se puede separar mejora de ruido (${pocas.join(', ')}); no declares mejoras con estas cifras.`)
  if (ruido.length) console.log(`RUIDO: diferencia dentro del ruido (los rangos de tokens enviados se solapan) en ${ruido.join(', ')}; no cuenta como mejora ni como empeoramiento.`)
  const veredicto = []
  if (sumaA - sumaB > 1) veredicto.push(`el éxito total baja más de 1 tarea (${sumaA.toFixed(1)} → ${sumaB.toFixed(1)})`)
  if (caidas.length) veredicto.push(`pasaron de éxito estable a 0: ${caidas.join(', ')}`)
  console.log(veredicto.length ? `\nCRITERIO DE OLA: NO se cumple — ${veredicto.join('; ')}.` : '\nCRITERIO DE OLA (éxito): se cumple (no baja más de 1 tarea y ninguna cae de estable a 0).')
  return veredicto.length ? 1 : 0
}

// ── Autoprueba: los verificadores discriminan (sin motor ni modelo) ────────────────────────────────────────────────────────
function aplicarPaso(proj, paso) {
  const abs = (p) => (p.startsWith('/') ? p : join(proj, p))
  switch (paso.name) {
    case 'write':
      mkdirSync(dirname(abs(paso.args.filePath)), { recursive: true })
      writeFileSync(abs(paso.args.filePath), paso.args.content)
      return
    case 'edit': {
      const t = readFileSync(abs(paso.args.filePath), 'utf8')
      if (!t.includes(paso.args.oldString)) throw new Error(`edit: no se encontró el texto en ${paso.args.filePath}`)
      writeFileSync(abs(paso.args.filePath), paso.args.replaceAll ? t.split(paso.args.oldString).join(paso.args.newString) : t.replace(paso.args.oldString, () => paso.args.newString))
      return
    }
    case 'bash': {
      const r = spawnSync('/bin/sh', ['-c', paso.args.command], { cwd: proj, encoding: 'utf8', timeout: 60_000 })
      if (r.error) throw r.error
      return
    }
    default: // read, grep, todowrite, herramientas del conector: sin efecto en archivos
  }
}

async function autoprueba(cfg, tareas, ctx) {
  let malas = 0
  for (const tarea of tareas) {
    const faltan = (tarea.requiere ?? []).filter((r) => (r === 'typescript' ? !ctx.typescript : false))
    if (faltan.length) {
      console.log(`${tarea.id}: omitida (falta ${faltan.join(', ')})`)
      continue
    }
    const root = mkdtempSync(join(tmpdir(), 'lz-bench-auto-'))
    const proj = join(root, 'proyecto')
    mkdirSync(proj, { recursive: true })
    try {
      tarea.preparar(proj, ctx)
      const antes = tarea.verificar(proj, ctx)
      let despues = { ok: null, detalle: 'sin guion' }
      if (tarea.guion) {
        for (const turno of tarea.guion(proj).turnos) for (const paso of turno) aplicarPaso(proj, paso)
        despues = tarea.verificar(proj, ctx)
      }
      const bien = !antes.ok && (tarea.guion ? despues.ok : true)
      if (!bien) malas++
      console.log(`${tarea.id}: ${bien ? 'ok' : 'MAL'} · inicial ${antes.ok ? 'PASA (debería fallar)' : 'falla'} (${(antes.detalle ?? '').slice(0, 60)}) · con guion ${despues.ok === null ? 'sin guion' : despues.ok ? 'pasa' : 'FALLA: ' + despues.detalle}`)
    } catch (e) {
      malas++
      console.log(`${tarea.id}: MAL · ${String(e?.message ?? e).slice(0, 200)}`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
  console.log(malas ? `\n${malas} tarea(s) con problemas.` : '\nTodas las tareas discriminan: fallan al inicio y pasan con su guion.')
  return malas ? 1 : 0
}

// ── Principal ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function principal() {
  const cfg = leerArgs(process.argv.slice(2))
  if (cfg.ayuda) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'))
    return 0
  }
  if (cfg.comparar) return comparar(cfg.comparar[0], cfg.comparar[1])
  const todas = await cargarTareas()
  if (cfg.lista) {
    for (const t of todas) console.log(`${t.id}  [${t.categoria}]  ${t.nombre}  — mide: ${t.mide}${t.requiere ? `  (requiere ${t.requiere.join(', ')})` : ''}${t.guion ? '' : '  (sin guion del proveedor falso)'}`)
    return 0
  }
  if (!cfg.motor && !cfg.autoprueba) throw new Error('falta --motor <binario> (o usa --lista / --comparar / --autoprueba)')
  if (process.platform === 'darwin' || process.platform === 'win32' || !(existsSync('/.dockerenv') || process.env.BENCH_EN_CONTENEDOR === '1'))
    throw new Error('el banco corre SOLO dentro de un contenedor del VPS (ver la cabecera de este archivo: docker run … node:22-bookworm). No lo lances en el Mac.')
  if (!cfg.autoprueba && (!existsSync(cfg.motor) || !statSync(cfg.motor).isFile())) throw new Error(`no existe el motor en ${cfg.motor}`)
  const sel = cfg.tareas ? todas.filter((t) => cfg.tareas.includes(t.id)) : todas
  const desconocidas = (cfg.tareas ?? []).filter((id) => !todas.some((t) => t.id === id))
  if (desconocidas.length) throw new Error(`tareas desconocidas: ${desconocidas.join(', ')}`)

  const ts = cfg.typescript ?? process.env.BENCH_TYPESCRIPT
  const ctx = { typescript: ts ? resolve(ts) : null }
  if (cfg.autoprueba) return autoprueba(cfg, sel, ctx)
  const version = spawnSync(cfg.motor, ['--version'], { encoding: 'utf8', timeout: 20_000 }).stdout?.trim() || 'desconocida'
  const ayudaRun = spawnSync(cfg.motor, ['run', '--help'], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, HOME: tmpdir() } })
  if (!/--permisos/.test(`${ayudaRun.stdout}${ayudaRun.stderr}`) || !/--max-steps/.test(`${ayudaRun.stdout}${ayudaRun.stderr}`))
    throw new Error('este motor no trae las banderas de `run` del banco (--permisos, --max-steps, --presupuesto-tokens, --informe); compila el fork con la rama feat/run-banderas')
  const modelo = cfg.falso ? 'fake/m' : (cfg.modelo ?? MODELO_GRATIS)
  console.error(`Motor ${cfg.motor} (${version}) · ${cfg.falso ? 'proveedor falso' : modelo} · ${sel.length} tareas × ${cfg.repeticiones}`)

  let base = null
  if (cfg.reanudar) {
    if (!cfg.tareas) throw new Error('--reanudar necesita --tareas (las que se repiten)')
    base = JSON.parse(readFileSync(cfg.reanudar, 'utf8'))
    if (base.modelo !== modelo || base.proveedorFalso !== !!cfg.falso) throw new Error(`--reanudar: el archivo es de ${base.proveedorFalso ? 'proveedor falso' : base.modelo}, no de ${cfg.falso ? 'proveedor falso' : modelo}`)
  }
  const salida = base ? { ...base, fecha: new Date().toISOString(), reanudado_de: cfg.reanudar } : {
    version: 1,
    fecha: new Date().toISOString(),
    motor: { ruta: cfg.motor, version },
    modelo,
    proveedorFalso: !!cfg.falso,
    repeticiones: cfg.repeticiones,
    config: { config_global: cfg.configGlobal ?? null, max_pasos: cfg.maxPasos, presupuesto_tokens: cfg.presupuesto, timeout_min: cfg.timeoutMin, env: cfg.env },
    tareas: {}
  }
  for (const tarea of sel) {
    const base = { nombre: tarea.nombre, mide: tarea.mide, categoria: tarea.categoria }
    const faltan = (tarea.requiere ?? []).filter((r) => (r === 'typescript' ? !ctx.typescript || !existsSync(join(ctx.typescript, 'bin', 'tsc')) : r === 'python3' ? spawnSync('python3', ['--version']).status !== 0 : false))
    if (faltan.length) {
      salida.tareas[tarea.id] = { ...base, omitida: `falta ${faltan.join(', ')}`, corridas: [] }
      console.error(`${tarea.id}: omitida (falta ${faltan.join(', ')})`)
      continue
    }
    const corridas = []
    for (let i = 1; i <= cfg.repeticiones; i++) {
      const archivoRep = cfg.guardarCorridas ? join(cfg.guardarCorridas, `${tarea.id}-r${String(i).padStart(2, '0')}.json`) : null
      let c = null
      if (archivoRep && existsSync(archivoRep)) {
        // Repetición ya medida (otra tanda u otro día): se reutiliza salvo que haya salido por cuota.
        const previa = JSON.parse(readFileSync(archivoRep, 'utf8'))
        if (!previa.corrida?.cuota && previa.modelo === modelo && previa.motor?.version === version) {
          c = previa.corrida
          console.error(`${tarea.id} #${i}: ya medida (${archivoRep}); se reutiliza`)
        }
      }
      if (!c) {
        c = await unaCorrida(cfg, tarea, ctx)
        if (c.cuota && !cfg.falso) {
          console.error(`${tarea.id} #${i}: cuota agotada; espero ${cfg.esperaCuotaSeg} s y reintento una vez`)
          await new Promise((r) => setTimeout(r, cfg.esperaCuotaSeg * 1000))
          c = await unaCorrida(cfg, tarea, ctx)
        }
        if (archivoRep) {
          // Un JSON por tarea y repetición, escrito ya: lo medido sobrevive aunque se corte la tanda.
          mkdirSync(cfg.guardarCorridas, { recursive: true })
          writeFileSync(archivoRep, JSON.stringify({ version: 1, fecha: new Date().toISOString(), tarea: tarea.id, repeticion: i, ...base, motor: salida.motor, modelo, proveedorFalso: !!cfg.falso, config: salida.config, corrida: c }, null, 2) + '\n')
        }
        console.error(`${tarea.id} #${i}: ${c.cuota ? 'CUOTA' : c.ok ? 'ok' : 'FALLA'} (${c.motivo}) · ${c.pasos} pasos · ${c.tokens.enviados + c.tokens.salida} tokens · ${(c.tiempo_ms / 1000).toFixed(1)} s${c.ok ? '' : ' · ' + (c.detalle ?? '').slice(0, 140)}`)
      }
      corridas.push(c)
      if (cfg.salida && /\.json$/.test(cfg.salida)) {
        // Escritura incremental: si algo se corta, lo medido hasta aquí queda en el archivo (parcial).
        const parcial = { ...salida, parcial: true, tareas: { ...salida.tareas, [tarea.id]: { ...base, corridas, resumen: resumir(corridas) } } }
        parcial.agregados = agregados(parcial.tareas)
        mkdirSync(dirname(resolve(cfg.salida)), { recursive: true })
        writeFileSync(cfg.salida, JSON.stringify(parcial, null, 2) + '\n')
      }
    }
    salida.tareas[tarea.id] = { ...base, corridas, resumen: resumir(corridas) }
  }
  salida.agregados = agregados(salida.tareas)
  const sello = salida.fecha.replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')
  let destino = cfg.salida ?? process.cwd()
  if (!/\.json$/.test(destino)) destino = join(destino, `bench-${sello}.json`)
  mkdirSync(dirname(resolve(destino)), { recursive: true })
  writeFileSync(destino, JSON.stringify(salida, null, 2) + '\n')
  console.log(`\nResultado: ${destino}\n`)
  imprimirTabla(salida)
  return 0
}

principal().then(
  (c) => process.exit(c),
  (e) => {
    console.error(`bench: ${e.message}`)
    process.exit(2)
  }
)
