/**
 * Capa única de etiquetas VISIBLES. Las claves son los ids internos (no cambian);
 * los valores son el texto que ve el usuario. Módulo puro: sin imports.
 */
export const MODE_LABELS = { chat: 'Chat', code: 'Code', cowork: 'Tareas', routines: 'Rutinas' } as const

export const UI_LABELS = {
  tasksMode: MODE_LABELS.cowork,
  task: 'tarea',
  network: 'Red del sandbox',
  htmlPreview: 'Vista previa',
  openHtmlPreview: 'Abrir vista previa',
  guideMode: 'Modo guía',
  computer: 'Control del Mac',
  autoMode: 'Modo auto'
} as const
