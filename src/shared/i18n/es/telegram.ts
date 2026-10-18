/** Telegram (F8-B187): ajustes y mensajes que el bot envía. Entrega 1: avisos y permisos con botones. */
export const telegram = {
  // ---- Ajustes ----
  'telegram.nav': 'Telegram',
  'telegram.title': 'Telegram',
  'telegram.intro':
    'Recibe avisos en el celular y responde los permisos con un botón, usando un bot de Telegram que creas tú. Es gratis y no necesita ningún servidor.',
  'telegram.scope': 'Por ahora el bot solo envía avisos y permisos. No puede darle órdenes a la IA ni leer tus conversaciones.',
  'telegram.privacy.title': 'Antes de activarlo',
  'telegram.privacy.body':
    'Telegram no cifra de extremo a extremo los mensajes de los bots y puede ver su contenido. El computador debe estar encendido con Lazunox abierto. Antes de enviar, Lazunox tapa claves y contraseñas, pero revisa lo que autorizas.',
  'telegram.loading': 'Cargando…',
  'telegram.loadError': 'No se pudo leer el estado de Telegram.',
  'telegram.retry': 'Reintentar',

  'telegram.switch.label': 'Telegram activado',
  'telegram.switch.desc': 'Apagarlo detiene el bot y desvincula tu chat.',
  'telegram.status.label': 'Estado',
  'telegram.status.off': 'Apagado',
  'telegram.status.noBot': 'Falta crear el bot',
  'telegram.status.idle': 'Listo para vincular',
  'telegram.status.linking': 'Esperando el código',
  'telegram.status.linked': 'Vinculado a {name}',
  'telegram.status.linkedYou': 'tú',
  'telegram.status.error': 'Problema: {reason}',

  'telegram.error.invalidToken': 'esa clave no es válida. Cópiala de nuevo desde @BotFather.',
  'telegram.error.botRevoked': 'Telegram rechazó la clave del bot. Pega una nueva.',
  'telegram.error.network': 'no se pudo hablar con Telegram. Revisa tu conexión.',
  'telegram.error.conflict': 'otra aplicación está usando este bot. Ciérrala o crea un bot nuevo.',
  'telegram.error.noSecureStorage': 'este computador no permite guardar claves de forma segura, así que Telegram no se puede usar.',
  'telegram.error.rateLimited': 'Telegram pidió esperar un momento. Reintenta en unos segundos.',
  'telegram.error.sendFailed': 'no se pudo enviar el mensaje.',
  'telegram.error.unknown': 'algo salió mal. Reintenta.',

  'telegram.steps.title': 'Cómo conectarlo',
  'telegram.step1.title': '1. Crea tu bot',
  'telegram.step1.body':
    'En Telegram abre @BotFather, escribe /newbot y sigue los pasos. Al final te entrega una clave larga: es la clave del bot.',
  'telegram.step1.open': 'Abrir @BotFather',
  'telegram.step2.title': '2. Pega la clave del bot',
  'telegram.step2.body': 'Se guarda cifrada en este computador y no se vuelve a mostrar.',
  'telegram.step2.placeholder': 'Clave del bot',
  'telegram.step2.save': 'Guardar clave',
  'telegram.step2.saving': 'Comprobando…',
  'telegram.step2.saved': 'Clave guardada (termina en {tail})',
  'telegram.step2.bot': 'Bot: @{name}',
  'telegram.step3.title': '3. Escríbele a tu bot',
  'telegram.step3.body': 'Abre tu bot en Telegram y escribe /start.',
  'telegram.step3.open': 'Abrir mi bot',
  'telegram.step4.title': '4. Escribe el código',
  'telegram.step4.body': 'El bot te lo pedirá. Escribe en su chat este código de 6 dígitos:',
  'telegram.step4.expires': 'Caduca en {time}',
  'telegram.step4.expired': 'El código caducó.',
  'telegram.step4.new': 'Código nuevo',
  'telegram.step4.attempts': {
    one: 'Queda {count} intento.',
    other: 'Quedan {count} intentos.'
  },
  'telegram.step4.locked': 'Demasiados intentos fallidos. Espera {time} para pedir un código nuevo.',
  'telegram.step4.turnOn': 'Activa «Telegram activado» para recibir el código.',

  'telegram.actions.unlink': 'Desvincular',
  'telegram.actions.removeBot': 'Quitar el bot',
  'telegram.actions.removeConfirm': 'Esto borra la clave del bot y desvincula tu chat. ¿Quitar el bot?',
  'telegram.actions.removeYes': 'Sí, quitar',
  'telegram.actions.cancel': 'Cancelar',
  'telegram.actions.stopAll': 'Detener todo ahora',
  'telegram.actions.stopAllDesc': 'Corta Telegram al instante: apaga el interruptor y desvincula el chat. La clave del bot se conserva.',
  'telegram.actions.working': 'Un momento…',

  'telegram.test.label': 'Mensaje de prueba',
  'telegram.test.desc': 'Envía un mensaje corto a tu chat para comprobar que todo funciona.',
  'telegram.test.send': 'Enviar mensaje de prueba',
  'telegram.test.ok': 'Enviado. Revisa tu Telegram.',
  'telegram.test.notLinked': 'Primero vincula tu chat.',
  'telegram.test.tooSoon': 'Espera unos segundos antes de enviar otro.',
  'telegram.audit.note':
    'Lazunox guarda en este computador un registro (sin claves) de cada vinculación y de cada permiso respondido por Telegram.',
  'telegram.pending': {
    one: '{count} permiso esperando respuesta en Telegram.',
    other: '{count} permisos esperando respuesta en Telegram.'
  },

  // ---- Mensajes del bot (HTML de Telegram; el texto dinámico se escapa antes) ----
  'telegram.msg.needCode':
    'Hola. Para vincular este chat con Lazunox, escribe aquí el código de 6 dígitos que muestra Lazunox en Ajustes › Telegram.',
  'telegram.msg.noCode': 'Lazunox no está esperando una vinculación ahora. Abre Ajustes › Telegram en Lazunox y pide un código nuevo.',
  'telegram.msg.linked':
    'Listo: este chat quedó vinculado con Lazunox. Te avisaré cuando una conversación termine o necesite tu permiso.\n\nComandos: /estado y /desvincular.',
  'telegram.msg.wrong': {
    one: 'Ese código no es correcto. Queda {count} intento.',
    other: 'Ese código no es correcto. Quedan {count} intentos.'
  },
  'telegram.msg.expired': 'El código caducó. Pide uno nuevo en Lazunox.',
  'telegram.msg.locked': 'Demasiados intentos. Espera unos minutos y pide un código nuevo en Lazunox.',
  'telegram.msg.ownerStart': 'Este chat ya está vinculado con Lazunox.\n\nComandos: /estado y /desvincular.',
  'telegram.msg.ownerText':
    'Por ahora solo envío avisos y permisos: no puedo recibir instrucciones por aquí.\n\nComandos: /estado y /desvincular.',
  'telegram.msg.status': 'Lazunox está encendido.\nPermisos esperando tu respuesta: {pending}.\nConversaciones trabajando: {busy}.',
  'telegram.msg.unlinked': 'Chat desvinculado. Ya no recibirás avisos de Lazunox.',
  'telegram.msg.test': 'Mensaje de prueba de Lazunox: todo funciona.',
  'telegram.msg.session': 'Conversación: {title}',
  'telegram.msg.untitled': 'sin título',
  'telegram.msg.perm.title': 'Lazunox pide permiso',
  'telegram.msg.perm.what': 'Quiere: {label}',
  'telegram.msg.perm.file': 'Archivo: {file}',
  'telegram.msg.perm.also': 'Incluye: {items}',
  'telegram.msg.perm.footer':
    'Los botones valen {minutes} minutos. También puedes responder en el computador; el primero que responda decide.',
  'telegram.msg.perm.omitted': '[… {count} caracteres omitidos …]',
  'telegram.msg.perm.allowed': 'Permitido una vez desde Telegram.',
  'telegram.msg.perm.rejected': 'Rechazado desde Telegram.',
  'telegram.msg.perm.allowedScreen': 'Respondido en el computador: permitido.',
  'telegram.msg.perm.alwaysScreen': 'Respondido en el computador: permitido siempre.',
  'telegram.msg.perm.rejectedScreen': 'Respondido en el computador: rechazado.',
  'telegram.msg.perm.expired': 'Los botones caducaron. Si sigue pendiente, respóndelo en el computador.',
  'telegram.msg.perm.gone': 'Este permiso ya no está pendiente.',
  'telegram.msg.perm.toastDone': 'Listo',
  'telegram.msg.perm.toastRejected': 'Rechazado',
  'telegram.msg.perm.toastAnswered': 'Ya respondido en el computador',
  'telegram.msg.perm.toastExpired': 'Estos botones caducaron',
  'telegram.msg.perm.toastUsed': 'Ya usaste este botón',
  'telegram.msg.perm.toastFailed': 'No se pudo responder. Hazlo en el computador.',
  'telegram.msg.done': 'Terminó: {title}',
  'telegram.msg.question': 'La IA tiene una pregunta para ti en: {title}\n\n{question}\n\nResponde en el computador.',
  'telegram.msg.error': 'Hubo un error en: {title}\n\n{detail}',
  'telegram.msg.stuck': 'Parece atascada: {title}. Lleva varios minutos sin avances.'
} as const
