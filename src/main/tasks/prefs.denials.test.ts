import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeTasksPrefs, TasksPrefsStore } from './prefs'

describe('preferencia de avisos de aislamiento', () => {
  it('encendida por defecto al migrar preferencias y valida booleanos estrictos', () => {
    for (const raw of [null, {}, { sandboxDenialNotices: 'false' }, { sandboxDenialNotices: 0 }]) {
      expect(normalizeTasksPrefs(raw).sandboxDenialNotices).toBe(true)
    }
    expect(normalizeTasksPrefs({ sandboxDenialNotices: false }).sandboxDenialNotices).toBe(false)
  })
  it('guarda apagado, conserva al cambiar otro ajuste y restaura desde disco', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzx-denial-prefs-'))
    try {
      const file = join(dir, 'tasks-prefs.json')
      const store = new TasksPrefsStore(file)
      store.set({ sandboxDenialNotices: false })
      store.set({ maxServers: 2 })
      expect(new TasksPrefsStore(file).get().sandboxDenialNotices).toBe(false)
      expect(store.set({ sandboxDenialNotices: true }).sandboxDenialNotices).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
