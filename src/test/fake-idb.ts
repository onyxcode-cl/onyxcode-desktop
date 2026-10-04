/**
 * Doble mínimo de `IDBFactory` en memoria (sin dependencias) para probar `pwa/src/store.ts`. Solo cubre lo que el almacén usa:
 * `open` con `onupgradeneeded`, `transaction().objectStore().get/put/delete`. Los valores se clonan con `structuredClone`
 * como haría el navegador (un `CryptoKey` no exportable sobrevive al clon sin exponer sus bytes).
 */
interface Req<T> {
  result: T
  onsuccess: (() => void) | null
  onerror: (() => void) | null
}

function later<T>(r: Req<T>, value: T): void {
  queueMicrotask(() => {
    r.result = value
    r.onsuccess?.()
  })
}

export interface FakeIdbOptions {
  /** `open` falla (navegador sin almacenamiento). */
  failOpen?: boolean
}

export function fakeIndexedDB(opts: FakeIdbOptions = {}): IDBFactory & { stores: Map<string, Map<string, unknown>> } {
  const stores = new Map<string, Map<string, unknown>>()
  const db = {
    objectStoreNames: { contains: (n: string) => stores.has(n) },
    createObjectStore: (n: string) => void stores.set(n, new Map()),
    close: () => undefined,
    transaction: (name: string) => ({
      objectStore: () => {
        const m = stores.get(name) as Map<string, unknown>
        return {
          get: (k: string) => {
            const r = { onsuccess: null, onerror: null } as unknown as Req<unknown>
            later(r, m.has(k) ? structuredClone(m.get(k)) : undefined)
            return r
          },
          put: (v: unknown, k: string) => {
            const r = { onsuccess: null, onerror: null } as unknown as Req<unknown>
            m.set(k, structuredClone(v))
            later(r, k)
            return r
          },
          delete: (k: string) => {
            const r = { onsuccess: null, onerror: null } as unknown as Req<unknown>
            m.delete(k)
            later(r, undefined)
            return r
          }
        }
      }
    })
  }
  const factory = {
    stores,
    open: () => {
      const r = { result: db, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null } as unknown as Req<unknown> & {
        onupgradeneeded: (() => void) | null
      }
      queueMicrotask(() => {
        if (opts.failOpen) return r.onerror?.()
        const fresh = stores.size === 0
        if (fresh) r.onupgradeneeded?.()
        r.result = db
        r.onsuccess?.()
      })
      return r
    }
  }
  return factory as unknown as IDBFactory & { stores: Map<string, Map<string, unknown>> }
}
