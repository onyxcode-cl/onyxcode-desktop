import { describe, expect, it } from 'vitest'
import { APP_ID } from './brand'
import { classifyAppLocation, permsStage, permsStallDetail, tccResetCommands, tccResetText } from './mac-permissions'

describe('classifyAppLocation', () => {
  it('detecta App Translocation y volúmenes montados solo en macOS', () => {
    expect(classifyAppLocation('/private/var/folders/ab/T/AppTranslocation/XYZ/d/Lazunox.app/Contents/MacOS/Lazunox', 'darwin')).toBe(
      'translocated'
    )
    expect(classifyAppLocation('/Volumes/Lazunox 0.5.11/Lazunox.app/Contents/MacOS/Lazunox', 'darwin')).toBe('volume')
    expect(classifyAppLocation('/Applications/Lazunox.app/Contents/MacOS/Lazunox', 'darwin')).toBeNull()
    expect(classifyAppLocation('/Users/a/Applications/Lazunox.app/Contents/MacOS/Lazunox', 'darwin')).toBeNull()
    expect(classifyAppLocation('/Volumes/x/Lazunox.app/Contents/MacOS/Lazunox', 'win32')).toBeNull()
  })
})

describe('permsStage', () => {
  it('distingue listo, reinicio y pendiente', () => {
    expect(permsStage({ accessibility: true, screenRecording: true })).toBe('ready')
    expect(permsStage({ accessibility: true, screenRecording: false })).toBe('restart')
    expect(permsStage({ accessibility: false, screenRecording: true })).toBe('pending')
    expect(permsStage({ accessibility: false, screenRecording: false })).toBe('pending')
  })
})

describe('comandos de reparación', () => {
  it('cubren la app y el helper, para Pantalla y Accesibilidad', () => {
    const cmds = tccResetCommands()
    expect(cmds).toContain(`tccutil reset ScreenCapture ${APP_ID}`)
    expect(cmds).toContain(`tccutil reset Accessibility ${APP_ID}`)
    expect(cmds).toContain(`tccutil reset ScreenCapture ${APP_ID}.cu-helper`)
    expect(cmds).toContain(`tccutil reset Accessibility ${APP_ID}.cu-helper`)
    expect(cmds).toHaveLength(4)
    expect(tccResetText().split('\n')).toEqual(cmds)
  })
})

describe('permsStallDetail', () => {
  it('solo lleva banderas y la ubicación, sin rutas', () => {
    expect(permsStallDetail({ helperOk: true, accessibility: true, screenRecording: false }, 'translocated')).toEqual({
      helperOk: 'sí',
      accessibility: 'sí',
      screenRecording: 'no',
      ubicacion: 'translocated'
    })
    expect(permsStallDetail({ helperOk: false, accessibility: false, screenRecording: false }, null).ubicacion).toBe('normal')
  })
})
