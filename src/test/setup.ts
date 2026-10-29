import { vi } from 'vitest'

// Las pruebas no deben ejecutar jamás el cu-helper real compilado en el repo (ver `ComputerService.helperPath`): movería apps reales del equipo.
process.env.COMPUTER_TEST_NO_REPO_HELPER = '1'

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
// `navigator.language` de Node viene del idioma del SISTEMA OPERATIVO (en Linux sin configurar, "en-US";
// en macOS, el del usuario): `lib/i18n.ts` lo lee al importarse para detectar el idioma por defecto, y
// sin fijarlo acá los tests (y sus snapshots) cambiarían de idioma según la máquina que los corra.
// `userAgent` se copia tal cual (xterm.js lo usa para detectar el navegador): no se puede clonar todo
// `navigator` con `{...navigator}` porque sus propiedades son getters de campos privados de la clase
// (fallan fuera de la instancia real), así que se listan explícitamente las que hacen falta.
vi.stubGlobal('navigator', { userAgent: globalThis.navigator?.userAgent, language: 'es', languages: ['es'] })

// Los tests (y sus snapshots) corren siempre en español: el idioma activo parte en `es`.
import { setLang } from '@shared/i18n'
setLang('es')
