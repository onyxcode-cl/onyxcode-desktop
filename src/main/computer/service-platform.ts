/**
 * Lo que `ComputerService` (proceso principal) asume del sistema, detrás de una interfaz pura por plataforma (plan C, C3):
 * dónde está el helper nativo, cómo se matan sus procesos en vuelo al pulsar Detener, si hay vigía del Esc físico y qué
 * variables extra recibe el MCP. macOS conserva EXACTAMENTE lo de siempre (`service-platform.test.ts` lo fija); Windows habla
 * con `cu-helper.exe`; cualquier otra plataforma no tiene Control del PC (sin helper, nada que matar).
 *
 * Es solo la parte de `service.ts` que se puede separar sin tocar el comportamiento. C4 añade lo que decide la plataforma:
 * `ownConsent` (Windows no tiene TCC: consentimiento propio de la app, `GET /consent` y estado de Ajustes), `stopOnPowerEvents`
 * (bloqueo de sesión o suspensión → parada) y `auditLog` (registro auditable; en macOS NO existe, decisión pendiente del dueño).
 *
 * Puro: sin Electron, sin disco ni procesos (los pasos de parada son datos que `service.ts` ejecuta).
 */
import { join } from 'node:path'

export interface HelperLocations {
  /** `process.resourcesPath ?? ''`. */
  resourcesPath: string
  appPath: string
  cwd: string
}

/** Un comando de la parada de respaldo; `delayAfterMs` = espera antes del siguiente paso. */
export interface KillStep {
  cmd: string
  args: string[]
  delayAfterMs?: number
}

export interface ServicePlatform {
  readonly id: 'darwin' | 'win32' | 'none'
  /** ¿Hay vigía del Esc físico (`cu-helper watch-esc`)? */
  readonly hasEscWatcher: boolean
  /** Rutas candidatas del helper, en orden de preferencia. `unpacked` mapea `app.asar` → `app.asar.unpacked`. */
  helperCandidates: (loc: HelperLocations, unpacked: (p: string) => string) => string[]
  /** Pasos de la parada de respaldo de los helpers en vuelo (tecleo o arrastre a medias): suelta la entrada y mata. */
  killHelperSteps: (helperPath: string) => KillStep[]
  /** Consentimiento propio de la app en lugar de los permisos TCC (Windows). macOS: false (Accesibilidad y Grabación de pantalla). */
  readonly ownConsent: boolean
  /** Eventos de `powerMonitor` que paran el control (como un Detener). macOS: ninguno (cambiarlo es decisión del dueño). */
  readonly stopOnPowerEvents: readonly ('lock-screen' | 'suspend')[]
  /** Registro auditable de acciones (`userData/computer-audit.jsonl`). macOS: no hay (decisión del dueño). */
  readonly auditLog: boolean
  /** Variables de entorno extra del MCP (se suman a las comunes). */
  mcpEnvExtras: (ctx: { isPackaged: boolean; env: Record<string, string | undefined> }) => Record<string, string>
}

/** Escapa una cadena para usarla literal en una regex extendida (`pkill -f`). */
export function ereLiteral(s: string): string {
  return s.replace(/[.[\]{}()*+?^$|\\]/g, '\\$&')
}

const darwin: ServicePlatform = {
  id: 'darwin',
  hasEscWatcher: true,
  ownConsent: false,
  stopOnPowerEvents: [],
  auditLog: false,
  helperCandidates: (loc, unpacked) => [
    join(loc.resourcesPath, 'computer-use', 'bin', 'cu-helper'),
    unpacked(join(loc.appPath, 'resources', 'computer-use', 'bin', 'cu-helper')),
    join(loc.cwd, 'resources', 'computer-use', 'bin', 'cu-helper')
  ],
  killHelperSteps: (bin) => {
    // Solo el binario de esta app (ruta completa; también cuando va con flags --instant, etc.).
    // SIGTERM primero: el helper suelta el botón si estaba arrastrando; SIGKILL por si no sale.
    const pattern = `^${ereLiteral(bin)}( |$)`
    return [
      { cmd: '/usr/bin/pkill', args: ['-TERM', '-f', pattern], delayAfterMs: 300 },
      { cmd: '/usr/bin/pkill', args: ['-KILL', '-f', pattern] }
    ]
  },
  mcpEnvExtras: () => ({})
}

const win32: ServicePlatform = {
  id: 'win32',
  hasEscWatcher: true,
  ownConsent: true,
  stopOnPowerEvents: ['lock-screen', 'suspend'],
  auditLog: true,
  // Empaquetado: `computer-use/bin/cu-helper.exe` (extraResources de electron-builder, C7); desarrollo: la salida de C2.
  helperCandidates: (loc, unpacked) => [
    join(loc.resourcesPath, 'computer-use', 'bin', 'cu-helper.exe'),
    unpacked(join(loc.appPath, 'resources', 'computer-use', 'win', 'bin', 'cu-helper.exe')),
    join(loc.cwd, 'resources', 'computer-use', 'win', 'bin', 'cu-helper.exe')
  ],
  // No hay SIGTERM: `taskkill /T` mata el árbol y SIEMPRE se ejecuta `release-input` después (botones y modificadores arriba).
  killHelperSteps: (bin) => [
    { cmd: 'taskkill', args: ['/F', '/T', '/IM', 'cu-helper.exe'], delayAfterMs: 100 },
    { cmd: bin, args: ['release-input'] }
  ],
  mcpEnvExtras: ({ isPackaged, env }) => ({
    COMPUTER_BACKEND: 'win32',
    // Cerrojo propio del helper (`COMPUTER_WIN_CONSENT=1`; sin él rechaza todo lo que actúa). Solo lo lleva el proceso del MCP, que
    // lo lanza main; la puerta real es `GET /consent` antes de CADA herramienta (revocable al instante). Un `cu-helper` lanzado
    // desde el bash del agente no hereda esta variable y se niega.
    COMPUTER_WIN_CONSENT: '1',
    // Helper falso de pruebas (`node e2e/fake-cu-helper/fake.mjs`): solo sin empaquetar, como `COMPUTER_FAKE_SCREENSHOT`.
    ...(!isPackaged && env.CU_HELPER_ARGV0 === 'node' ? { CU_HELPER_ARGV0: 'node' } : {})
  })
}

const none: ServicePlatform = {
  id: 'none',
  hasEscWatcher: false,
  ownConsent: false,
  stopOnPowerEvents: [],
  auditLog: false,
  helperCandidates: () => [],
  killHelperSteps: () => [],
  mcpEnvExtras: () => ({})
}

export function servicePlatformFor(platform: string): ServicePlatform {
  return platform === 'darwin' ? darwin : platform === 'win32' ? win32 : none
}
