/** Instrucciones personalizadas y memoria de Chat y Code. */
export const memory = {
  'settings.nav.instructions': 'Instrucciones',
  'settings.nav.memory': 'Memoria',

  // Instrucciones personalizadas
  'instr.title': 'Instrucciones personalizadas',
  'instr.intro':
    'Cuéntale a la IA cómo quieres que te responda y qué debe saber de ti. Se envían con cada mensaje de Chat y de Code, con el modelo que tengas conectado.',
  'instr.global.label': 'Para Chat y Code',
  'instr.global.placeholder': 'Por ejemplo: respóndeme siempre en español y de forma breve. Soy diseñadora y no sé programar.',
  'instr.global.help':
    'Se guardan en este computador y viajan al modelo conectado junto con tus mensajes, igual que lo que escribes en el chat. No pongas claves ni datos que no quieras compartir con él. No cambian las reglas de seguridad ni los permisos.',
  'instr.global.count': '{count} de {max} caracteres',
  'instr.saved': 'Guardado',
  'instr.project.title': 'Instrucciones de un proyecto de Code',
  'instr.project.intro':
    'Es el archivo AGENTS.md de la carpeta del proyecto: Code lo lee solo al trabajar ahí. Lo que escribas se guarda en esa carpeta y viajará con ella si la compartes o la subes a un repositorio.',
  'instr.project.folder': 'Proyecto',
  'instr.project.none': 'Abre un proyecto en Code para ver y editar sus instrucciones.',
  'instr.project.path': 'Se guarda en {path}',
  'instr.project.willCreate': 'Esta carpeta todavía no tiene el archivo; se creará al guardar.',
  'instr.project.edit': 'Editar',
  'instr.project.preview': 'Vista previa',
  'instr.project.previewEmpty': 'Todavía no hay nada que mostrar.',
  'instr.project.placeholder': 'Por ejemplo: usa pnpm, escribe pruebas con Vitest y no toques la carpeta dist.',
  'instr.project.save': 'Guardar en la carpeta',
  'instr.project.saving': 'Guardando…',
  'instr.project.saved': 'Guardado en la carpeta del proyecto',
  'instr.project.failed': 'No se pudo guardar: {error}',
  'instr.project.loadFailed': 'No se pudo leer el archivo: {error}',
  'instr.open': 'Instrucciones y memoria',

  // Memoria
  'memory.title': 'Memoria',
  'memory.intro':
    'Lo que la IA recuerda de ti y de tus proyectos entre conversaciones. La IA solo puede proponer una nota; no se guarda nada hasta que tú la apruebas, y puedes editarla o borrarla cuando quieras.',
  'memory.toggle': 'Usar la memoria',
  'memory.toggleDesc': 'Apagada, la IA no recibe tus notas ni propone nuevas en Chat, Code y Overdrive. No borra lo que ya está guardado.',
  'memory.privacy':
    'Las notas se guardan solo en este computador y pasan por un filtro que descarta claves y contraseñas. Salen únicamente hacia el modelo que tengas conectado, junto con tu mensaje, igual que el resto de la conversación. Las notas «para todo» se comparten entre Chat, Code y Overdrive.',
  'memory.scope.usuario': 'Para todo',
  'memory.scope.proyecto': 'De un proyecto',
  'memory.project.label': 'Proyecto',
  'memory.project.none': 'Abre un proyecto en Code para ver su memoria.',
  'memory.search': 'Buscar en la memoria',
  'memory.empty.usuario': 'Todavía no hay notas guardadas. Cuando la IA proponga una y la apruebes, aparecerá aquí.',
  'memory.empty.proyecto': 'Este proyecto todavía no tiene notas guardadas.',
  'memory.noMatch': 'Ninguna nota coincide con la búsqueda.',
  'memory.count': '{count} de {max} notas',
  'memory.edit': 'Editar',
  'memory.editAria': 'Editar esta nota',
  'memory.save': 'Guardar',
  'memory.cancel': 'Cancelar',
  'memory.delete': 'Borrar esta nota',
  'memory.err.secreto': 'Ese texto parece contener una clave o contraseña, así que no se guarda.',
  'memory.err.duplicado': 'Ya existe una nota igual.',
  'memory.err.generic': 'No se pudo guardar el cambio.',
  'memory.forgetAll': 'Olvidar todo',
  'memory.forgetAllTitle': '¿Olvidar toda la memoria?',
  'memory.forgetAllMsg':
    'Se borran todas las notas «para todo» y las de todos los proyectos, en Chat, Code y Overdrive. No se puede deshacer.',
  'memory.forgetAllConfirm': 'Olvidar todo',
  'memory.open': 'Gestionar memoria',

  // Tarjeta de propuesta
  'memory.card.title': 'La IA propone recordar esto',
  'memory.card.hint': 'Elige qué guardar, edita el texto si quieres o descarta. Nada se guarda sin tu aprobación.'
} as const
