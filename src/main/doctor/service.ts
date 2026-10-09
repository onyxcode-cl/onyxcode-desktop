/** Doctor con las dependencias reales (macOS). Solo mira: no pide permisos ni abre ventanas del sistema. */
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, statfsSync } from 'node:fs'
import { release } from 'node:os'
import { dirname, join } from 'node:path'
import type { DoctorReport } from '@shared/doctor'
import type { ComputerService } from '../computer/service'
import { officeService } from '../office/service'
import { findBundledPython } from '../tasks/python-runtime'
import { runDoctor } from './doctor'

const run = (file: string, args: string[]): Promise<{ code: number; out: string }> =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 15_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code as number) : err ? -1 : 0
      resolve({ code, out: `${stdout}${stderr}` })
    })
  })

export function runRealDoctor(computer?: ComputerService): Promise<DoctorReport> {
  const helper = computer?.helperPath() ?? null
  return runDoctor({
    platform: process.platform,
    osRelease: release(),
    computer: async () => (computer ? computer.status() : null),
    run,
    exists: existsSync,
    keysBin: helper ? join(dirname(helper), 'cu-keys') : null,
    pythonBin: findBundledPython({
      platform: process.platform,
      arch: process.arch,
      resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
      appPath: app.getAppPath(),
      exists: existsSync
    }),
    office: () => {
      const s = officeService().snapshot().status
      return s.state === 'installed' ? s : s.state === 'missing' ? s : { state: 'unsupported' }
    },
    freeBytes: () => {
      const s = statfsSync(app.getPath('userData'))
      return s.bavail * s.bsize
    }
  })
}
