import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseEnv } from './env-parse'
import { redactSecrets } from './redact'
import { ProjectProfileStore, PROFILES_FILE, VAULT_FILE } from './store'
import type { SafeStorageLike } from '../remote/devices-store'

const fakeSafe = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from('ENC:' + Buffer.from(s, 'utf8').toString('base64')),
  decryptString: (b) => Buffer.from(b.toString().replace(/^ENC:/, ''), 'base64').toString('utf8')
})

describe('parseEnv', () => {
  it('lee NOMBRE=valor, export, comentarios y comillas', () => {
    const r = parseEnv('# nota\nAPI_KEY=abc123\nexport USER_X="ben"\nCOMILLA=\'a b\'\nCON_COMENTARIO=hola # fuera')
    expect(r.vars).toEqual({ API_KEY: 'abc123', USER_X: 'ben', COMILLA: 'a b', CON_COMENTARIO: 'hola' })
    expect(r.problems).toEqual([])
  })
  it('entiende valores de varias líneas entre comillas dobles', () => {
    const r = parseEnv('CONFIG="key1=val1\nkey2=val2"\nOTRA=1')
    expect(r.vars.CONFIG).toBe('key1=val1\nkey2=val2')
    expect(r.vars.OTRA).toBe('1')
  })
  it('no expande $(…) ni ${…}', () => {
    expect(parseEnv('X=$(whoami)\nY=${HOME}').vars).toEqual({ X: '$(whoami)', Y: '${HOME}' })
  })
  it('rechaza nombres que alteran cómo arrancan los programas, sin repetir el valor', () => {
    const r = parseEnv('PATH=/tmp/x\nLD_PRELOAD=/tmp/y.so\nNODE_OPTIONS=--require x\nLAZUNOX_TOKEN=zzz\nOK=1')
    expect(Object.keys(r.vars)).toEqual(['OK'])
    expect(r.problems).toHaveLength(4)
    expect(r.problems.join('\n')).not.toMatch(/tmp|zzz|require/)
  })
  it('avisa de líneas mal formadas y comillas sin cerrar', () => {
    const r = parseEnv('sin igual\nA="abierta\nB=2')
    expect(r.problems.length).toBeGreaterThanOrEqual(2)
  })
  it('nunca lanza con basura', () => {
    expect(() => parseEnv(undefined as unknown as string)).not.toThrow()
    expect(parseEnv('\u0000\u0001=1').vars).toEqual({})
  })
})

describe('redactSecrets', () => {
  it('tapa el valor y sus formas habituales', () => {
    const v = { TOKEN: 'abcd1234xyz' }
    const b64 = Buffer.from('abcd1234xyz').toString('base64')
    const out = redactSecrets(`ok abcd1234xyz y "abcd1234xyz" y ${b64}`, v)
    expect(out).not.toContain('abcd1234xyz')
    expect(out).not.toContain(b64)
    expect(out).toContain('«TOKEN»')
  })
  it('tapa primero el valor más largo', () => {
    const out = redactSecrets('clave-larga-secreta', { A: 'clave-larga', B: 'clave-larga-secreta' })
    expect(out).toBe('«B»')
  })
  it('no tapa valores muy cortos', () => {
    expect(redactSecrets('uno dos', { A: 'un' })).toBe('uno dos')
  })
})

describe('ProjectProfileStore', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ppf-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('el nivel por defecto es «comandos» y se guarda por carpeta', () => {
    const s = new ProjectProfileStore(dir, fakeSafe())
    expect(s.accessOf('/a/b')).toBe('comandos')
    expect(s.setAccess('/a/b', 'total')).toBe(true)
    expect(s.setAccess('/a/b', 'nada' as never)).toBe(false)
    expect(new ProjectProfileStore(dir, fakeSafe()).accessOf('/a/b/')).toBe('total')
    expect(new ProjectProfileStore(dir, fakeSafe()).accessOf('/a/c')).toBe('comandos')
  })

  it('la Bóveda va cifrada: ni el archivo de perfiles ni el de la bóveda contienen el valor', () => {
    const s = new ProjectProfileStore(dir, fakeSafe())
    const r = s.vaultSet('/p', 'API_KEY=valor-super-secreto')
    expect(r).toMatchObject({ ok: true, saved: ['API_KEY'] })
    s.setAccess('/p', 'aislado')
    const vault = readFileSync(join(dir, VAULT_FILE), 'utf8')
    expect(vault).not.toContain('valor-super-secreto')
    expect(readFileSync(join(dir, PROFILES_FILE), 'utf8')).not.toContain('valor-super-secreto')
    expect(s.vaultNames('/p')).toEqual(['API_KEY'])
    expect(s.envFor('/p')).toEqual({ API_KEY: 'valor-super-secreto' })
    expect(new ProjectProfileStore(dir, fakeSafe()).envFor('/p')).toEqual({ API_KEY: 'valor-super-secreto' })
  })

  it('sin cifrado disponible no guarda nada', () => {
    const s = new ProjectProfileStore(dir, fakeSafe(false))
    const r = s.vaultSet('/p', 'A=12345')
    expect(r).toMatchObject({ ok: false, reason: 'no-encryption' })
    expect(existsSync(join(dir, VAULT_FILE))).toBe(false)
  })

  it('una carpeta no ve las variables de otra y se puede borrar una', () => {
    const s = new ProjectProfileStore(dir, fakeSafe())
    s.vaultSet('/a', 'X=1111\nY=2222')
    s.vaultSet('/b', 'Z=3333')
    expect(s.vaultNames('/a')).toEqual(['X', 'Y'])
    expect(s.envFor('/b')).toEqual({ Z: '3333' })
    expect(s.vaultDelete('/a', 'X')).toBe(true)
    expect(s.vaultDelete('/a', 'X')).toBe(false)
    expect(s.vaultNames('/a')).toEqual(['Y'])
  })

  it('actualizar conserva lo anterior y respeta el tope', () => {
    const s = new ProjectProfileStore(dir, fakeSafe())
    s.vaultSet('/a', 'X=1111')
    s.vaultSet('/a', 'Y=2222')
    expect(s.vaultNames('/a')).toEqual(['X', 'Y'])
    const many = Array.from({ length: 60 }, (_, i) => `V${i}=valor${i}`).join('\n')
    expect(s.vaultSet('/a', many)).toMatchObject({ ok: false, reason: 'too-many' })
    expect(s.vaultNames('/a')).toEqual(['X', 'Y'])
  })

  it('redact() tapa los valores de esa carpeta', () => {
    const s = new ProjectProfileStore(dir, fakeSafe())
    s.vaultSet('/a', 'TOKEN=abcdef-123456')
    expect(s.redact('/a', 'salió abcdef-123456 al final')).toBe('salió «TOKEN» al final')
    expect(s.redact('/otra', 'salió abcdef-123456')).toBe('salió abcdef-123456')
  })

  it('un bloque dañado no rompe: queda vacío', () => {
    const s = new ProjectProfileStore(dir, fakeSafe())
    s.vaultSet('/a', 'X=1111')
    writeFileSync(join(dir, VAULT_FILE), 'basura')
    expect(new ProjectProfileStore(dir, fakeSafe()).envFor('/a')).toEqual({})
  })
})
