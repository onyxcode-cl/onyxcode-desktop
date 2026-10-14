/**
 * Qué proveedores con credencial verá un servidor sandbox al arrancar (solo IDS, nunca claves).
 *
 * El servidor sandbox lee `auth.json` una sola vez al arrancar (`startTasksServer`): si el usuario conecta OpenCode Go después,
 * el servidor ya en marcha no lo conoce. El gestor incluye estos ids en la firma del servidor para detectarlo y reiniciarlo.
 * Mismo criterio que `placeholderAuthContent`: solo proveedores de `PROVIDER_TARGETS` con `key` de texto no vacío.
 */
import { readFileSync } from 'node:fs'
import { PROVIDER_TARGETS } from './provider-egress'

export function sandboxCredentialIds(file: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { key?: unknown }> | null
    if (!parsed || typeof parsed !== 'object') return []
    return Object.keys(PROVIDER_TARGETS)
      .filter((id) => {
        const e = Object.prototype.hasOwnProperty.call(parsed, id) ? parsed[id] : undefined
        return !!e && typeof e === 'object' && typeof e.key === 'string' && e.key.length > 0
      })
      .sort()
  } catch {
    return []
  }
}
