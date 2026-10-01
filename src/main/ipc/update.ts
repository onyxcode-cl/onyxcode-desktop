import { app, type IpcMain } from 'electron'
import { t } from '@shared/i18n'
import { dirname, join } from 'node:path'
import { RELEASES_REPO, APP_ID, UPDATE_KEY_ID, UPDATE_PUBLIC_KEY } from '@shared/brand'
import { IDLE_INSTALL, validateInstallLocation } from '@shared/update-install'
import { resolveInstallConfig, resolveUpdateConfig } from '../update/config'
import { UpdateChecker } from '../update/checker'
import { canWrite, nodeInstallerFs, nodeRun, UpdateInstaller } from '../update/installer'
import { clearSwapResult, readSwapResult, updateDir } from '../update/markers'
import { currentAppRealPath, startSwap } from '../update/swap'
import { bootMarkers } from '../update/boot'
import { IS_TEST_BUILD } from '../update/test-build'
import { settingsStore } from '../store'
import { broadcast, handle } from './handle'

function testEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) if (v !== undefined && /^ONYXCODE_(SWAP_|TEST_)/.test(k)) out[k] = v
  return out
}

/**
 * Aviso de versión nueva + actualizador propio: servicios en main y canales
 * `app:updateState|checkUpdates|dismissUpdate|updateDownload|updateCancel|updateInstall|bootConfirm`
 * y eventos `app:updateState|updateProgress`. El renderer solo pide acciones: nunca pasa URLs ni rutas.
 */
export function registerUpdateHandlers(ipcMain: IpcMain): UpdateChecker {
  const userData = app.getPath('userData')
  // Las variables de prueba solo se honran sin empaquetar o en un build de prueba (`ONYXCODE_TEST_BUILD=1`, compilación
  // aparte, docs/DISTRIBUCION.md §11); un build normal las ignora siempre.
  const useRealConfig = app.isPackaged && !IS_TEST_BUILD
  const updateConfig = resolveUpdateConfig({ isPackaged: useRealConfig, env: process.env, repo: RELEASES_REPO })
  const installConfig = resolveInstallConfig({
    isPackaged: useRealConfig,
    env: process.env,
    repo: RELEASES_REPO,
    update: updateConfig,
    updateKey: UPDATE_PUBLIC_KEY,
    updateKeyId: UPDATE_KEY_ID,
    platform: process.platform
  })

  let locationOk = false
  let lastPhase = IDLE_INSTALL.phase

  const installer = new UpdateInstaller({
    fetch: (url, init) => fetch(url, init),
    run: nodeRun,
    fs: nodeInstallerFs(),
    userData,
    appId: APP_ID,
    currentVersion: app.getVersion(),
    repo: updateConfig.repo,
    downloadBase: installConfig.downloadBase,
    allowLoopbackHttp: installConfig.allowLoopbackHttp,
    keys: installConfig.keys,
    userAgent: `OnyxCode/${app.getVersion()}`,
    onState: (s) => {
      broadcast('app:updateProgress', s)
      if (s.phase !== lastPhase) {
        lastPhase = s.phase
        checker.refresh()
      }
    }
  })

  const checker = new UpdateChecker({
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms)
      t.unref?.()
      return t
    },
    currentVersion: app.getVersion(),
    config: updateConfig,
    isEnabled: () => settingsStore.get().checkUpdates,
    stateFile: join(userData, 'update-check.json'),
    onState: (s) => broadcast('app:updateState', s),
    installer: { installable: () => installConfig.enabled && locationOk, install: () => installer.getState() }
  })

  /** Carpeta de instalación válida: en /Applications o ~/Applications, sin translocar, fuera de /Volumes y con permiso de escritura. */
  async function evaluateLocation(): Promise<boolean> {
    if (!installConfig.enabled) return false
    let appPath: string | null
    let inApplications: boolean
    if (app.isPackaged) {
      appPath = currentAppRealPath(app.getPath('exe'))
      inApplications = IS_TEST_BUILD || (typeof app.isInApplicationsFolder === 'function' && app.isInApplicationsFolder())
    } else if (installConfig.testInstallDir) {
      appPath = join(installConfig.testInstallDir, 'OnyxCode.app')
      inApplications = true
    } else return false
    if (!appPath) return false
    const parentWritable = await canWrite(dirname(appPath))
    const appWritable = app.isPackaged ? await canWrite(appPath) : parentWritable
    return validateInstallLocation({ appPath, inApplicationsFolder: inApplications, parentWritable, appWritable }).ok
  }
  const refreshLocation = async (): Promise<void> => {
    const ok = await evaluateLocation().catch(() => false)
    if (ok !== locationOk) {
      locationOk = ok
      checker.refresh()
    }
  }

  // Resultado de un reemplazo anterior (lo deja swap.sh): si falló o volvió atrás, se muestra como error.
  const dir = updateDir(userData)
  const last = readSwapResult(dir)
  if (last) {
    if (!last.ok) installer.preset(last.rolledBack ? 'rolled-back' : 'install', last.version)
    clearSwapResult(dir)
  }

  handle(ipcMain, 'app:updateState', () => checker.getState())
  handle(ipcMain, 'app:checkUpdates', () => checker.check(true))
  handle(ipcMain, 'app:dismissUpdate', ({ version }) => checker.dismiss(version))
  handle(ipcMain, 'app:bootConfirm', () => bootMarkers()?.confirmed())

  handle(ipcMain, 'app:updateDownload', async () => {
    await refreshLocation()
    const tag = checker.latestTag()
    const latest = checker.getState().latest
    if (!installConfig.enabled || !locationOk) throw new Error(t('merr.update.notSelf'))
    if (!tag || !latest) throw new Error(t('merr.update.noneKnown'))
    void installer.download({ version: latest.version, tag })
    return checker.getState()
  })
  handle(ipcMain, 'app:updateCancel', () => {
    const phase = installer.getState().phase
    if (phase === 'downloading' || phase === 'verifying') installer.cancel()
    else installer.reset()
    return checker.getState()
  })
  handle(ipcMain, 'app:updateInstall', async () => {
    if (installer.getState().phase !== 'ready') return checker.getState()
    const currentApp = app.isPackaged ? currentAppRealPath(app.getPath('exe')) : null
    // Sin empaquetar (desarrollo y E2E) nunca se sustituye nada: solo una app empaquetada puede reemplazarse.
    if (!currentApp) {
      installer.fail('location')
      return checker.getState()
    }
    try {
      const ready = await installer.beginInstall()
      startSwap(
        {
          scriptSource: join(process.resourcesPath, 'updater', 'swap.sh'),
          ctx: { userData, currentApp, currentVersion: app.getVersion(), pid: process.pid },
          // Solo un build de prueba pasa variables al script (modo de prueba de swap.sh; docs/DISTRIBUCION.md §11).
          extraEnv: IS_TEST_BUILD ? testEnv(process.env) : undefined,
          quit: () => app.quit()
        },
        ready.stagedApp,
        ready.version
      )
      installer.markRestarting()
    } catch (err) {
      console.warn('[update] no se pudo iniciar el reemplazo:', err instanceof Error ? err.message : err)
      installer.fail('install')
    }
    return checker.getState()
  })

  let wasEnabled = settingsStore.get().checkUpdates
  settingsStore.onChange((s) => {
    if (s.checkUpdates === wasEnabled) return
    wasEnabled = s.checkUpdates
    checker.refresh()
    if (s.checkUpdates) void checker.check(false)
  })

  void refreshLocation()
  checker.start()
  return checker
}
