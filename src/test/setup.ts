import { vi } from 'vitest'

/** Almacenamiento en memoria (los stores leen localStorage al crearse). */
class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length(): number {
    return this.data.size
  }
  clear(): void {
    this.data.clear()
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.data.delete(key)
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value))
  }
}

/** `window.api` falso: `lib/api.ts` lo evalúa al importar. Registra las llamadas a `invoke`. */
export const fakeApi = {
  invoke: vi.fn(() => Promise.resolve({ ok: true, data: undefined })),
  on: vi.fn(() => () => undefined),
  send: vi.fn()
}

vi.stubGlobal('localStorage', new MemoryStorage())
vi.stubGlobal('window', {
  api: fakeApi,
  localStorage: globalThis.localStorage,
  addEventListener: () => undefined,
  removeEventListener: () => undefined
})
vi.stubGlobal('document', { hasFocus: () => true, visibilityState: 'visible' })

// Los tests (y sus snapshots) corren siempre en español: el idioma activo parte en `es`.
import { setLang } from '@shared/i18n'
setLang('es')
