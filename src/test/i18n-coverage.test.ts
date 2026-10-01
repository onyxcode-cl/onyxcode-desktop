import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findHardcodedText } from './i18n-detect'

/**
 * Guardia de cobertura de i18n: los archivos de MIGRATED no pueden llevar texto visible escrito a mano
 * (JSX con texto, atributos de texto con literal, ni literales en español); todo vive en shared/i18n.
 * La lista crece con cada tanda (T4b: Code/Tareas/Rutinas…, T4c: errores de main). Excepción puntual:
 * comentario `i18n-ignore: motivo` en la misma línea o en la anterior.
 */
const ROOT = resolve(__dirname, '../..')

export const MIGRATED: string[] = [
  'src/main/ipc/onboarding.ts',
  'src/main/ipc/account.ts',
  'src/renderer/quick/main.tsx',
  'src/renderer/overlay/pill.ts',
  'src/renderer/overlay/assist.ts',
  'src/renderer/overlay/overlay.ts',
  'src/renderer/overlay/shared.ts',
  'src/main/ipc/tasks-handlers.ts',
  'src/main/scheduler/service.ts',
  'src/main/computer/assist-window.ts',
  'src/main/computer/overlay.ts',
  'src/main/computer/service.ts',
  'src/main/opencode/server.ts',
  'src/main/tasks/sandbox.ts',
  'src/main/tasks/manager.ts',
  'src/main/tasks/projects.ts',
  'src/main/ipc/update.ts',
  'src/main/ipc/diagnostics.ts',
  'src/main/ipc/tasks-lifecycle-handlers.ts',
  'src/main/embedded-browser/approvals.ts',
  'src/main/extras/quick-entry.ts',
  'src/main/extras/mcp-config.ts',
  'src/main/extras/mcp-catalog-install.ts',
  'src/main/scheduler/schedule.ts',
  'src/main/tasks/rules.ts',
  'src/main/tasks/open-policy.ts',
  'src/main/tasks/folder-policy.ts',
  'src/main/opencode/binary.ts',
  'src/main/account/service.ts',
  'src/main/account/loopback.ts',
  'src/main/extras/tray.ts',
  'src/main/security/web-security.ts',
  'src/renderer/src/app/CommandPalette.tsx',
  'src/renderer/src/app/EngineNotice.tsx',
  'src/renderer/src/app/ServerBanner.tsx',
  'src/renderer/src/app/Sidebar.tsx',
  'src/renderer/src/app/UpdateNotice.tsx',
  'src/renderer/src/components/ConfirmDialog.tsx',
  'src/renderer/src/components/DiffView.tsx',
  'src/renderer/src/components/EffortPicker.tsx',
  'src/renderer/src/components/ErrorBoundary.tsx',
  'src/renderer/src/components/Markdown.tsx',
  'src/renderer/src/components/ModelPicker.tsx',
  'src/renderer/src/components/NoAiBanner.tsx',
  'src/renderer/src/components/TranscriptLoader.tsx',
  'src/renderer/src/components/UsageMeter.tsx',
  'src/renderer/src/components/conversation/ErrorNotice.tsx',
  'src/renderer/src/components/conversation/Reasoning.tsx',
  'src/renderer/src/features/account/AccessScreen.tsx',
  'src/renderer/src/features/account/AccountGate.tsx',
  'src/renderer/src/features/account/LegalDialog.tsx',
  'src/renderer/src/features/account/access-view.ts',
  'src/renderer/src/features/chat/ChatComposer.tsx',
  'src/renderer/src/features/chat/ChatMessageList.tsx',
  'src/renderer/src/features/chat/ChatSessionList.tsx',
  'src/renderer/src/features/chat/ChatSidebar.tsx',
  'src/renderer/src/features/chat/ChatView.tsx',
  'src/renderer/src/features/chat/actions.ts',
  'src/renderer/src/features/chat/index.ts',
  'src/renderer/src/features/code/index.tsx',
  'src/renderer/src/features/onboarding/Wizard.tsx',
  'src/renderer/src/features/onboarding/steps.ts',
  'src/renderer/src/features/routines/index.ts',
  'src/renderer/src/features/settings/impl/AboutSection.tsx',
  'src/renderer/src/features/settings/impl/AccountSection.tsx',
  'src/renderer/src/features/settings/impl/AutoModeSection.tsx',
  'src/renderer/src/features/settings/impl/BrowserSection.tsx',
  'src/renderer/src/features/settings/impl/ComputerSection.tsx',
  'src/renderer/src/features/settings/impl/DiagnosticsSection.tsx',
  'src/renderer/src/features/settings/impl/GeneralSection.tsx',
  'src/renderer/src/features/settings/impl/KeyTestNotice.tsx',
  'src/renderer/src/features/settings/impl/McpCatalogDialog.tsx',
  'src/renderer/src/features/settings/impl/McpSection.tsx',
  'src/renderer/src/features/settings/impl/ModelSelect.tsx',
  'src/renderer/src/features/settings/impl/ModelsSection.tsx',
  'src/renderer/src/features/settings/impl/NetworkSection.tsx',
  'src/renderer/src/features/settings/impl/ProviderKeyForm.tsx',
  'src/renderer/src/features/settings/impl/SettingsView.tsx',
  'src/renderer/src/features/settings/impl/ShortcutsSection.tsx',
  'src/renderer/src/features/settings/impl/TasksSection.tsx',
  'src/renderer/src/features/settings/impl/UsageSection.tsx',
  'src/renderer/src/features/settings/impl/extras.ts',
  'src/renderer/src/features/settings/impl/providerCatalog.ts',
  'src/renderer/src/features/settings/impl/ui.tsx',
  'src/renderer/src/features/settings/impl/useKeyTest.ts',
  'src/renderer/src/features/tasks/index.ts',
  'src/renderer/src/lib/engine-notice.ts',
  'src/renderer/src/lib/format.ts',
  'src/renderer/src/lib/opencode.ts',
  'src/renderer/src/lib/update-notice.ts',
  'src/shared/ai-errors.ts',
  'src/shared/diagnostics.ts',
  'src/shared/key-test.ts',
  'src/shared/labels.ts',
  'src/shared/tasks-glossary.ts',
  'src/shared/update-install.ts'
]

describe('cobertura de i18n', () => {
  it('detecta texto escrito a mano (calibración del detector)', () => {
    const jsx =
      "export const A = () => <p title=\"Cerrar ajustes\">Hola mundo {x}<b>OpenCode</b></p>\nconst m = 'No se pudo guardar'\nconst ok = 'tasks' + `v${1}`"
    const hits = findHardcodedText('a.tsx', jsx)
    expect(hits.map((h) => h.split('] ')[0].split('[')[1]).sort()).toEqual(['atributo title', 'literal', 'texto JSX'])
    expect(findHardcodedText('b.ts', "const x = 'ok'\n\nconst y = 'ya no hay'")).toHaveLength(1)
    expect(findHardcodedText('c.ts', "// i18n-ignore: id interno\nconst y = 'ya no hay'")).toHaveLength(0)
    expect(findHardcodedText('d.ts', "console.warn('[x] no se pudo leer:', err)")).toHaveLength(0)
  })

  it('los archivos migrados no tienen texto visible fuera de los diccionarios', () => {
    const failures = MIGRATED.flatMap((f) => findHardcodedText(f, readFileSync(resolve(ROOT, f), 'utf8')))
    expect(failures.join('\n')).toBe('')
  })

  it('todos los archivos de la lista existen', () => {
    for (const f of MIGRATED) expect(() => readFileSync(resolve(ROOT, f), 'utf8'), f).not.toThrow()
  })
})
