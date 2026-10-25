// T05 — Leer un log de ~3 MB y escribir la causa raíz. Mide: truncado y poda de salidas.
import { escribir, falla, leer, ok, prng } from '../lib.mjs'
import { bash, escribirArchivo } from './_pasos.mjs'

const LINEAS = 30_000
const CAUSA = "ERR_POOL_AGOTADO: pool de conexiones 'pagos-db' agotado (max=20)"

export function generar(dir) {
  const r = prng(505)
  const metodos = ['GET', 'GET', 'GET', 'POST', 'PUT']
  const rutas = ['/v1/items', '/v1/clientes', '/v1/pedidos', '/v1/pagos', '/v1/envios', '/health']
  const sal = []
  const t0 = Date.UTC(2025, 2, 12, 0, 0, 0)
  for (let i = 0; i < LINEAS; i++) {
    const ts = new Date(t0 + i * 2300).toISOString().replace('.000', '')
    const ms = r.int(3, 180)
    const id = r.int(0x1000, 0xffff).toString(16)
    // Ruido benigno: errores transitorios que se resuelven con reintento (NO son la causa).
    if (i % 997 === 13) sal.push(`${ts} ERROR [api] timeout leyendo del upstream recomendaciones (reintento 1/3 ok) req=${id}`)
    else if (i % 1511 === 7) sal.push(`${ts} ERROR [mail] fallo SMTP temporal 421 (reintentado, entregado) req=${id}`)
    else if (i % 389 === 11) sal.push(`${ts} WARN  [cache] expiró la clave sesion:${id} antes de tiempo`)
    else if (i > LINEAS - 600 && i % 40 === 0) sal.push(`${ts} WARN  [pool] pagos-db en uso ${Math.min(19, 12 + Math.floor((i - (LINEAS - 600)) / 90))}/20, esperando conexión libre ${ms * 4} ms`)
    else if (i === LINEAS - 20) sal.push(`${ts} FATAL [pool] ${CAUSA} tras 3 reintentos; el proceso termina`)
    else if (i > LINEAS - 20) sal.push(`${ts} INFO  [main] apagado ordenado en curso (${LINEAS - i})`)
    else sal.push(`${ts} INFO  [api] ${r.pick(metodos)} ${r.pick(rutas)}/${r.int(1, 9999)} 200 ${ms}ms req=${id}`)
  }
  escribir(dir, 'servidor.log', sal.join('\n') + '\n')
}

export default {
  id: 'T05',
  nombre: 'Leer un log de 3 MB y escribir la causa',
  mide: 'Truncado y poda',
  categoria: 'programacion',
  pedidos: [
    'El servicio se cayó anoche. Revisa servidor.log y escribe en causa.txt, en una o dos frases, cuál fue la causa raíz de la caída (no los errores pasajeros que se resolvieron solos).'
  ],
  preparar: generar,
  verificar(dir) {
    let t
    try {
      t = leer(dir, 'causa.txt').trim()
    } catch {
      return falla('no existe causa.txt')
    }
    const m = t.toLowerCase()
    if (t.length > 700) return falla('causa.txt demasiado larga')
    if (!m.includes('pagos-db')) return falla('no nombra la base pagos-db')
    if (!/pool|conexion|conexión/.test(m)) return falla('no menciona el pool de conexiones')
    return /agotad|exhaust|lleno|sin conexiones/.test(m) ? ok() : falla('no dice que el pool se agotó')
  },
  guion: (dir) => ({
    turnos: [
      [
        bash('wc -l servidor.log && grep -c ERROR servidor.log', 'Mide el log'),
        bash('grep -n FATAL servidor.log', 'Busca el error fatal'),
        bash('grep -n "\\[pool\\]" servidor.log | tail -8', 'Mira el pool antes de la caída'),
        escribirArchivo(dir, 'causa.txt', "El pool de conexiones 'pagos-db' se agotó (20 de 20 en uso) y tras 3 reintentos el proceso terminó con ERR_POOL_AGOTADO.\n")
      ]
    ],
    final: 'La causa fue el agotamiento del pool de conexiones pagos-db.'
  })
}
