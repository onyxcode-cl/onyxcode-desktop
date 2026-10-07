import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isWinBlocked, isWinExempt, winDefaultTier, WIN_BLOCKED_AUMID_PREFIXES, WIN_BLOCKED_EXES } from './win-apps'

const exe = (p: string, pub = '(sin firma)'): string => `exe:${p.toLowerCase()}|pub:${pub}`

describe('listas de apps de Windows', () => {
  it('las bloqueadas son las del helper de Rust (blocklist.rs), ni una más ni una menos', () => {
    const rs = readFileSync(join(__dirname, '../../../../resources/computer-use/win/src/blocklist.rs'), 'utf8')
    const exes = [...rs.slice(rs.indexOf('BLOCKED_EXES'), rs.indexOf('];')).matchAll(/"([^"]+)"/g)].map((m) => m[1])
    expect([...WIN_BLOCKED_EXES]).toEqual(exes)
    const at = rs.slice(rs.indexOf('BLOCKED_AUMID_PREFIXES'))
    const aumids = [...at.slice(at.indexOf('= ['), at.indexOf('];')).matchAll(/"([^"]+)"/g)].map((m) => m[1])
    expect([...WIN_BLOCKED_AUMID_PREFIXES]).toEqual(aumids)
  })

  it('bloqueadas: consent.exe, gestores de contraseñas, Seguridad de Windows; una clave inválida también', () => {
    expect(isWinBlocked(exe('C:\\Windows\\System32\\consent.exe'))).toBe(true)
    expect(isWinBlocked(exe('C:\\Program Files\\KeePassXC\\KeePassXC.exe', 'KeePassXC Team'))).toBe(true)
    expect(isWinBlocked('aumid:microsoft.sechealthui_8wekyb3d8bbwe!sechealthui')).toBe(true)
    expect(isWinBlocked(exe('C:\\Windows\\notepad.exe'))).toBe(false)
    expect(isWinBlocked('mac.bundle.id')).toBe(true)
    expect(isWinBlocked('')).toBe(true)
  })

  it('exentas: Lazunox y el shell; explorer.exe no', () => {
    expect(isWinExempt(exe('C:\\Users\\a\\AppData\\Local\\Programs\\Lazunox\\Lazunox.exe'))).toBe(true)
    expect(isWinExempt(exe('C:\\Windows\\System32\\dwm.exe'))).toBe(true)
    expect(isWinExempt(exe('C:\\Windows\\explorer.exe'))).toBe(false)
    expect(isWinExempt('aumid:foo!bar')).toBe(false)
  })

  it('solo ver por defecto: navegadores y banca; lo demás se pregunta', () => {
    expect(winDefaultTier(exe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'Google LLC'), 'Google Chrome')).toBe('view')
    expect(winDefaultTier(exe('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'), 'Microsoft Edge')).toBe('view')
    expect(winDefaultTier('aumid:microsoft.microsoftedge.stable_8wekyb3d8bbwe!app', 'Edge')).toBe('view')
    expect(winDefaultTier(exe('C:\\Apps\\x\\tool.exe'), 'Banco Seguro')).toBe('view')
    expect(winDefaultTier(exe('C:\\Windows\\notepad.exe'), 'Bloc de notas')).toBeNull()
    expect(winDefaultTier(exe('C:\\Windows\\System32\\WindowsTerminal.exe'), 'Terminal')).toBeNull()
  })
})
