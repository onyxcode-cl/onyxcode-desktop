/**
 * Glosario de Tareas (módulo PURO): términos únicos de la interfaz, para que main y renderer
 * usen siempre las mismas palabras. Cada término se lee en el idioma activo (getters).
 *
 * Prohibido en la interfaz: "Acceso total", "acceso completo" y "Carpetas autorizadas".
 */
import { t } from './i18n'

export const TASKS_TERMS = {
  get sandbox() {
    return t('tasksSettings.glossary.sandbox')
  },
  get fullControl() {
    return t('tasksSettings.glossary.fullControl')
  },
  get fullControlShort() {
    return t('tasksSettings.glossary.fullControlShort')
  },
  get workFolders() {
    return t('tasksSettings.glossary.workFolders')
  },
  get trustedFolders() {
    return t('tasksSettings.glossary.trustedFolders')
  },
  get linkedFolders() {
    return t('tasksSettings.glossary.linkedFolders')
  },
  get readOnly() {
    return t('tasksSettings.glossary.readOnly')
  },
  get readWrite() {
    return t('tasksSettings.glossary.readWrite')
  },
  get deleteGrant() {
    return t('tasksSettings.glossary.deleteGrant')
  },
  get sideChat() {
    return t('tasksSettings.glossary.sideChat')
  },
  get routine() {
    return t('tasksSettings.glossary.routine')
  },
  get browser() {
    return t('tasksSettings.glossary.browser')
  }
}
