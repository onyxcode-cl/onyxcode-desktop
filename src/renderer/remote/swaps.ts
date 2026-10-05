/**
 * Importaciones que se sustituyen SOLO en la build de la PWA (clave: archivo importador, relativo a la raíz del repo →
 * especificador EXACTO de la importación → archivo de `src/renderer/remote`). Lo lee `pwa/vite.full.config.ts` y lo vigila
 * `swaps.test.ts`: un especificador mal escrito no falla al compilar (simplemente no sustituye), por eso hay prueba.
 */
export const SWAPS: Record<string, Record<string, string>> = {
  'src/renderer/src/features/tasks/index.ts': {
    './impl/TasksWorkspace': 'lazy/TasksWorkspace.tsx',
    './impl/TasksSidebar': 'lazy/TasksSidebar.tsx',
    './impl/MobileTasksHome': 'lazy/MobileTasksHome.tsx'
  },
  // Tarjetas de permiso SOLO de escritorio (plan ND): el celular bifurca por `isRemoteSurface()` y usa el marcado de siempre.
  'src/renderer/src/features/tasks/impl/PermissionPrompt.tsx': { './PermissionCardDesk': 'shims/no-tasks-permission-desk.tsx' },
  'src/renderer/src/features/code/impl/PermissionCard.tsx': { './PermissionCardDesk': 'shims/no-code-permission-desk.tsx' },
  'src/renderer/src/features/routines/index.ts': { './impl/RoutinesView': 'lazy/RoutinesView.tsx' },
  'src/renderer/src/features/settings/index.ts': { './impl/SettingsView': 'lazy/SettingsView.tsx' },
  'src/shared/i18n/index.ts': { './en': 'shims/en-lazy.ts' },
  // Asistente de primer arranque y piezas que solo monta `DesktopApp` (el celular usa `MobileApp`).
  'src/renderer/src/app/App.tsx': {
    '../features/onboarding': 'shims/no-onboarding.ts',
    './Sidebar': 'shims/no-sidebar.tsx',
    './CommandPalette': 'shims/no-command-palette.tsx',
    './UpdateNotice': 'shims/no-update-notice.tsx',
    './RemotePairHost': 'shims/no-remote-pair-host.tsx',
    './RemoteConfirmHost': 'shims/no-remote-confirm-host.tsx',
    '../keybindings/dispatch': 'shims/no-keybindings.ts'
  },
  // Paneles de Code: se bajan al abrirlos.
  'src/renderer/src/features/code/impl/MobileCode.tsx': {
    './panels/ChangesPanel': 'lazy/ChangesPanel.tsx',
    './panels/FilesPanel': 'lazy/FilesPanel.tsx'
  },
  'src/renderer/src/features/browser/index.ts': { './BrowserPanel': 'lazy/BrowserPanel.tsx' },
  // Detalle del elemento elegido (popover del chip): se baja al abrirlo.
  'src/renderer/src/features/browser/ElementChip.tsx': { './ElementDetailPopover': 'lazy/ElementDetailPopover.tsx' },
  // Markdown (react-markdown y compañía) y resaltado (highlight.js) en trozos aparte.
  'src/renderer/src/features/code/impl/MessageStream.tsx': { '../../../components/Markdown': 'lazy/Markdown.tsx' },
  'src/renderer/src/features/chat/ChatMessageList.tsx': { '../../components/Markdown': 'lazy/Markdown.tsx' },
  'src/renderer/src/components/DiffView.tsx': { 'highlight.js/lib/common': 'shims/hljs-deferred.ts' },
  'src/renderer/src/components/conversation/DeferredMarkdown.tsx': { '../Markdown': 'lazy/Markdown.tsx' },
  'src/renderer/src/components/Markdown.tsx': { './highlight-plugins': 'shims/highlight-lazy.ts' },
  // «Comparar modelos» (columnas, diálogo, tienda…): el celular no la usa (`compareApi()` es null), así que todo su índice se sustituye.
  'src/renderer/src/features/chat/ChatView.tsx': { '../compare': 'shims/no-compare.tsx' },
  'src/renderer/src/features/chat/ChatSidebar.tsx': { '../compare': 'shims/no-compare.tsx' },
  'src/renderer/src/features/code/impl/CodeWorkspace.tsx': {
    './panels/ChangesPanel': 'lazy/ChangesPanel.tsx',
    './panels/FilesPanel': 'lazy/FilesPanel.tsx',
    '../../compare': 'shims/no-compare.tsx'
  },
  'src/renderer/src/features/code/impl/Composer.tsx': { '../../compare': 'shims/no-compare.tsx' },
  'src/renderer/src/features/code/impl/ComposerControls.tsx': { '../../compare': 'shims/no-compare.tsx' }
}
