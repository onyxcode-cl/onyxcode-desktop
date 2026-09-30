import { isAllowedAccountBase } from '@shared/account-url'

export interface AccountConfig {
  /** false = cuenta apagada: no se exige login y no se hace ninguna petición. */
  enabled: boolean
  /** Origen del servidor sin barra final; null si está apagada o la dirección es inválida (falla cerrado). */
  baseUrl: string | null
  /** Solo pruebas (app sin empaquetar): admite `http://127.0.0.1:<puerto>` también para la URL del navegador. */
  allowLocalHttp: boolean
}

export interface AccountConfigInput {
  isPackaged: boolean
  env: Record<string, string | undefined>
  /** Valor de `ACCOUNT_API` (brand.ts). */
  api: string | null
}

/**
 * App empaquetada: SIEMPRE `ACCOUNT_API` (las variables de entorno se ignoran). Sin empaquetar
 * se respeta `ONYXCODE_ACCOUNT_URL` (servidor falso de los E2E). Una dirección inválida NO apaga la
 * cuenta: queda activa sin servidor, de modo que la app no abre (falla cerrado, nunca «sin login»).
 */
export function resolveAccountConfig(i: AccountConfigInput): AccountConfig {
  const fromEnv = !i.isPackaged ? i.env.ONYXCODE_ACCOUNT_URL : undefined
  const raw = fromEnv && fromEnv.length > 0 ? fromEnv : i.api
  if (raw === null || raw === undefined) return { enabled: false, baseUrl: null, allowLocalHttp: false }
  const allowLocalHttp = !i.isPackaged
  const base = isAllowedAccountBase(raw, allowLocalHttp)
  return { enabled: true, baseUrl: base, allowLocalHttp }
}
