/**
 * Capa única de etiquetas VISIBLES. Las claves son los ids internos (no cambian);
 * los valores son el texto que ve el usuario, en el idioma activo (getters: se leen al usarse).
 * Módulo puro: solo depende de `@shared/i18n`.
 */
import { t } from './i18n'

export const MODE_LABELS = {
  get chat() {
    return t('labels.mode.chat')
  },
  get code() {
    return t('labels.mode.code')
  },
  get tasks() {
    return t('labels.mode.tasks')
  },
  get routines() {
    return t('labels.mode.routines')
  }
}

export const UI_LABELS = {
  get tasksMode() {
    return MODE_LABELS.tasks
  },
  get task() {
    return t('labels.ui.task')
  },
  get network() {
    return t('labels.ui.network')
  },
  get htmlPreview() {
    return t('labels.ui.htmlPreview')
  },
  get openHtmlPreview() {
    return t('labels.ui.openHtmlPreview')
  },
  get guideMode() {
    return t('labels.ui.guideMode')
  },
  get computer() {
    return t('labels.ui.computer')
  },
  get autoMode() {
    return t('labels.ui.autoMode')
  }
}
