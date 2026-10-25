// Utilidades del banco de tareas: números pseudoaleatorios con semilla (carpetas iniciales idénticas en cada corrida),
// escritura de archivos, ejecución de comandos para los verificadores y estadística (mediana, percentil).
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** mulberry32: generador determinista. `r()` en [0,1); `r.int(a, b)` entero en [a, b]; `r.pick(lista)`. */
export function prng(semilla) {
  let a = semilla >>> 0
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  r.int = (min, max) => min + Math.floor(r() * (max - min + 1))
  r.pick = (lista) => lista[Math.floor(r() * lista.length)]
  return r
}

/** Escribe `ruta` (relativa a `dir`) creando las carpetas que falten. */
export function escribir(dir, ruta, texto) {
  const destino = join(dir, ruta)
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, texto)
}

export const leer = (dir, ruta) => readFileSync(join(dir, ruta), 'utf8')
export const sha = (texto) => createHash('sha256').update(texto).digest('hex')

/** Corre un comando SIN shell y devuelve { code, out } (stdout + stderr). Nunca lanza. */
export function correr(cmd, args, { cwd, timeoutMs = 30_000, env } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, env: env ?? process.env, maxBuffer: 16 * 1024 * 1024 })
  return { code: r.status ?? (r.error ? 127 : 1), out: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}` }
}

/** `node <archivo>` con el mismo node que corre el banco. */
export const node = (dir, ...args) => correr(process.execPath, args, { cwd: dir })

export function mediana(lista) {
  const v = lista.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

export function percentil(lista, p) {
  const v = lista.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  return v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)]
}

/** Resultado de un verificador. */
export const ok = (detalle = 'ok') => ({ ok: true, detalle })
export const falla = (detalle) => ({ ok: false, detalle })

/** Versiones de un número como podría escribirlo un modelo: 12345, 12.345, 12,345, 12 345. */
export function formasNumero(n) {
  const s = String(Math.round(n))
  const miles = (sep) => s.replace(/\B(?=(\d{3})+(?!\d))/g, sep)
  return [s, miles('.'), miles(','), miles(' '), miles(' ')]
}

/** ¿Aparece `n` (en cualquiera de sus formas) como número completo dentro de `texto`? */
export function contieneNumero(texto, n) {
  return formasNumero(n).some((f) => {
    const esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?<![\\d.,])${esc}(?![\\d]|[.,]\\d)`).test(texto)
  })
}
