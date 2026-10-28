import { describe, expect, it } from 'vitest'
import { isRemoteClientApp } from './remote-clients'

describe('isRemoteClientApp', () => {
  it.each([
    [{ bundleId: 'com.microsoft.rdc.macos', name: 'Windows App' }, true],
    [{ bundleId: 'COM.TeamViewer.TeamViewer', name: 'x' }, true],
    [{ bundleId: 'x.y', name: 'AnyDesk' }, true],
    [{ bundleId: 'x.y', name: 'Escritorio remoto' }, true],
    [{ bundleId: 'com.parallels.desktop.console', name: 'Parallels Desktop' }, true],
    [{ bundleId: 'com.apple.Notes', name: 'Notes' }, false],
    [{ bundleId: 'com.spotify.client', name: 'Spotify' }, false],
    [{}, false]
  ])('%j => %s', (app, expected) => {
    expect(isRemoteClientApp(app)).toBe(expected)
  })
})
