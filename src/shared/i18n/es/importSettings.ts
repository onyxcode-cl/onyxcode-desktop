/** Ajustes › Importar y búsqueda en Ajustes. */
export const importSettings = {
  'settings.nav.import': 'Importar',

  // Búsqueda en Ajustes
  'settings.search.label': 'Buscar en Ajustes',
  'settings.search.clear': 'Borrar la búsqueda',
  'settings.search.results': {
    one: '{count} sección con resultados',
    other: '{count} secciones con resultados'
  },
  'settings.search.sectionMatch': 'Sección',
  'settings.search.empty': 'Nada coincide con «{query}»',
  'settings.search.emptyHelp': 'Prueba con otra palabra (por ejemplo «tema», «modelo» o «atajos») o elige una sección del menú.',
  'settings.search.listLabel': 'Resultados de la búsqueda en Ajustes',

  // Importar
  'import.title': 'Importar desde otras herramientas',
  'import.intro':
    'Trae a Lazunox lo que ya tienes en otras herramientas: las instrucciones de un proyecto y sus conectores (MCP). Tú eliges la carpeta o el archivo; no se busca nada por tu cuenta.',
  'import.guarantee.title': 'Qué garantiza',
  'import.guarantee.chosen': 'Solo se lee la carpeta o el archivo que eliges en la ventana del sistema.',
  'import.guarantee.secrets': 'Las claves y variables de entorno no se copian: el conector queda apuntando al nombre de la variable.',
  'import.guarantee.disabled': 'Los conectores entran desactivados hasta que los actives tú.',
  'import.guarantee.nothingRuns': 'No se ejecuta nada durante la importación, y cada elemento se marca a mano.',
  'import.source.folder.title': 'Carpeta de un proyecto',
  'import.source.folder.desc': 'Busca CLAUDE.md y los archivos .mcp.json de esa carpeta. Las instrucciones pasan a ser su AGENTS.md.',
  'import.source.folder.button': 'Elegir carpeta…',
  'import.source.file.title': 'Archivo de conectores',
  'import.source.file.desc': 'Un archivo .json con servidores MCP de otra herramienta. Solo se lee el archivo que elijas.',
  'import.source.file.button': 'Elegir archivo…',
  'import.dialog.folder': 'Elige la carpeta de un proyecto',
  'import.dialog.file': 'Elige un archivo de configuración de conectores',
  'import.picking': 'Leyendo…',
  'import.error': 'No se pudo leer lo que elegiste: {error}',

  'import.preview.title': 'Vista previa de «{label}»',
  'import.preview.help': 'No se ha cambiado nada todavía. Marca lo que quieras traer.',
  'import.preview.empty': 'No hay nada que importar en «{label}».',
  'import.group.instructions': 'Instrucciones del proyecto',
  'import.group.mcp': 'Conectores (MCP)',
  'import.group.discarded': 'Descartado',
  'import.item.from': 'de {origin}',
  'import.item.pick': 'Importar {name}',
  'import.item.envRefs': 'Referencia estas variables (sus valores no se copian): {names}',
  'import.item.disabledNote': 'Entrará desactivado.',
  'import.apply': {
    one: 'Importar {count} elemento',
    other: 'Importar {count} elementos'
  },
  'import.apply.none': 'Marca al menos un elemento',
  'import.applying': 'Importando…',
  'import.result.title': 'Resultado',
  'import.result.ok': 'Importado',
  'import.result.mcpOk': 'Importado y desactivado. Defínele sus variables y actívalo en Conectores (MCP).',
  'import.result.instrOk': 'Importado en AGENTS.md. Puedes revisarlo en Instrucciones.',
  'import.result.fail': 'No se pudo: {error}',
  'import.goMcp': 'Abrir Conectores (MCP)',
  'import.goInstructions': 'Abrir Instrucciones',
  'import.again': 'Elegir otra cosa',

  'import.reason.secret-in-args':
    'Un argumento del comando parece una clave (posición {detail}). Quítala del origen y vuelve a intentarlo.',
  'import.reason.secret-in-url': 'La dirección lleva una clave o un token. Se descarta para no copiarlo.',
  'import.reason.secret-in-text':
    'Parece contener una clave o un token en las líneas {detail}. Quítalo del archivo de origen y vuelve a intentarlo.',
  'import.reason.url-credentials': 'La dirección incluye usuario y contraseña. Se descarta para no copiarlos.',
  'import.reason.dangerous-command': 'El comando «{detail}» puede modificar el equipo o la red; no se importa.',
  'import.reason.shell-wrapper': 'Lanza una terminal con un texto de comandos («{detail}»); no se importa.',
  'import.reason.shell-metachar': 'Los argumentos encadenan comandos (| ; && $( ) o comillas inversas); no se importa.',
  'import.reason.invalid-entry': 'No tiene el formato de un conector válido.',
  'import.reason.invalid-name': 'El nombre no se puede usar como nombre de conector.',
  'import.reason.name-exists': 'Ya tienes un conector con ese nombre.',
  'import.reason.too-big': 'El archivo es demasiado grande.',
  'import.reason.empty': 'Está vacío.',
  'import.reason.unsupported-type': 'Tipo de conector no compatible ({detail}).',
  'import.reason.refs-agents': 'Solo apunta a AGENTS.md, que Lazunox ya lee.',
  'import.reason.same-content': 'Tiene el mismo contenido que AGENTS.md.',
  'import.reason.already-native': 'AGENTS.md ya lo lee Lazunox; no hay que importarlo.',
  'import.reason.cwd-dropped': 'La carpeta de trabajo del origen no se copia.',
  'import.reason.values-referenced': 'Sus valores secretos no se copian; se referencian por nombre: {detail}.',
  'import.reason.insecure-http': 'Usa http sin cifrar hacia otro equipo.',
  'import.reason.unknown-command': 'Comando poco común («{detail}»): revísalo antes de activarlo.',
  'import.reason.renamed': 'Se renombra a «{detail}» (el nombre original tenía caracteres no permitidos).',
  'import.reason.append': 'Ya existe un AGENTS.md: esto se añadirá al final.',

  // Errores de main
  'merr.import.notFile': 'Lo elegido no es un archivo normal.',
  'merr.import.tooBig': 'El archivo supera el tamaño máximo para importar (256 KB).',
  'merr.import.outside': 'El archivo apunta fuera de la carpeta elegida; no se sigue.',
  'merr.import.badJson': 'El archivo no es un JSON válido.',
  'merr.import.unsupported': 'No reconozco conectores en ese archivo (se esperaba mcpServers, servers o mcp).',
  'merr.import.unreadable': 'No se pudo leer el archivo.',
  'merr.import.expired': 'La vista previa caducó. Elige de nuevo la carpeta o el archivo.',
  'merr.import.notImportable': 'Ese elemento no se puede importar.',
  'merr.import.changed': 'El archivo cambió desde la vista previa. Elige de nuevo para revisarlo.',
  'merr.import.agentsAppeared': 'Mientras tanto apareció un AGENTS.md en la carpeta; elige de nuevo para añadirlo al final.'
} as const
