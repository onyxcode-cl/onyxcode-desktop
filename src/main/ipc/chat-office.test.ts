import { describe, expect, it, vi } from 'vitest'
import { IPC_SCHEMAS, CHANNEL_ROLES } from './schemas'
import { TASKS_INVOKE_CHANNELS } from '@shared/ipc-tasks'
import { CELULAR_POLICY, decide } from '../remote/policy'
import { buildTasksApi } from '../../preload/tasks-api'
import type { IpcRenderer } from 'electron'

const channel = 'tasks:chatOffice:prepare'
const payload = { files: [{ name: 'informe.docx', base64: 'UEsDBA==' }] }
describe('IPC de originales Office: estricto y solo escritorio', () => {
  it('tiene contrato/esquema, builder de preload y prohibición remota; ninguna ventana secundaria lo obtiene', async () => {
    expect(TASKS_INVOKE_CHANNELS).toContain(channel)
    expect(IPC_SCHEMAS[channel](payload)).toEqual(payload)
    for (const roles of Object.values(CHANNEL_ROLES)) expect(roles.has(channel)).toBe(false)
    expect(CELULAR_POLICY[channel]).toBe('X')
    expect(decide({ kind: 'ipc', channel, payload }, {} as never)).toMatchObject({ allow: false })
    const invoke = vi.fn().mockResolvedValue({ ok: true, data: {} })
    const api = buildTasksApi({ invoke } as unknown as IpcRenderer)
    await api.invoke(channel, payload)
    expect(invoke).toHaveBeenCalledWith(channel, payload)
  })
  it('rechaza claves adicionales, destino arbitrario, tipos, extensión, separadores y exceso de tamaño/cantidad', () => {
    const v = IPC_SCHEMAS[channel],
      file = payload.files[0]
    for (const bad of [
      { files: [] },
      { ...payload, folder: '/arbitraria' },
      { files: [{ ...file, fullAccess: true }] },
      { files: [{ ...file, name: '../a.docx' }] },
      { files: [{ ...file, name: 'C:\\a.xlsx' }] },
      { files: [{ ...file, name: 'x.xls' }] },
      { files: [{ ...file, name: 'x.pptm' }] },
      { files: [{ ...file, base64: new Uint8Array(4) }] },
      { files: [{ ...file, base64: '!!!!!' }] },
      { files: [{ ...file, base64: 'A'.repeat(14 * 1024 * 1024) }] },
      { files: Array(6).fill(file) }
    ])
      expect(() => v(bad)).toThrow()
  })
})
