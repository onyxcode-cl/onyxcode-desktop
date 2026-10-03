/**
 * «Abrir en…»: abre la carpeta del proyecto con un editor del catálogo fijo (`catalog.ts`).
 * Sin Electron (el lanzamiento y `shell.openPath` llegan inyectados). Nunca ejecuta nada que venga del renderer.
 */
import { appendFileSync } from 'node:fs'
import { t } from '@shared/i18n'
import { EDITOR_IDS, type EditorId, type EditorInfo } from '@shared/ipc-code'
import { detectEditors, editorLabel, launchSpec, type E2eEditors, type EditorEnv, type LaunchSpec } from './catalog'

export interface EditorsDeps {
  env: EditorEnv
  /** Lanza sin shell; true si arrancó. */
  launch: (spec: LaunchSpec) => Promise<boolean>
  /** `shell.openPath`: devuelve '' si fue bien, o el motivo del fallo. */
  openPath: (folder: string) => Promise<string>
  e2e?: E2eEditors | null
}

export class EditorError extends Error {}

export function listInstalled(deps: EditorsDeps): EditorInfo[] {
  if (deps.e2e)
    return [...deps.e2e.detected.map((id) => ({ id, label: editorLabel(id) })), { id: 'system' as const, label: editorLabel('system') }]
  return detectEditors(deps.env)
}

export async function openWithEditor(folder: string, id: EditorId, deps: EditorsDeps): Promise<void> {
  if (!(EDITOR_IDS as readonly string[]).includes(id)) throw new EditorError(t('common.editors.unknown'))
  if (deps.e2e) {
    const installed = listInstalled(deps).some((e) => e.id === id)
    if (!installed) throw new EditorError(t('common.editors.notInstalled'))
    // Detección simulada: las rutas son las del catálogo real, con todo «instalado», y solo se registra la llamada.
    const spec =
      id === 'system' ? null : launchSpec(id, folder, { ...deps.env, exists: () => true, readdir: () => ['WebStorm', 'IntelliJ IDEA'] })
    appendFileSync(deps.e2e.log, JSON.stringify({ id, folder, spec }) + '\n')
    return
  }
  if (id === 'system') {
    const err = await deps.openPath(folder)
    if (err) throw new EditorError(t('common.editors.launchFailed', { reason: err }))
    return
  }
  const spec = launchSpec(id, folder, deps.env)
  if (!spec) throw new EditorError(t('common.editors.notInstalled'))
  if (!(await deps.launch(spec))) throw new EditorError(t('common.editors.launchFailed', { reason: spec.cmd }))
}
