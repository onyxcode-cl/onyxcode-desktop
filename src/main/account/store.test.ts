import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ACCOUNT_FILE, ACCOUNT_TEST_FILE, createAccountStore, isPlainTestStore, type SafeStorageLike, type StoredAccount } from './store'

/** safeStorage falso: «cifra» invirtiendo y con prefijo; nunca toca el Llavero. */
function fakeSafeStorage(available = true): SafeStorageLike & { calls: number } {
  const s = {
    calls: 0,
    isEncryptionAvailable: () => available,
    encryptString: (p: string) => {
      s.calls++
      return Buffer.from('ENC:' + [...p].reverse().join(''), 'utf8')
    },
    decryptString: (b: Buffer) => {
      const t = b.toString('utf8')
      if (!t.startsWith('ENC:')) throw new Error('no descifrable')
      return [...t.slice(4)].reverse().join('')
    }
  }
  return s
}

const DATA: StoredAccount = {
  session: { token: 'tok-secreto-123', email: 'ana@ejemplo.cl', provider: 'email' },
  lastValidation: 1_700_000_000_000
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'onyx-account-store-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('almacén cifrado', () => {
  it('guarda cifrado (el token no aparece en claro en disco) y lo recupera', () => {
    const st = createAccountStore({ dir, safeStorage: fakeSafeStorage() })
    expect(st.load()).toBeNull()
    st.save(DATA)
    const raw = readFileSync(join(dir, ACCOUNT_FILE))
    expect(raw.includes('tok-secreto-123')).toBe(false)
    expect(raw.includes('ana@ejemplo.cl')).toBe(false)
    expect(createAccountStore({ dir, safeStorage: fakeSafeStorage() }).load()).toEqual(DATA)
    expect(statSync(join(dir, ACCOUNT_FILE)).mode & 0o777).toBe(0o600)
  })

  it('clear borra el archivo', () => {
    const st = createAccountStore({ dir, safeStorage: fakeSafeStorage() })
    st.save(DATA)
    st.clear()
    expect(existsSync(join(dir, ACCOUNT_FILE))).toBe(false)
    expect(st.load()).toBeNull()
  })

  it('archivo ilegible o con contenido inválido: sin sesión y se borra', () => {
    writeFileSync(join(dir, ACCOUNT_FILE), 'basura')
    const st = createAccountStore({ dir, safeStorage: fakeSafeStorage() })
    expect(st.load()).toBeNull()
    expect(existsSync(join(dir, ACCOUNT_FILE))).toBe(false)
    const ss = fakeSafeStorage()
    writeFileSync(join(dir, ACCOUNT_FILE), ss.encryptString(JSON.stringify({ token: '', email: 'a@b.cl', provider: 'email' })))
    expect(createAccountStore({ dir, safeStorage: ss }).load()).toBeNull()
  })

  it('rechaza proveedor desconocido', () => {
    const ss = fakeSafeStorage()
    writeFileSync(join(dir, ACCOUNT_FILE), ss.encryptString(JSON.stringify({ token: 't', email: 'a@b.cl', provider: 'otro' })))
    expect(createAccountStore({ dir, safeStorage: ss }).load()).toBeNull()
  })

  it('crea la carpeta si no existe', () => {
    const sub = join(dir, 'a', 'b')
    const st = createAccountStore({ dir: sub, safeStorage: fakeSafeStorage() })
    st.save(DATA)
    expect(existsSync(join(sub, ACCOUNT_FILE))).toBe(true)
  })
})

describe('sin cifrado disponible: solo memoria', () => {
  it('memoryOnly=true, no escribe nada en disco y conserva la sesión en memoria', () => {
    const ss = fakeSafeStorage(false)
    const st = createAccountStore({ dir, safeStorage: ss })
    expect(st.memoryOnly).toBe(true)
    st.save(DATA)
    expect(existsSync(join(dir, ACCOUNT_FILE))).toBe(false)
    expect(existsSync(join(dir, ACCOUNT_TEST_FILE))).toBe(false)
    expect(ss.calls).toBe(0)
    expect(st.load()).toEqual(DATA)
    // Otra «ejecución»: no hay nada.
    expect(createAccountStore({ dir, safeStorage: ss }).load()).toBeNull()
    st.clear()
    expect(st.load()).toBeNull()
  })

  it('no lee un archivo cifrado si no hay cifrado disponible', () => {
    const on = createAccountStore({ dir, safeStorage: fakeSafeStorage() })
    on.save(DATA)
    expect(createAccountStore({ dir, safeStorage: fakeSafeStorage(false) }).load()).toBeNull()
  })

  it('al pasar a solo memoria borra la sesión antigua del disco', () => {
    createAccountStore({ dir, safeStorage: fakeSafeStorage() }).save(DATA)
    createAccountStore({ dir, safeStorage: fakeSafeStorage(false) }).save(DATA)
    expect(existsSync(join(dir, ACCOUNT_FILE))).toBe(false)
  })

  it('isEncryptionAvailable que lanza cuenta como no disponible', () => {
    const ss = {
      ...fakeSafeStorage(),
      isEncryptionAvailable: () => {
        throw new Error('x')
      }
    }
    expect(createAccountStore({ dir, safeStorage: ss }).memoryOnly).toBe(true)
  })
})

describe('almacén en claro de prueba', () => {
  it('usa account.test.json y NO llama a safeStorage', () => {
    const ss = fakeSafeStorage()
    const st = createAccountStore({ dir, safeStorage: ss, plainTest: true })
    expect(st.memoryOnly).toBe(false)
    st.save(DATA)
    expect(ss.calls).toBe(0)
    expect(existsSync(join(dir, ACCOUNT_FILE))).toBe(false)
    expect(JSON.parse(readFileSync(join(dir, ACCOUNT_TEST_FILE), 'utf8')).email).toBe('ana@ejemplo.cl')
    expect(createAccountStore({ dir, safeStorage: ss, plainTest: true }).load()).toEqual(DATA)
  })

  it('carga una semilla escrita a mano (la usan los E2E)', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, ACCOUNT_TEST_FILE), JSON.stringify({ token: 't', email: 'a@b.cl', provider: 'google', lastValidation: 5 }))
    expect(createAccountStore({ dir, safeStorage: fakeSafeStorage(), plainTest: true }).load()).toEqual({
      session: { token: 't', email: 'a@b.cl', provider: 'google' },
      lastValidation: 5
    })
  })

  it('isPlainTestStore: solo sin empaquetar y con la variable a «1»', () => {
    expect(isPlainTestStore({ isPackaged: false, env: { ONYXCODE_TEST_PLAIN_STORE: '1' } })).toBe(true)
    expect(isPlainTestStore({ isPackaged: true, env: { ONYXCODE_TEST_PLAIN_STORE: '1' } })).toBe(false)
    expect(isPlainTestStore({ isPackaged: false, env: {} })).toBe(false)
    expect(isPlainTestStore({ isPackaged: false, env: { ONYXCODE_TEST_PLAIN_STORE: 'true' } })).toBe(false)
  })
})
