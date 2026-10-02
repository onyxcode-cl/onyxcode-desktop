import { describe, expect, it } from 'vitest'
import { DEFAULT_QUICK_ENTRY_SHORTCUT, defaultQuickEntryShortcut } from './ipc-extras'

describe('defaultQuickEntryShortcut', () => {
  it('Windows evita Alt+Space (menú del sistema): Alt+Shift+Space', () => {
    expect(defaultQuickEntryShortcut('win32')).toBe('Alt+Shift+Space')
  })
  it('macOS y Linux conservan Alt+Space', () => {
    expect(defaultQuickEntryShortcut('darwin')).toBe(DEFAULT_QUICK_ENTRY_SHORTCUT)
    expect(defaultQuickEntryShortcut('linux')).toBe('Alt+Space')
  })
})
