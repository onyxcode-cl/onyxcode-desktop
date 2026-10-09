/**
 * Visor de documentos de Tareas (PDF/Word/Excel/PowerPoint, Fase 0 del plan del visor). Son
 * textos del LADO DEL HOST (pestaña, pie de página); los textos DENTRO de la vista aislada
 * (`src/viewer/`) tienen su propio diccionario mínimo, separado, porque ese proceso no puede
 * importar el sistema de i18n completo.
 */
export const viewer = {
  'viewer.tab': 'Documento'
} as const
