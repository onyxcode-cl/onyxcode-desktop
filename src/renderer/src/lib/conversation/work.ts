/**
 * Lógica pura del trabajo plegado de una respuesta: vive en `@shared/conversation-work` para que la use también el puente con Telegram
 * (`main`). Este módulo solo la reexporta, así el renderer y sus pruebas siguen importando de aquí.
 */
export * from '@shared/conversation-work'
