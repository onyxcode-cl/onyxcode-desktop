/**
 * Capa única de etiquetas VISIBLES. Las claves son los ids internos (no cambian);
 * los valores son el texto que ve el usuario. Módulo puro: sin imports.
 */
export const MODE_LABELS = { chat: 'Chat', code: 'Code', tasks: 'Tareas', routines: 'Rutinas' } as const

export const UI_LABELS = {
  tasksMode: MODE_LABELS.tasks,
  task: 'tarea',
  network: 'Red del sandbox',
  htmlPreview: 'Vista previa',
  openHtmlPreview: 'Abrir vista previa',
  guideMode: 'Modo guía',
  computer: 'Control del Mac',
  autoMode: 'Modo auto'
} as const
