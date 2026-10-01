/**
 * «Probar clave»: resultado de comprobar una clave de API guardada contra su proveedor y textos para
 * mostrarlo. La prueba corre en main (la clave nunca llega al renderer); aquí solo viaja el estado.
 */
import { t } from './i18n'

export type KeyTestStatus =
  | 'ok'
  | 'invalid'
  | 'forbidden'
  | 'rate-limited'
  | 'no-credit'
  | 'offline'
  | 'unreachable'
  | 'provider-down'
  | 'timeout'
  | 'unexpected'
  | 'not-stored'
  | 'oauth'
  | 'unsupported'

export interface KeyTestResult {
  providerID: string
  status: KeyTestStatus
  /** Código HTTP del proveedor (null si no hubo respuesta o no se probó). */
  httpStatus: number | null
  /** Duración de la petición en ms (solo cuando hubo respuesta). */
  latencyMs: number | null
  checkedAt: number
}

export type KeyTestTone = 'ok' | 'warn' | 'error' | 'info'

export interface KeyTestText {
  tone: KeyTestTone
  title: string
  message: string
}

/** Textos de cada resultado (en el idioma activo). No incluyen nunca la clave (el resultado no la lleva). */
export function keyTestText(r: Pick<KeyTestResult, 'status' | 'httpStatus' | 'latencyMs'>, providerName: string): KeyTestText {
  const provider = providerName
  const http = r.httpStatus ? t('models.keyTest.httpSuffix', { status: r.httpStatus }) : ''
  switch (r.status) {
    case 'ok':
      return {
        tone: 'ok',
        title: r.latencyMs === null ? t('models.keyTest.ok.title') : t('models.keyTest.ok.titleMs', { ms: r.latencyMs }),
        message: t('models.keyTest.ok.message', { provider })
      }
    case 'invalid':
      return { tone: 'error', title: t('models.keyTest.invalid.title'), message: t('models.keyTest.invalid.message', { provider }) }
    case 'forbidden':
      return { tone: 'error', title: t('models.keyTest.forbidden.title'), message: t('models.keyTest.forbidden.message', { provider }) }
    case 'rate-limited':
      return {
        tone: 'warn',
        title: t('models.keyTest.rateLimited.title'),
        message: t('models.keyTest.rateLimited.message', { provider })
      }
    case 'no-credit':
      return { tone: 'warn', title: t('models.keyTest.noCredit.title'), message: t('models.keyTest.noCredit.message', { provider }) }
    case 'offline':
      return { tone: 'warn', title: t('models.keyTest.offline.title'), message: t('models.keyTest.offline.message') }
    case 'unreachable':
      return {
        tone: 'warn',
        title: t('models.keyTest.unreachable.title'),
        message: t('models.keyTest.unreachable.message', { provider })
      }
    case 'provider-down':
      return {
        tone: 'warn',
        title: t('models.keyTest.providerDown.title'),
        message: t('models.keyTest.providerDown.message', { provider, http })
      }
    case 'timeout':
      return { tone: 'warn', title: t('models.keyTest.timeout.title'), message: t('models.keyTest.timeout.message', { provider }) }
    case 'unexpected':
      return {
        tone: 'warn',
        title: t('models.keyTest.unexpected.title'),
        message: t('models.keyTest.unexpected.message', { provider, http })
      }
    case 'not-stored':
      return { tone: 'info', title: t('models.keyTest.notStored.title'), message: t('models.keyTest.notStored.message', { provider }) }
    case 'oauth':
      return { tone: 'info', title: t('models.keyTest.oauth.title'), message: t('models.keyTest.oauth.message', { provider }) }
    case 'unsupported':
      return {
        tone: 'info',
        title: t('models.keyTest.unsupported.title'),
        message: t('models.keyTest.unsupported.message', { provider })
      }
  }
}

/** ¿El resultado indica que la clave sirve (o que, al menos, el proveedor la reconoce)? */
export function keyTestIsGood(r: Pick<KeyTestResult, 'status'>): boolean {
  return r.status === 'ok'
}
