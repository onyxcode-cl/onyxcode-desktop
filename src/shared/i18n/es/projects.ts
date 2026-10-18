/** Proyectos del Chat con archivos de conocimiento (F8-B185). */
export const projects = {
  'projects.sidebar.title': 'Proyectos',
  'projects.sidebar.new': 'Nuevo proyecto',
  'projects.sidebar.empty': 'Reúne instrucciones y archivos en un proyecto, y la IA los usará en sus conversaciones.',
  'projects.sidebar.loading': 'Cargando proyectos…',
  'projects.sidebar.error': 'No se pudieron cargar los proyectos.',
  'projects.sidebar.retry': 'Reintentar',
  'projects.sidebar.open': 'Abrir el proyecto {name}',
  'projects.sidebar.meta': {
    one: '{count} archivo',
    other: '{count} archivos'
  },

  'projects.new.title': 'Nuevo proyecto',
  'projects.new.message': 'Ponle un nombre. Después podrás escribir instrucciones y añadir archivos.',
  'projects.new.placeholder': 'Por ejemplo: Contratos 2026',
  'projects.new.confirm': 'Crear',

  'projects.view.region': 'Proyecto {name}',
  'projects.view.back': 'Volver al chat',
  'projects.view.name': 'Nombre del proyecto',
  'projects.view.delete': 'Eliminar proyecto',
  'projects.view.missing': 'Este proyecto ya no existe.',
  'projects.view.loading': 'Cargando el proyecto…',
  'projects.delete.title': '¿Eliminar el proyecto «{name}»?',
  'projects.delete.message':
    'Se borran de este equipo las copias de sus archivos y su índice. Las conversaciones no se borran: quedan sin proyecto. No se puede deshacer.',
  'projects.delete.confirm': 'Eliminar proyecto',
  'projects.privacy.title': 'Qué sale de tu equipo',
  'projects.privacy':
    'Los archivos se copian a este equipo y se leen aquí, sin enviarlos a ningún servicio. Cuando preguntas algo en una conversación del proyecto, al modelo que elegiste solo viajan las instrucciones del proyecto y los fragmentos de los archivos que se parecen a tu pregunta. Nada más.',

  'projects.instr.title': 'Instrucciones del proyecto',
  'projects.instr.help':
    'Cómo quieres que responda la IA en este proyecto. Valen para todas sus conversaciones. Son preferencias: no cambian las reglas de la app ni dan permisos.',
  'projects.instr.placeholder': 'Por ejemplo: Responde en español formal y cita siempre el archivo de donde sacas cada dato.',
  'projects.instr.count': '{count} de {max} caracteres',
  'projects.instr.save': 'Guardar instrucciones',
  'projects.instr.saved': 'Instrucciones guardadas.',

  'projects.files.title': 'Archivos de conocimiento',
  'projects.files.add': 'Añadir archivos',
  'projects.files.hint': 'Suelta aquí archivos PDF, Word, Excel, PowerPoint, de texto o Markdown, o usa el botón.',
  'projects.files.drop': 'Suelta los archivos para añadirlos al proyecto',
  'projects.files.empty.title': 'Aún no hay archivos',
  'projects.files.empty.desc': 'Añade lo que la IA debe saber en este proyecto: contratos, informes, apuntes o planillas.',
  'projects.files.count': '{count} de {max} archivos',
  'projects.files.used': 'Espacio usado: {used} de {total}',
  'projects.files.limits':
    'Hasta {files} archivos de {size} cada uno, y {total} en total. Si un archivo no cabe, no se añade y aquí verás el motivo; los demás siguen. De un archivo muy largo se lee solo el principio (unos {chars} caracteres).',
  'projects.files.list': 'Archivos del proyecto',
  'projects.file.waiting': 'En espera',
  'projects.file.reading': 'Leyendo…',
  'projects.file.ready': {
    one: 'Listo · {count} fragmento',
    other: 'Listo · {count} fragmentos'
  },
  'projects.file.readyPartial': 'Listo · solo se leyó el principio',
  'projects.file.error': 'No se pudo leer',
  'projects.file.remove': 'Quitar {name}',
  'projects.file.removeHelp': 'Quita el archivo del proyecto y borra su copia de este equipo.',

  'projects.fail.unsupported': 'Este tipo de archivo no se puede usar. Prueba con PDF, Word, Excel, PowerPoint, texto o Markdown.',
  'projects.fail.tooBig': 'Pesa más que el límite por archivo.',
  'projects.fail.projectFull': 'El proyecto ya no tiene espacio. Quita algún archivo y vuelve a intentarlo.',
  'projects.fail.tooManyFiles': 'El proyecto ya tiene el máximo de archivos. Quita alguno y vuelve a intentarlo.',
  'projects.fail.reserved': 'Parece un archivo con claves o secretos, y esos no se añaden.',
  'projects.fail.encrypted': 'Tiene contraseña. Guárdalo sin contraseña y vuelve a añadirlo.',
  'projects.fail.legacy': 'Es un formato muy antiguo. Ábrelo y guárdalo como .docx o .pptx.',
  'projects.fail.corrupt': 'El archivo está dañado o no es del tipo que dice ser.',
  'projects.fail.empty': 'No tiene texto que leer.',
  'projects.fail.noText': 'Es solo imagen (sin texto). Prueba con una versión que se pueda seleccionar.',
  'projects.fail.unreadable': 'No se pudo abrir el archivo.',

  'projects.live.reading': 'Leyendo {name} ({index} de {total})…',
  'projects.live.done': {
    one: 'Listo: {count} archivo añadido.',
    other: 'Listo: {count} archivos añadidos.'
  },
  'projects.live.doneSome': 'Listo: {ok} añadidos, {bad} no se pudieron leer.',
  'projects.live.none': 'Ningún archivo se pudo añadir. Mira el motivo de cada uno en la lista.',
  'projects.live.dismiss': 'Cerrar el resumen',

  'projects.convs.title': 'Conversaciones del proyecto',
  'projects.convs.empty': 'Todavía no hay conversaciones en este proyecto.',
  'projects.convs.new': 'Nueva conversación en este proyecto',
  'projects.convs.untitled': 'Conversación nueva',

  'projects.chip.name': 'Proyecto',
  'projects.chip.none': 'Sin proyecto',
  'projects.chip.noneHint': 'Esta conversación no usa instrucciones ni archivos de ningún proyecto.',
  'projects.chip.hint': {
    one: '{count} archivo de conocimiento. Se usa desde tu próximo mensaje.',
    other: '{count} archivos de conocimiento. Se usa desde tu próximo mensaje.'
  },
  'projects.chip.new': 'Nuevo proyecto…',
  'projects.chip.note': 'Puedes cambiarlo cuando quieras. Las respuestas anteriores no cambian.',

  'projects.err.tooMany': 'Llegaste al máximo de {max} proyectos. Elimina alguno para crear otro.',
  'projects.err.notFound': 'Ese proyecto ya no existe.',
  'projects.err.invalid': 'El nombre no es válido.',
  'projects.err.expired': 'La selección de archivos caducó. Vuelve a elegirlos.',
  'projects.err.unknown': 'No se pudo completar la acción. Inténtalo de nuevo.',
  'projects.err.close': 'Cerrar el aviso',

  'projects.dialog.title': 'Elige los archivos del proyecto',
  'projects.dialog.filter': 'Documentos',
  'projects.dialog.all': 'Todos los archivos'
} as const
