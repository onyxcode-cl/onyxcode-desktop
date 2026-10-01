/**
 * «Probar clave»: resultado de comprobar una clave de API guardada contra su proveedor y textos para
 * mostrarlo. La prueba corre en main (la clave nunca llega al renderer); aquí solo viaja el estado.
 */

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

/** Textos en español de cada resultado. No incluyen nunca la clave (el resultado no la lleva). */
export function keyTestText(r: Pick<KeyTestResult, 'status' | 'httpStatus' | 'latencyMs'>, providerName: string): KeyTestText {
  switch (r.status) {
    case 'ok':
      return {
        tone: 'ok',
        title: r.latencyMs === null ? 'Funciona' : `Funciona · ${r.latencyMs} ms`,
        message: `${providerName} aceptó la clave.`
      }
    case 'invalid':
      return {
        tone: 'error',
        title: 'Clave no válida',
        message: `${providerName} rechazó la clave: puede estar mal copiada, revocada o ser de otra cuenta. Usa «Cambiar clave».`
      }
    case 'forbidden':
      return {
        tone: 'error',
        title: 'Sin permiso',
        message: `${providerName} reconoce la clave pero no le da permiso (HTTP 403). Revisa sus permisos, la región o el plan en el panel del proveedor.`
      }
    case 'rate-limited':
      return {
        tone: 'warn',
        title: 'Límite de uso alcanzado',
        message: `${providerName} pide esperar un rato antes de volver a usar esta clave (HTTP 429). La clave parece válida.`
      }
    case 'no-credit':
      return {
        tone: 'warn',
        title: 'Sin saldo',
        message: `${providerName} indica que la cuenta no tiene saldo o requiere un pago (HTTP 402).`
      }
    case 'offline':
      return { tone: 'warn', title: 'Sin conexión a internet', message: 'No hay conexión. Revisa tu red y vuelve a probar.' }
    case 'unreachable':
      return {
        tone: 'warn',
        title: 'No se pudo contactar',
        message: `Hay internet, pero no se pudo llegar a ${providerName}. Puede ser un proxy, un firewall, un certificado o un problema del proveedor.`
      }
    case 'provider-down':
      return {
        tone: 'warn',
        title: 'El proveedor tiene problemas',
        message: `${providerName} respondió con un error de su lado${r.httpStatus ? ` (HTTP ${r.httpStatus})` : ''}. Tu clave no es el problema: prueba de nuevo más tarde.`
      }
    case 'timeout':
      return { tone: 'warn', title: 'Tardó demasiado', message: `${providerName} no respondió en 10 segundos. Vuelve a probar.` }
    case 'unexpected':
      return {
        tone: 'warn',
        title: 'Respuesta inesperada',
        message: `${providerName} respondió algo que no se esperaba${r.httpStatus ? ` (HTTP ${r.httpStatus})` : ''}. No se puede saber si la clave sirve.`
      }
    case 'not-stored':
      return {
        tone: 'info',
        title: 'No hay clave guardada',
        message: `${providerName} no usa una clave guardada en este programa (por ejemplo, viene de una variable de entorno). Guarda una clave con «Cambiar clave» para poder probarla.`
      }
    case 'oauth':
      return {
        tone: 'info',
        title: 'Conectado con inicio de sesión',
        message: `${providerName} está conectado con tu cuenta, no con una clave: no hay nada que probar.`
      }
    case 'unsupported':
      return {
        tone: 'info',
        title: 'No se puede probar',
        message: `No se puede probar sin gastar. Envía un mensaje en Chat con ${providerName} para comprobarlo.`
      }
  }
}

/** ¿El resultado indica que la clave sirve (o que, al menos, el proveedor la reconoce)? */
export function keyTestIsGood(r: Pick<KeyTestResult, 'status'>): boolean {
  return r.status === 'ok'
}
