import { describe, expect, it } from 'vitest'
import { isUnifiedAppsEnabled, isUnifiedAppsEnabledFor, UNIFIED_APPS_ENV, UNIFIED_APPS_WIN_ENV } from './unified-bridge'

const A = UNIFIED_APPS_ENV
const W = UNIFIED_APPS_WIN_ENV

describe('isUnifiedAppsEnabledFor', () => {
  const table: Array<[NodeJS.Platform, Record<string, string>, boolean]> = [
    ['darwin', {}, false],
    ['darwin', { [A]: '1' }, true],
    ['darwin', { [W]: '1' }, false],
    ['darwin', { [A]: 'true' }, false],
    ['win32', {}, false],
    ['win32', { [A]: '1' }, false],
    ['win32', { [W]: '1' }, false],
    ['win32', { [A]: '1', [W]: '1' }, true],
    ['win32', { [A]: '1', [W]: 'yes' }, false],
    ['linux', { [A]: '1', [W]: '1' }, false]
  ]
  it.each(table)('%s %j => %s', (platform, env, expected) => {
    expect(isUnifiedAppsEnabledFor(platform, env)).toBe(expected)
  })
  it('isUnifiedAppsEnabled: Windows exige ambas; el resto conserva una sola', () => {
    expect(isUnifiedAppsEnabled({ [A]: '1' }, 'win32')).toBe(false)
    expect(isUnifiedAppsEnabled({ [A]: '1', [W]: '1' }, 'win32')).toBe(true)
    expect(isUnifiedAppsEnabled({ [A]: '1' }, 'darwin')).toBe(true)
  })
})
