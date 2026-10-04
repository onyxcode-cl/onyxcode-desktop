/**
 * «Aprobar comandos desde este celular» (F8-B74): ajuste POR DISPOSITIVO, apagado por defecto. Encenderlo exige una confirmación
 * PROPIA en el Mac (diálogo nativo con texto claro; el celular no puede encenderlo: `remote:*` es X), queda en la auditoría y se
 * apaga desde Ajustes o con «Cortar todo». Sin diálogo disponible o si el dueño lo rechaza, se queda apagado (falla cerrado).
 */
import type { AuditInput } from './audit'
import { deviceFingerprint } from './confirm-queue'
import type { DevicesStore } from './devices-store'

export interface EnableApproveInfo {
  deviceName: string
  /** 8 hex del sha256 del deviceId. */
  fingerprint: string
}

export interface ApproveSettingDeps {
  devices: DevicesStore
  audit?: (e: AuditInput) => void
  /** Diálogo del Mac para ENCENDER: `true` = el dueño lo permitió. Sin función = no se puede encender. */
  confirmEnable?: (info: EnableApproveInfo) => Promise<boolean>
}

/** Aplica el ajuste. Devuelve el valor final del dispositivo (`false` si no existe, se rechazó o no se pudo guardar). */
export async function applyApproveSetting(d: ApproveSettingDeps, deviceId: string, on: boolean): Promise<boolean> {
  const rec = d.devices.get(deviceId)
  if (!rec) return false
  const base = { device: deviceFingerprint(deviceId), name: rec.name }
  if (!on) {
    if (rec.canApproveCommands === true && d.devices.setCanApproveCommands(deviceId, false))
      d.audit?.({ kind: 'approve-disabled', ...base })
    return false
  }
  if (rec.canApproveCommands === true) return true
  if (!d.confirmEnable) return false
  let ok = false
  try {
    ok = (await d.confirmEnable({ deviceName: rec.name, fingerprint: base.device })) === true
  } catch {
    ok = false
  }
  if (!ok) return false
  // El dispositivo pudo revocarse mientras el diálogo estaba abierto.
  if (!d.devices.get(deviceId)) return false
  try {
    if (!d.devices.setCanApproveCommands(deviceId, true)) return false
  } catch {
    return false
  }
  d.audit?.({ kind: 'approve-enabled', ...base })
  return true
}
