import { describe, expect, it } from 'vitest'
import { isUnifiedAppsEnabled, isUnifiedAppsEnabledFor, UNIFIED_APPS_ENV, UNIFIED_APPS_WIN_ENV } from './unified-bridge'

const A = UNIFIED_APPS_ENV
const W = UNIFIED_APPS_WIN_ENV

describe('isUnifiedAppsEnabledFor (encendido por defecto, se apaga con =0)', () => {
  const table: Array<[NodeJS.Platform, Record<string, string>, boolean]> = [
    ['darwin', {}, true],
    ['darwin', { [A]: '1' }, true],
    ['darwin', { [A]: '0' }, false],
    ['darwin', { [A]: 'true' }, true],
    ['darwin', { [W]: '0' }, true],
    ['win32', {}, true],
    ['win32', { [A]: '1', [W]: '1' }, true],
    ['win32', { [A]: '0' }, false],
    ['win32', { [W]: '0' }, false],
    ['win32', { [A]: '0', [W]: '1' }, false],
    ['linux', {}, false],
    ['linux', { [A]: '1' }, true],
    ['linux', { [A]: '0' }, false]
  ]
  it.each(table)('%s %j => %s', (platform, env, expected) => {
    expect(isUnifiedAppsEnabledFor(platform, env)).toBe(expected)
  })
  it('isUnifiedAppsEnabled usa la misma regla', () => {
    expect(isUnifiedAppsEnabled({}, 'win32')).toBe(true)
    expect(isUnifiedAppsEnabled({ [W]: '0' }, 'win32')).toBe(false)
    expect(isUnifiedAppsEnabled({ [A]: '0' }, 'darwin')).toBe(false)
    expect(isUnifiedAppsEnabled({}, 'darwin')).toBe(true)
  })
})
