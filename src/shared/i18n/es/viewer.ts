/**
 * Visor de documentos de Overdrive (PDF/Word/Excel/PowerPoint, Fase 0 del plan del visor). Son
 * textos del LADO DEL HOST (pestaña, pie de página); los textos DENTRO de la vista aislada
 * (`src/viewer/`) tienen su propio diccionario mínimo, separado, porque ese proceso no puede
 * importar el sistema de i18n completo.
 */
export const viewer = {
  'viewer.pptx.present': 'Presentar',
  'viewer.pptx.preview': 'Ver',
  'viewer.pptx.busy': 'Preparando…',
  'viewer.pptx.failed': 'No se pudo abrir la presentación.',
  'viewer.pptx.note':
    'Se presenta una copia visual estática: revisa las láminas antes de proyectar; no se reproducen animaciones, vídeo ni audio.',
  'viewer.pptx.invalid':
    'El archivo no es un PowerPoint .pptx válido o no contiene láminas. El formato .ppt antiguo no se puede presentar aquí.',
  'viewer.pptx.limit': 'Esta presentación supera {n} láminas. Divídela en partes para presentarla.',
  'viewer.pptx.incomplete':
    'No se pudieron representar todas las láminas: se esperaban {expected} y se obtuvieron {actual}. No se abrió una presentación incompleta.',
  'viewer.pptx.slideFailed': 'No se pudo representar la lámina {n}.',
  'viewer.pptx.weight': 'La presentación supera el límite de memoria para proyectarla. Divídela en partes.',
  'viewer.pptx.noEngine': 'Instala el diseñador de documentos desde Ajustes para presentar este PowerPoint.',
  'viewer.pptx.renderFailed':
    'No se pudo representar el PowerPoint completo. Revisa el archivo o guárdalo como PDF desde su programa original.',
  'viewer.tab': 'Documento',
  'viewer.loading': 'Abriendo la vista previa…',
  'viewer.ready': 'Vista previa lista. Si no ves el documento, ábrelo con el programa del sistema.',
  'viewer.fallback': 'Visor de respaldo cargado. Si no ves el documento, ábrelo con el programa del sistema.',
  'viewer.timeout': 'La vista previa no respondió en 8 segundos. Puedes abrir el archivo con el programa del sistema.',
  'viewer.openSystem': 'Abrir con el programa del sistema',
  'viewer.systemFailed':
    'No se pudo abrir el archivo con el programa del sistema. Comprueba que tienes un programa para este tipo de archivo.'
} as const
