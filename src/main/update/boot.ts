import { app } from 'electron'
import { BootMarkers, cleanupAfterBoot, updateDir } from './markers'
import { currentAppRealPath } from './swap'
import { IS_TEST_BUILD } from './test-build'

let markers: BootMarkers | null = null

/**
 * Arranque de esta instancia (solo si obtuvo el lock de instancia única): limpia restos de una
 * actualización anterior ya confirmada y escribe `booting-<ver>` con su PID para swap.sh.
 */
export function startBoot(): BootMarkers {
  const dir = updateDir(app.getPath('userData'))
  const version = app.getVersion()
  if (app.isPackaged) cleanupAfterBoot({ dir, appPath: currentAppRealPath(app.getPath('exe')), version })
  markers = new BootMarkers(dir, version, process.pid, IS_TEST_BUILD && process.env.ONYXCODE_TEST_FAIL_BOOT === '1')
  markers.begin()
  return markers
}

export function bootMarkers(): BootMarkers | null {
  return markers
}
