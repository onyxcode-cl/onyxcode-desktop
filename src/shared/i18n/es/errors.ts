export const errors = {
  'errors.noAi.title': 'Aún no conectaste ninguna IA',
  'errors.noAi.body':
    'Para enviar mensajes necesitas conectar una IA: tu suscripción de OpenCode Go o la clave de otro proveedor. Solo toma un minuto.',
  'errors.yourAi': 'tu IA',
  'errors.context.title': 'La conversación es demasiado larga',
  'errors.context.message': 'Empieza una conversación nueva para seguir.',
  'errors.modelNotFound.title': 'El modelo elegido no está disponible',
  'errors.modelNotFound.fallbackId': 'el modelo',
  'errors.modelNotFound.message': '“{id}” no pertenece a ninguna IA conectada. Elige otro modelo o conecta una IA.',
  'errors.auth.title': 'La IA rechazó la conexión',
  'errors.auth.message': 'La clave o la sesión de {provider} no es válida o caducó. Vuelve a conectarla en Ajustes › Modelos.',
  'errors.quota.title': 'Límite de uso alcanzado',
  'errors.quota.message': 'Tu IA alcanzó su límite de uso o de cuota. Espera unos minutos o revisa tu plan.',
  'errors.network.title': 'Sin conexión',
  'errors.network.message': 'No se pudo contactar con la IA. Revisa tu conexión a internet e inténtalo de nuevo.',
  'errors.unknown.title': 'Algo salió mal',
  'errors.unknown.message': 'OpenCode devolvió un error inesperado.'
} as const
