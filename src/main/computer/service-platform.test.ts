import { describe, expect, it } from 'vitest'
import { ereLiteral, servicePlatformFor } from './service-platform'

const loc = { resourcesPath: '/R', appPath: '/A/app.asar', cwd: '/C' }
const unpacked = (p: string): string => p.replace('app.asar', 'app.asar.unpacked')

describe('ComputerService por plataforma (macOS = lo de siempre)', () => {
  const mac = servicePlatformFor('darwin')
  it('rutas del helper: las tres de antes y en el mismo orden', () => {
    expect(mac.helperCandidates(loc, unpacked)).toEqual([
      '/R/computer-use/bin/cu-helper',
      '/A/app.asar.unpacked/resources/computer-use/bin/cu-helper',
      '/C/resources/computer-use/bin/cu-helper'
    ])
  })
  it('parada de respaldo: pkill -TERM, 300 ms, pkill -KILL, con el patrón de la ruta completa', () => {
    const bin = '/Applications/Lazunox.app/Contents/Resources/computer-use/bin/cu-helper'
    const pattern = '^/Applications/Lazunox\\.app/Contents/Resources/computer-use/bin/cu-helper( |$)'
    expect(mac.killHelperSteps(bin)).toEqual([
      { cmd: '/usr/bin/pkill', args: ['-TERM', '-f', pattern], delayAfterMs: 300 },
      { cmd: '/usr/bin/pkill', args: ['-KILL', '-f', pattern] }
    ])
  })
  it('vigía de Esc sí; el MCP no recibe variables extra (el entorno de macOS no cambia)', () => {
    expect(mac.hasEscWatcher).toBe(true)
    expect(mac.mcpEnvExtras({ isPackaged: false, env: { CU_HELPER_ARGV0: 'node' } })).toEqual({})
  })
  it('macOS: sin consentimiento propio, sin parada por bloqueo de sesión y sin registro auditable (decisiones del dueño)', () => {
    expect(mac.ownConsent).toBe(false)
    expect(mac.stopOnPowerEvents).toEqual([])
    expect(mac.auditLog).toBe(false)
  })
  it('ereLiteral escapa los metacaracteres de la regex extendida', () => {
    expect(ereLiteral('a.b[c]{d}(e)*+?^$|\\f')).toBe('a\\.b\\[c\\]\\{d\\}\\(e\\)\\*\\+\\?\\^\\$\\|\\\\f')
  })
})

describe('ComputerService en Windows', () => {
  const win = servicePlatformFor('win32')
  it('busca cu-helper.exe: empaquetado en computer-use/bin y, en desarrollo, en la salida de win/bin', () => {
    const c = win.helperCandidates({ resourcesPath: 'C:\\R', appPath: 'C:\\A\\app.asar', cwd: 'C:\\C' }, unpacked)
    expect(c.every((p) => p.endsWith('cu-helper.exe'))).toBe(true)
    expect(c[0]).toMatch(/computer-use[\\/]bin[\\/]cu-helper\.exe$/)
    expect(c[1]).toMatch(/app\.asar\.unpacked.*computer-use[\\/]win[\\/]bin[\\/]cu-helper\.exe$/)
    expect(c[2]).toMatch(/resources[\\/]computer-use[\\/]win[\\/]bin[\\/]cu-helper\.exe$/)
  })
  it('parada de respaldo: taskkill /T y SIEMPRE release-input después', () => {
    const steps = win.killHelperSteps('C:\\x\\cu-helper.exe')
    expect(steps).toEqual([
      { cmd: 'taskkill', args: ['/F', '/T', '/IM', 'cu-helper.exe'], delayAfterMs: 100 },
      { cmd: 'C:\\x\\cu-helper.exe', args: ['release-input'] }
    ])
  })
  it('el MCP recibe COMPUTER_BACKEND=win32; el helper falso (node) solo sin empaquetar', () => {
    const base = { COMPUTER_BACKEND: 'win32', COMPUTER_WIN_CONSENT: '1' }
    expect(win.mcpEnvExtras({ isPackaged: true, env: { CU_HELPER_ARGV0: 'node' } })).toEqual(base)
    expect(win.mcpEnvExtras({ isPackaged: false, env: {} })).toEqual(base)
    expect(win.mcpEnvExtras({ isPackaged: false, env: { CU_HELPER_ARGV0: 'node' } })).toEqual({ ...base, CU_HELPER_ARGV0: 'node' })
    expect(win.mcpEnvExtras({ isPackaged: false, env: { CU_HELPER_ARGV0: 'powershell' } })).toEqual(base)
  })
  it('hay vigía de Esc (el helper tiene watch-esc con el gancho de teclado)', () => {
    expect(win.hasEscWatcher).toBe(true)
  })
  it('consentimiento propio, parada al bloquear la sesión o suspender, y registro auditable', () => {
    expect(win.ownConsent).toBe(true)
    expect(win.stopOnPowerEvents).toEqual(['lock-screen', 'suspend'])
    expect(win.auditLog).toBe(true)
  })
})

describe('otras plataformas: sin Control del PC', () => {
  it('ni helper, ni vigía, ni nada que matar', () => {
    const p = servicePlatformFor('linux')
    expect(p.id).toBe('none')
    expect(p.helperCandidates(loc, unpacked)).toEqual([])
    expect(p.hasEscWatcher).toBe(false)
    expect(p.killHelperSteps('/x')).toEqual([])
    expect([p.ownConsent, p.stopOnPowerEvents.length, p.auditLog]).toEqual([false, 0, false])
  })
})
