/**
 * Validadores mínimos (sin dependencias) para los payloads IPC que llegan del renderer.
 *
 * Cada validador recibe un `unknown` y devuelve el valor tipado o lanza `ValidationError` con la
 * ruta del campo. Los objetos son ESTRICTOS: una clave no declarada se rechaza (un renderer
 * comprometido no puede colar opciones que main no espera). Los strings llevan tope de longitud.
 */

export class ValidationError extends Error {}

export type Validator<T> = (value: unknown, path?: string) => T

const MAX_STRING = 64 * 1024

function fail(path: string, expected: string, value: unknown): never {
  const got = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  throw new ValidationError(`Parámetro inválido en "${path || 'req'}": se esperaba ${expected} (llegó ${got})`)
}

export function str(opts: { max?: number; min?: number; pattern?: RegExp } = {}): Validator<string> {
  const max = opts.max ?? MAX_STRING
  return (v, path = '') => {
    if (typeof v !== 'string') fail(path, 'texto', v)
    if (v.length > max) throw new ValidationError(`Parámetro "${path}" demasiado largo (máx. ${max})`)
    if (opts.min !== undefined && v.length < opts.min) throw new ValidationError(`Parámetro "${path}" vacío`)
    if (opts.pattern && !opts.pattern.test(v)) throw new ValidationError(`Parámetro "${path}" con formato inválido`)
    return v
  }
}

/** Ruta absoluta (POSIX o Windows), sin bytes nulos. */
export const absPath: Validator<string> = (v, path = '') => {
  const s = str({ max: 4096, min: 1 })(v, path)
  if (s.includes('\0')) throw new ValidationError(`Parámetro "${path}" con bytes nulos`)
  if (!(s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s))) throw new ValidationError(`Parámetro "${path}" debe ser una ruta absoluta`)
  return s
}

export function num(opts: { min?: number; max?: number; int?: boolean } = {}): Validator<number> {
  return (v, path = '') => {
    if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'número', v)
    if (opts.int && !Number.isInteger(v)) fail(path, 'entero', v)
    if (opts.min !== undefined && v < opts.min) throw new ValidationError(`Parámetro "${path}" < ${opts.min}`)
    if (opts.max !== undefined && v > opts.max) throw new ValidationError(`Parámetro "${path}" > ${opts.max}`)
    return v
  }
}

export const bool: Validator<boolean> = (v, path = '') => {
  if (typeof v !== 'boolean') fail(path, 'booleano', v)
  return v
}

export function literal<const T extends string | number | boolean>(...values: T[]): Validator<T> {
  return (v, path = '') => {
    if (!values.includes(v as T)) fail(path, values.map((x) => JSON.stringify(x)).join(' | '), v)
    return v as T
  }
}

/** Canales sin payload: el preload envía `undefined` (o nada). */
export const none: Validator<void> = (v, path = '') => {
  if (v !== undefined && v !== null) fail(path, 'sin parámetros', v)
}

export function optional<T>(inner: Validator<T>): Validator<T | undefined> {
  return (v, path) => (v === undefined || v === null ? undefined : inner(v, path))
}

export function nullable<T>(inner: Validator<T>): Validator<T | null> {
  return (v, path) => (v === null ? null : inner(v, path))
}

export function arr<T>(inner: Validator<T>, max = 1000): Validator<T[]> {
  return (v, path = '') => {
    if (!Array.isArray(v)) fail(path, 'lista', v)
    if (v.length > max) throw new ValidationError(`Parámetro "${path}" con demasiados elementos (máx. ${max})`)
    return v.map((x, i) => inner(x, `${path}[${i}]`))
  }
}

/** Objeto con claves string → valor validado (p.ej. variables de entorno). */
export function record<T>(inner: Validator<T>, maxKeys = 200): Validator<Record<string, T>> {
  return (v, path = '') => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) fail(path, 'objeto', v)
    const entries = Object.entries(v as Record<string, unknown>)
    if (entries.length > maxKeys) throw new ValidationError(`Parámetro "${path}" con demasiadas claves`)
    const out: Record<string, T> = {}
    for (const [k, val] of entries) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') throw new ValidationError(`Clave no permitida en "${path}"`)
      str({ max: 256 })(k, `${path}.<clave>`)
      out[k] = inner(val, `${path}.${k}`)
    }
    return out
  }
}

type Shape = Record<string, Validator<unknown>>
type ShapeOut<S extends Shape> = {
  [K in keyof S as undefined extends ReturnType<S[K]> ? never : K]: ReturnType<S[K]>
} & {
  [K in keyof S as undefined extends ReturnType<S[K]> ? K : never]?: ReturnType<S[K]>
}

/** Objeto estricto: rechaza claves no declaradas. Omite en la salida las opcionales ausentes. */
export function obj<S extends Shape>(shape: S): Validator<ShapeOut<S>> {
  return (v, path = '') => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) fail(path, 'objeto', v)
    const input = v as Record<string, unknown>
    for (const k of Object.keys(input)) {
      if (!Object.prototype.hasOwnProperty.call(shape, k)) throw new ValidationError(`Clave inesperada "${path ? `${path}.` : ''}${k}"`)
    }
    const out: Record<string, unknown> = {}
    for (const [k, validate] of Object.entries(shape)) {
      const val = validate(input[k], path ? `${path}.${k}` : k)
      if (val !== undefined) out[k] = val
    }
    return out as ShapeOut<S>
  }
}

/** Objeto parcial (todas las claves opcionales), p.ej. `settings:set`. */
export function partial<S extends Shape>(shape: S): Validator<Partial<ShapeOut<S>>> {
  const optionalShape: Shape = {}
  for (const [k, validate] of Object.entries(shape)) optionalShape[k] = optional(validate)
  return obj(optionalShape) as Validator<Partial<ShapeOut<S>>>
}

/** Unión discriminada por `key`. */
export function tagged<K extends string, M extends Record<string, Validator<unknown>>>(
  key: K,
  variants: M
): Validator<ReturnType<M[keyof M]>> {
  return (v, path = '') => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) fail(path, 'objeto', v)
    const tag = (v as Record<string, unknown>)[key]
    if (typeof tag !== 'string' || !Object.prototype.hasOwnProperty.call(variants, tag)) {
      fail(path ? `${path}.${key}` : key, Object.keys(variants).join(' | '), tag)
    }
    return variants[tag](v, path) as ReturnType<M[keyof M]>
  }
}
