/**
 * Puente con Telegram (entrega 1: avisos y permisos con botones). Tipos y constantes compartidos entre `main` y la ventana.
 *
 * Lo que ve la ventana de ajustes es SOLO esto: nunca el token (únicamente «configurado sí/no» y sus últimos 4 caracteres).
 * Diseño y límites: `docs/telegram.md`; seguridad: `docs/SEGURIDAD.md` §3 (F8-B187).
 */

/** Fases visibles del puente. */
export type TelegramPhase =
  /** Interruptor «Telegram activado» apagado. */
  | 'off'
  /** Activado, pero sin bot (falta el token). */
  | 'no-bot'
  /** Con bot y sin chat vinculado, sin código activo (caducó, se bloqueó o se desvinculó). */
  | 'idle'
  /** Esperando que la persona escriba el código en el bot. */
  | 'linking'
  /** Un chat vinculado: llegan avisos y permisos. */
  | 'linked'

/** Motivos de error que la ventana traduce a texto llano (nunca texto técnico de la API ni el token). */
export type TelegramErrorCode =
  | 'invalid-token' // el formato no es de un token, o Telegram lo rechaza (401)
  | 'bot-revoked' // el token dejó de valer mientras funcionaba
  | 'network' // sin conexión con Telegram
  | 'conflict' // otra aplicación está leyendo los mensajes de este bot (409)
  | 'no-secure-storage' // el almacén seguro del sistema no está disponible: no se guarda el token
  | 'rate-limited' // Telegram pidió esperar
  | 'send-failed' // no se pudo enviar el mensaje
  | 'unknown'

export interface TelegramState {
  /** Interruptor general «Telegram activado» (apagado por defecto). */
  enabled: boolean
  phase: TelegramPhase
  /** Hay un token guardado. */
  botConfigured: boolean
  /** Últimos 4 caracteres del token (para reconocerlo), o `null`. */
  tokenTail: string | null
  /** Nombre del bot (`@algo_bot`), o `null`. */
  botUsername: string | null
  /** Etiqueta del chat vinculado (el nombre que Telegram da al dueño), o `null`. */
  ownerLabel: string | null
  /** Código de 6 dígitos mientras se espera la vinculación; `null` el resto del tiempo. */
  code: string | null
  /** Caducidad del código (ms epoch). */
  codeExpiresAt: number | null
  /** Intentos fallidos que quedan antes del bloqueo temporal. */
  attemptsLeft: number | null
  /** Bloqueo temporal por intentos fallidos (ms epoch), o `null`. */
  lockedUntil: number | null
  /** Último error vigente, o `null`. */
  error: TelegramErrorCode | null
  /** El almacén seguro del sistema permite guardar el token. */
  secureStorage: boolean
  /** Permisos enviados a Telegram que siguen esperando respuesta. */
  pendingPermissions: number
}

export const TELEGRAM_DEFAULT_STATE: TelegramState = {
  enabled: false,
  phase: 'off',
  botConfigured: false,
  tokenTail: null,
  botUsername: null,
  ownerLabel: null,
  code: null,
  codeExpiresAt: null,
  attemptsLeft: null,
  lockedUntil: null,
  error: null,
  secureStorage: true,
  pendingPermissions: 0
}

/** Resultado de guardar el token. */
export type TelegramSaveTokenResult = { ok: true; botUsername: string } | { ok: false; error: TelegramErrorCode }

/** Resultado del mensaje de prueba. */
export type TelegramTestResult = { ok: true } | { ok: false; error: TelegramErrorCode | 'not-linked' | 'too-soon' }

/** Un token de bot tiene la forma `<id numérico>:<35 caracteres>`. Solo se usa para validar el formato antes de preguntar a Telegram. */
export const TELEGRAM_TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,64}$/

/** Quita espacios y saltos de línea alrededor y un posible prefijo `bot` pegado de una URL. */
export function cleanTelegramToken(raw: string): string {
  return raw.trim().replace(/^bot(?=\d)/i, '')
}

/** Enlace para abrir @BotFather (lo abre `openExternalUrl`). */
export const BOTFATHER_URL = 'https://t.me/BotFather'

/** Parámetros fijos del puente (constantes de diseño; las pruebas las inyectan). */
export const TELEGRAM_LIMITS = {
  /** Vida del código de vinculación. */
  codeTtlMs: 10 * 60_000,
  /** Intentos fallidos antes del bloqueo. */
  maxCodeAttempts: 5,
  /** Duración del bloqueo temporal. */
  lockMs: 15 * 60_000,
  /** Mensajes entrantes admitidos por minuto (el resto se descarta sin responder). */
  incomingPerMinute: 30,
  /** Vida de los botones de un permiso. */
  buttonTtlMs: 30 * 60_000,
  /** Largo máximo del mensaje de Telegram (después de escapar). */
  messageMax: 4096,
  /** Tope del comando o texto principal de un permiso (antes de escapar); si pasa, se muestran el inicio y el final. */
  commandMax: 2400,
  /** Espera antes de enviar un permiso, para que la pantalla lo conteste si es automático o inmediato. */
  permissionGraceMs: 1200,
  /** Una sesión ocupada sin movimiento durante este tiempo se avisa como atascada. */
  stuckAfterMs: 5 * 60_000,
  /** Una sesión que terminó antes de este tiempo no se avisa (respuestas cortas). */
  minBusyForDoneMs: 8_000,
  /** Avisos (no permisos) por minuto. */
  noticesPerMinute: 12
} as const
