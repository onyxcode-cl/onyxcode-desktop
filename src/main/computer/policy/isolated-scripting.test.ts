/** C5 (revisión final 1.8.19): desde una Tarea aislada no se controlan terminales, guiones, diálogos del sistema ni Finder/Explorador. */
import { describe, expect, it } from 'vitest'
import { isIsolatedScriptingApp } from './isolated-scripting'
import { isWinIsolatedExempt } from '../mcp-platform-win32'

describe('Mac: por identificador (sin distinguir mayúsculas) y por nombre', () => {
  it.each([
    ['com.apple.Terminal', 'Terminal'],
    ['com.googlecode.iterm2', 'iTerm2'],
    ['dev.warp.Warp-Stable', 'Warp'],
    ['com.mitchellh.ghostty', 'Ghostty'],
    ['net.kovidgoyal.kitty', 'kitty'],
    ['org.alacritty', 'Alacritty'],
    ['com.apple.Automator', 'Automator'],
    ['com.apple.shortcuts', 'Atajos'],
    ['com.latenightsw.ScriptDebugger8', 'Script Debugger'],
    ['com.apple.coreservices.uiagent', 'CoreServicesUIAgent'],
    ['com.apple.UserNotificationCenter', 'UserNotificationCenter'],
    ['com.apple.SecurityAgent', 'SecurityAgent'],
    ['com.apple.keychainaccess', 'Acceso a Llaveros'],
    ['com.apple.finder', 'Finder']
  ])('%s / %s', (id, name) => {
    expect(isIsolatedScriptingApp(id)).toBe(true)
    expect(isIsolatedScriptingApp(id.toUpperCase())).toBe(true)
    expect(isIsolatedScriptingApp(undefined, name)).toBe(true)
    expect(isIsolatedScriptingApp(undefined, name.toLowerCase())).toBe(true)
  })
  it('una app normal no', () => {
    expect(isIsolatedScriptingApp('com.apple.Notes', 'Notes')).toBe(false)
    expect(isIsolatedScriptingApp('com.spotify.client', 'Spotify')).toBe(false)
  })
})

describe('Windows: por ejecutable o AUMID, y por nombre', () => {
  const k = (exe: string): string => `exe:c:\\windows\\system32\\${exe.toLowerCase()}|pub:microsoft windows`
  it.each([
    'cmd.exe',
    'powershell.exe',
    'pwsh.exe',
    'WindowsTerminal.exe',
    'wt.exe',
    'wscript.exe',
    'cscript.exe',
    'mshta.exe',
    'regedit.exe',
    'mmc.exe',
    'control.exe',
    'SystemSettings.exe',
    'Taskmgr.exe',
    'explorer.exe'
  ])('%s', (exe) => {
    expect(isWinIsolatedExempt(k(exe.toLowerCase()))).toBe(true)
    expect(isIsolatedScriptingApp(undefined, exe)).toBe(true)
  })
  it('Windows Terminal y Configuración por AUMID', () => {
    expect(isWinIsolatedExempt('aumid:microsoft.windowsterminal_8wekyb3d8bbwe!app')).toBe(true)
    expect(isWinIsolatedExempt('aumid:windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel')).toBe(true)
  })
  it('una app normal no', () => {
    expect(isWinIsolatedExempt(k('notepad.exe'))).toBe(false)
  })
})
