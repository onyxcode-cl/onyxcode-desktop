export const errors = {
  'errors.noAi.title': 'Aún no conectaste ninguna IA',
  'errors.noAi.body':
    'Para enviar mensajes necesitas conectar una IA: tu suscripción de OpenCode Go o la clave de otro proveedor. Solo toma un minuto.',
  'errors.yourAi': 'tu IA',
  'errors.context.title': 'La conversación es demasiado larga',
  'errors.context.message': 'Compáctala o empieza una conversación nueva para seguir.',
  'errors.modelNotFound.title': 'El modelo elegido no está disponible',
  'errors.modelNotFound.fallbackId': 'el modelo',
  'errors.modelNotFound.message': '“{id}” no pertenece a ninguna IA conectada. Elige otro modelo o conecta una IA.',
  'errors.auth.title': 'La IA rechazó la conexión',
  'errors.auth.message': 'La clave o la sesión de {provider} no es válida o caducó. Vuelve a conectarla en Ajustes › Modelos.',
  'errors.quota.title': 'Límite de uso alcanzado',
  'errors.quota.message': 'Tu IA alcanzó su límite de uso o de cuota. Espera unos minutos o revisa tu plan.',
  'errors.network.title': 'Sin conexión',
  'errors.network.message': 'No se pudo contactar con la IA. Revisa tu conexión a internet e inténtalo de nuevo.',
  'errors.system.permission':
    'No se pudo acceder a un archivo o carpeta porque no hay permiso. Revisa que esté dentro de la carpeta elegida o dale acceso a la app y vuelve a intentarlo.',
  'errors.system.missing': 'No se encontró un archivo o carpeta que hacía falta. Revisa que siga en su lugar y vuelve a intentarlo.',
  'errors.system.noSpace': 'No hay espacio libre en el disco. Libera espacio y vuelve a intentarlo.',
  'errors.system.busy':
    'Otro programa está usando el archivo o hay demasiados abiertos a la vez. Ciérralos o espera un momento y vuelve a intentarlo.',
  'errors.system.exists': 'Ya existe un archivo o carpeta con ese nombre. Elige otro nombre o quita el que sobra y vuelve a intentarlo.',
  'errors.system.unreadable': 'La respuesta llegó incompleta o con un formato que no se pudo leer. Vuelve a intentarlo.',
  'errors.unknown.title': 'Algo salió mal',
  'errors.unknown.message':
    'Ocurrió un error inesperado. Vuelve a intentarlo; si sigue pasando, abre «Ver detalle» y compártelo con soporte.'
} as const
