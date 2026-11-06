import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ dialog: {}, app: { getPath: () => '' } }))

import { zoneIdentifierContent } from './downloads'

const isWin = process.platform === 'win32'

describe('zoneIdentifierContent', () => {
  it('marca ZoneId=3 con HostUrl', () => {
    expect(zoneIdentifierContent('https://example.com/a/b.zip?x=1')).toBe(
      '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://example.com/a/b.zip?x=1\r\n'
    )
  })

  it('quita usuario y contraseña de HostUrl', () => {
    const out = zoneIdentifierContent('https://user:secreto@example.com/f.exe')
    expect(out).not.toContain('user')
    expect(out).not.toContain('secreto')
    expect(out).toContain('HostUrl=https://example.com/f.exe\r\n')
  })

  it('no incluye ReferrerUrl', () => {
    expect(zoneIdentifierContent('https://example.com/')).not.toContain('ReferrerUrl')
  })

  it('con URL inválida deja solo la zona', () => {
    expect(zoneIdentifierContent('no es url')).toBe('[ZoneTransfer]\r\nZoneId=3\r\n')
  })
})

describe('flujo Zone.Identifier', () => {
  it.runIf(isWin)('se puede escribir y leer en NTFS', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zone-'))
    try {
      const f = join(dir, 'a.txt')
      writeFileSync(f, 'x')
      writeFileSync(`${f}:Zone.Identifier`, zoneIdentifierContent('https://u:p@example.com/a.txt'))
      expect(readFileSync(`${f}:Zone.Identifier`, 'utf8')).toBe(
        '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://example.com/a.txt\r\n'
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
