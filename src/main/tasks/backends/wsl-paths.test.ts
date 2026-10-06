import { describe, expect, it } from 'vitest'
import attack from '../__fixtures__/attack-paths.json'
import {
  checkNoLinks,
  fromSandboxPath,
  mountFor,
  toSandboxPath,
  toWinCanonical,
  winFromLinuxAbsolute,
  type PathMount,
  type PathRejectReason
} from './wsl-paths'

const reason = (r: { ok: boolean; reason?: string }): string | undefined => (r.ok ? undefined : r.reason)

describe('toSandboxPath', () => {
  it.each([
    ['C:\\Users\\Ben\\Docs\\x', '/win/c/Users/Ben/Docs/x'],
    ['c:/Users/Ben/Docs/x', '/win/c/Users/Ben/Docs/x'],
    ['D:\\', '/win/d'],
    ['Z:\\a\\\\b\\.\\c\\', '/win/z/a/b/c'],
    ['C:\\Mis Documentos\\año 2026\\Ñandú', '/win/c/Mis Documentos/año 2026/Ñandú'],
    ['C:\\Users\\BEN\\Docs', '/win/c/Users/BEN/Docs'],
    ['C:\\日本語\\フォルダ', '/win/c/日本語/フォルダ']
  ])('%s → %s', (win, linux) => {
    expect(toSandboxPath(win)).toEqual({ ok: true, path: linux })
  })

  const rejects: Array<[string, string, PathRejectReason]> = [
    ['UNC', '\\\\srv\\x', 'unc'],
    ['UNC con /', '//srv/x', 'unc'],
    ['UNC wsl', '\\\\wsl.localhost\\Debian\\etc', 'unc'],
    ['\\\\?\\', '\\\\?\\C:\\x', 'device'],
    ['\\\\.\\', '\\\\.\\pipe\\x', 'device'],
    ['ADS en archivo', 'C:\\a\\a.txt:secreto', 'ads'],
    ['ADS ::$DATA', 'C:\\x::$DATA', 'ads'],
    ['ADS en directorio', 'C:\\a:b\\c', 'ads'],
    ['dos puntos', 'C:\\a\\..\\b', 'dotdot'],
    ['dos puntos al final', 'C:\\a\\b\\..', 'dotdot'],
    ['reservada CON', 'C:\\a\\CON', 'reserved'],
    ['reservada nul.txt', 'C:\\a\\nul.txt', 'reserved'],
    ['reservada com1', 'C:\\a\\com1', 'reserved'],
    ['reservada LPT9 mayúsculas', 'C:\\LPT9\\x', 'reserved'],
    ['reservada con espacio', 'C:\\a\\NUL .txt', 'reserved'],
    ['reservada CONIN$', 'C:\\a\\conin$', 'reserved'],
    ['relativa', 'a\\b', 'relative'],
    ['relativa con ./', '.\\a', 'relative'],
    ['vacía', '', 'empty'],
    ['unidad sola', 'C:', 'drive-relative'],
    ['relativa a la unidad', 'C:foo\\bar', 'drive-relative'],
    ['punto final', 'C:\\a\\b.', 'trailing'],
    ['espacio final', 'C:\\a\\b ', 'trailing'],
    ['nombre corto 8.3', 'C:\\PROGRA~1\\x', 'shortname'],
    ['carácter inválido', 'C:\\a\\b?c', 'invalid-char'],
    ['carácter de control', 'C:\\a\\b\u0001c', 'control'],
    ['NUL embebido', 'C:\\a\u0000.txt', 'control'],
    ['Linux a secas', '/etc/passwd', 'relative']
  ]
  it.each(rejects)('rechaza %s', (_n, win, why) => {
    const r = toSandboxPath(win)
    expect(r.ok).toBe(false)
    expect(reason(r)).toBe(why)
  })

  it('rutas largas: sin tope de 260, pero ≤ 4096 en total y ≤ 255 por segmento', () => {
    const seg = 'a'.repeat(100)
    const long = 'C:\\' + Array(5).fill(seg).join('\\') // > 260
    expect(long.length).toBeGreaterThan(260)
    expect(toSandboxPath(long).ok).toBe(true)
    expect(reason(toSandboxPath('C:\\' + 'a'.repeat(256)))).toBe('too-long')
    expect(toSandboxPath('C:\\' + 'a'.repeat(255)).ok).toBe(true)
    expect(reason(toSandboxPath('C:\\' + Array(50).fill('a'.repeat(100)).join('\\')))).toBe('too-long')
  })

  it('los nombres con caracteres parecidos a reservados pero válidos se aceptan', () => {
    for (const n of ['console', 'nulo', 'com10', 'lpt', 'auxiliar.txt', 'con-x', 'a b', '.lazunox']) {
      expect(toSandboxPath(`C:\\x\\${n}`).ok, n).toBe(true)
    }
  })
})

describe('fromSandboxPath', () => {
  const mounts: PathMount[] = [
    { win: 'C:\\Users\\Ben\\Docs\\x', linux: '/win/c/Users/Ben/Docs/x' },
    { win: 'C:\\Users\\Ben\\Docs\\x\\sub', linux: '/win/c/Users/Ben/Docs/x/sub' },
    { win: 'D:\\datos', linux: '/win/d/datos' }
  ]
  it.each([
    ['/win/c/Users/Ben/Docs/x', 'C:\\Users\\Ben\\Docs\\x'],
    ['/win/c/Users/Ben/Docs/x/', 'C:\\Users\\Ben\\Docs\\x'],
    ['/win/c/Users/Ben/Docs/x/a/b.txt', 'C:\\Users\\Ben\\Docs\\x\\a\\b.txt'],
    ['/win/c/Users/Ben/Docs/x//a/./b', 'C:\\Users\\Ben\\Docs\\x\\a\\b'],
    ['/win/c/users/ben/docs/X/a', 'C:\\Users\\Ben\\Docs\\x\\a'],
    ['/win/d/datos/ñ/ü.txt', 'D:\\datos\\ñ\\ü.txt']
  ])('%s → %s', (linux, win) => {
    expect(fromSandboxPath(linux, mounts)).toEqual({ ok: true, path: win })
  })

  it.each([
    ['/etc/passwd', 'outside'],
    ['/win/d/otra', 'outside'],
    ['/win/c/Users/Ben/Docs', 'outside'],
    ['/win/c/Users/Ben/Docs/xx/a', 'outside'],
    ['/win/c/Users/Ben/Docs/x/../../y', 'dotdot'],
    ['/win/c/Users/Ben/Docs/x/a:b', 'ads'],
    ['/win/c/Users/Ben/Docs/x/a\\b', 'backslash'],
    ['/win/c/Users/Ben/Docs/x/nul', 'reserved'],
    ['/win/c/Users/Ben/Docs/x/a.', 'trailing'],
    ['/win/c/Users/Ben/Docs/x/PROGRA~1', 'shortname'],
    ['/win/c/Users/Ben/Docs/x/a\u0000', 'control'],
    ['rel/ativa', 'relative'],
    ['', 'empty'],
    ['/mnt/c/Users', 'outside'],
    ['//srv/x', 'outside'],
    ['\\\\srv\\x', 'backslash']
  ])('rechaza %s (%s)', (linux, why) => {
    expect(reason(fromSandboxPath(linux, mounts))).toBe(why)
  })

  it('sin montajes nada vuelve', () => {
    expect(reason(fromSandboxPath('/win/c/x', []))).toBe('outside')
  })
  it('ida y vuelta: toSandboxPath → fromSandboxPath con mountFor', () => {
    for (const w of ['C:\\Users\\Ben\\Docs\\x', 'D:\\a b\\ñ', 'E:\\']) {
      const m = mountFor(w)
      expect(m.ok).toBe(true)
      if (!m.ok) continue
      expect(fromSandboxPath(m.mount.linux + '/f.txt', [m.mount])).toEqual({
        ok: true,
        path: `${m.mount.win.replace(/\\+$/, '')}\\f.txt`
      })
    }
  })
  it('mountFor propaga el rechazo', () => {
    expect(reason(mountFor('\\\\srv\\x'))).toBe('unc')
  })
})

describe('checkNoLinks (lstat inyectado)', () => {
  const fs = (links: string[], existing: string[]) => (p: string) => {
    if (links.includes(p)) return { isSymbolicLink: () => true }
    if (existing.includes(p)) return { isSymbolicLink: () => false }
    return null
  }
  it('sin enlaces: ok; componentes inexistentes cortan el recorrido', () => {
    expect(checkNoLinks('C:\\r', ['a', 'b'], fs([], ['C:\\r\\a', 'C:\\r\\a\\b']))).toEqual({ ok: true })
    expect(checkNoLinks('C:\\r', ['nuevo', 'x'], fs([], []))).toEqual({ ok: true })
  })
  it('una junction o symlink en cualquier nivel se rechaza', () => {
    expect(checkNoLinks('C:\\r', ['a', 'j', 'x'], fs(['C:\\r\\a\\j'], ['C:\\r\\a']))).toEqual({
      ok: false,
      reason: 'link',
      at: 'C:\\r\\a\\j'
    })
  })
  it('error del lstat: falla cerrado', () => {
    const r = checkNoLinks('C:\\r', ['a'], () => {
      throw new Error('EACCES')
    })
    expect(r.ok).toBe(false)
  })
})

const isLinuxForm = (p: string): boolean => /^\/(?!\/)/.test(p)

describe('winFromLinuxAbsolute y vectores compartidos (attack-paths.json)', () => {
  it.each(attack.accept.map((c) => [c.id, c.sandbox, c.win] as const))('/win → Windows: %s', (_id, sandbox, win) => {
    expect(winFromLinuxAbsolute(sandbox)).toEqual({ ok: true, path: win })
  })
  it.each(attack.reject.filter((c) => isLinuxForm(c.ui)).map((c) => [c.id, c.ui, c.reason] as const))('rechaza %s', (_id, ui, why) => {
    expect(reason(winFromLinuxAbsolute(ui))).toBe(why)
  })
  it.each(attack.reject.filter((c) => !isLinuxForm(c.ui) && c.reason !== 'empty').map((c) => [c.id, c.ui, c.reason] as const))(
    'toSandboxPath rechaza %s',
    (_id, ui, why) => {
      const r = toSandboxPath(ui)
      expect(r.ok).toBe(false)
      expect(reason(r)).toBe(why)
    }
  )
  it('biyección: toWinCanonical(toSandboxPath(w)) y de vuelta', () => {
    for (const c of attack.accept) {
      const s = toSandboxPath(c.win)
      expect(s, c.id).toEqual({ ok: true, path: c.sandbox })
      expect(toWinCanonical(c.sandbox), c.id).toBe(c.win)
    }
  })
  it('el reexportador antiguo y el módulo compartido son el mismo', async () => {
    const shared = await import('@shared/wsl-paths')
    expect(shared.toSandboxPath).toBe(toSandboxPath)
    expect(shared.winFromLinuxAbsolute).toBe(winFromLinuxAbsolute)
  })
})
