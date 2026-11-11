import { describe, expect, it } from 'vitest'
import { t } from '@shared/i18n'
import { engineConfigFolders, forbiddenFolderReason } from './folder-policy'

const HOME = '/Users/ana'
const ctx = { home: HOME, userData: `${HOME}/Library/Application Support/Lazunox`, mounts: [] }
const reason = (p: string): string | null => forbiddenFolderReason(p, ctx, 'darwin')

describe('H5: carpetas de configuración de los agentes (macOS)', () => {
  it('lista las tres carpetas', () => {
    expect(engineConfigFolders(HOME)).toEqual([`${HOME}/.opencode`, `${HOME}/.claude`, `${HOME}/.config/opencode`])
  })

  it('rechaza cada una, sus subcarpetas (sin distinguir mayúsculas) y las carpetas que las contienen', () => {
    expect(reason(`${HOME}/.opencode`)).toBe(t('merr.folder.engineConfig', { path: '~/.opencode' }))
    expect(reason(`${HOME}/.opencode/plugin`)).toBe(t('merr.folder.engineConfig', { path: '~/.opencode' }))
    // `~/.claude` y `~/.config` ya estaban entre las carpetas de datos privados: se rechazan con ese motivo (antes que este).
    expect(reason(`${HOME}/.claude/agents`)).not.toBeNull()
    expect(reason(`${HOME}/.Claude`)).not.toBeNull()
    expect(reason(`${HOME}/.config/opencode/plugin`)).not.toBeNull()
    expect(reason(`${HOME}/.config`)).not.toBeNull()
    expect(reason(`${HOME}/.OPENCODE/tool`)).toBe(t('merr.folder.engineConfig', { path: '~/.opencode' }))
  })

  it('no rechaza carpetas normales ni nombres parecidos', () => {
    expect(reason(`${HOME}/Documents/proyecto`)).toBeNull()
    expect(reason(`${HOME}/Documents/proyecto/.opencode`)).toBeNull()
    expect(reason(`${HOME}/.opencode-viejo`)).toBeNull()
    expect(reason(`${HOME}/.claude2`)).toBeNull()
  })

  it('el mensaje existe en todos los idiomas y es lenguaje llano', () => {
    const es = t('merr.folder.engineConfig', { path: '~/.claude' })
    expect(es).not.toContain('merr.folder')
    expect(es).toContain('~/.claude')
  })
})
