/**
 * Visor de documentos de Overdrive (PDF/Word/Excel/PowerPoint, Fase 0 del plan del visor). Son
 * textos del LADO DEL HOST (pestaña, pie de página); los textos DENTRO de la vista aislada
 * (`src/viewer/`) tienen su propio diccionario mínimo, separado, porque ese proceso no puede
 * importar el sistema de i18n completo.
 */
export const viewer = {
  'viewer.tab': 'Documento',
  'viewer.loading': 'Abriendo la vista previa…',
  'viewer.ready': 'Vista previa lista. Si no ves el documento, ábrelo con el programa del sistema.',
  'viewer.fallback': 'Visor de respaldo cargado. Si no ves el documento, ábrelo con el programa del sistema.',
  'viewer.timeout': 'La vista previa no respondió en 8 segundos. Puedes abrir el archivo con el programa del sistema.',
  'viewer.openSystem': 'Abrir con el programa del sistema',
  'viewer.systemFailed':
    'No se pudo abrir el archivo con el programa del sistema. Comprueba que tienes un programa para este tipo de archivo.'
} as const
