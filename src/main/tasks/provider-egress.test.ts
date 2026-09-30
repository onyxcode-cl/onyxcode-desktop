/**
 * `placeholderAuthContent` (falla cerrado): el servidor de Tareas con sandbox solo recibe OpenCode
 * Go con clave centinela; ningún secreto real pasa por `OPENCODE_AUTH_CONTENT`.
 */
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PROVIDER_TARGETS, placeholderAuthContent, type ProviderAuthEntry } from './provider-egress'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getAppPath: () => process.cwd(), isPackaged: false } }))

const rnd = (): string => randomBytes(24).toString('hex')
const parse = (s: string): Record<string, ProviderAuthEntry> => JSON.parse(s) as Record<string, ProviderAuthEntry>

describe('placeholderAuthContent', () => {
  it('solo OpenCode Go sale, con clave centinela', () => {
    const key = rnd()
    const out = parse(placeholderAuthContent({ 'opencode-go': { type: 'api', key } }))
    expect(Object.keys(out)).toEqual(['opencode-go'])
    expect(out['opencode-go'].type).toBe('api')
    expect(out['opencode-go'].key).toMatch(/^sandboxed-placeholder-[0-9a-f]{16}$/)
  })

  it('OpenAI, Anthropic, Google y OAuth se omiten', () => {
    const secrets = [rnd(), rnd(), rnd(), rnd(), rnd(), rnd()]
    const raw = placeholderAuthContent({
      openai: { type: 'api', key: secrets[0] },
      anthropic: { type: 'api', key: secrets[1] },
      google: { type: 'api', key: secrets[2] },
      'github-copilot': { type: 'oauth', access: secrets[3], refresh: secrets[4], expires: 1 },
      'opencode-go': { type: 'api', key: secrets[5] }
    })
    expect(Object.keys(parse(raw))).toEqual(['opencode-go'])
    for (const s of secrets) expect(raw).not.toContain(s)
  })

  it('OAuth con el id de un proveedor conocido (sin key) se omite entero', () => {
    const access = rnd()
    const raw = placeholderAuthContent({ 'opencode-go': { type: 'oauth', access, refresh: rnd() } })
    expect(raw).toBe('{}')
    expect(raw).not.toContain(access)
  })

  it('no copia campos extra de la entrada de Go', () => {
    const extra = rnd()
    const raw = placeholderAuthContent({ 'opencode-go': { type: 'api', key: rnd(), secretExtra: extra, refresh: extra } })
    expect(raw).not.toContain(extra)
    expect(Object.keys(parse(raw)['opencode-go']).sort()).toEqual(['key', 'type'])
  })

  it('sin proveedores utilizables devuelve {}', () => {
    expect(placeholderAuthContent({})).toBe('{}')
    expect(placeholderAuthContent({ openai: { type: 'api', key: rnd() } })).toBe('{}')
  })

  it('propiedad: la salida nunca contiene ninguna clave real de entrada', () => {
    const ids = ['opencode-go', 'openai', 'anthropic', 'google', 'openrouter', 'x'.repeat(5), '__proto__']
    for (let n = 0; n < 200; n++) {
      const input: Record<string, ProviderAuthEntry> = {}
      const secrets: string[] = []
      for (const id of ids) {
        if (Math.random() < 0.3) continue
        const key = rnd()
        const access = rnd()
        const refresh = rnd()
        secrets.push(key, access, refresh)
        const entry: ProviderAuthEntry =
          Math.random() < 0.5 ? { type: 'api', key } : { type: 'oauth', access, refresh, key, accountId: rnd() }
        Object.defineProperty(input, id, { value: entry, enumerable: true, configurable: true })
      }
      const raw = placeholderAuthContent(input)
      for (const s of secrets) expect(raw).not.toContain(s)
      for (const k of Object.keys(parse(raw))) expect(Object.keys(PROVIDER_TARGETS)).toContain(k)
    }
  })

  it('el centinela cambia en cada llamada y no deriva de la clave real', () => {
    const key = 'abcdef0123456789'
    const seen = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const k = parse(placeholderAuthContent({ 'opencode-go': { type: 'api', key } }))['opencode-go'].key as string
      seen.add(k)
      expect(k).not.toContain(key)
      expect(k).not.toContain(key.slice(0, 6))
    }
    expect(seen.size).toBe(20)
  })

  it('entradas malformadas no rompen ni filtran', () => {
    const s = rnd()
    const cases: unknown[] = [
      { 'opencode-go': {} },
      { 'opencode-go': { key: s } },
      { 'opencode-go': { type: 'api', key: '' } },
      { 'opencode-go': { type: 'api', key: 12345 } },
      { 'opencode-go': { type: 'api', key: { nested: s } } },
      { 'opencode-go': null },
      { 'opencode-go': 'texto-' + s },
      { openai: { key: s } },
      { openai: null }
    ]
    for (const c of cases) {
      let raw = ''
      expect(() => (raw = placeholderAuthContent(c as Record<string, ProviderAuthEntry>))).not.toThrow()
      expect(raw).not.toContain(s)
      expect(raw).not.toContain('12345')
    }
    // `key` sin `type` pero de texto: se reescribe con entrada nueva y centinela.
    const out = parse(placeholderAuthContent({ 'opencode-go': { key: s } as ProviderAuthEntry }))
    expect(out['opencode-go'].key).toMatch(/^sandboxed-placeholder-/)
  })
})

describe('sandbox.ts: el entorno del sandbox no recibe secretos reales', () => {
  const src = readFileSync(join(process.cwd(), 'src/main/tasks/sandbox.ts'), 'utf8')

  it('OPENCODE_AUTH_CONTENT solo se asigna con placeholderAuthContent(...)', () => {
    const assigns = src.match(/OPENCODE_AUTH_CONTENT\s*:[^\n]*/g) ?? []
    expect(assigns).toHaveLength(1)
    expect(assigns[0]).toContain('placeholderAuthContent(')
  })

  it('la clave real (entry.key) solo va al CredentialProxy', () => {
    const uses = src.match(/[^\n]*\b(?:entry|e)\.key\b[^\n]*/g) ?? []
    for (const l of uses) expect(l).toMatch(/!entry\.key|authorization: `Bearer \$\{entry\.key\}`/)
  })

  it('`auth` (auth.json real) solo se usa en el bucle del proxy y en placeholderAuthContent', () => {
    const lines = src.split('\n').filter((l) => /(?<![.\w])auth\b/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l))
    for (const l of lines) {
      expect(l).toMatch(
        /readProviderAuth\(\)|if \(auth\)|Object\.entries\(auth\)|\(auth \? \{ OPENCODE_AUTH_CONTENT: placeholderAuthContent\(auth\) \}|auth\.json/
      )
    }
  })

  it('extraEnv de manager.ts no incluye credenciales de proveedor', () => {
    const mgr = readFileSync(join(process.cwd(), 'src/main/tasks/manager.ts'), 'utf8')
    expect(mgr).not.toMatch(/OPENCODE_AUTH_CONTENT/)
    expect(mgr).not.toMatch(/OPENCODE_API_KEY/)
  })
})

describe('sandbox.ts: auth propio de la app (nunca el del CLI)', () => {
  const src = readFileSync(join(process.cwd(), 'src/main/tasks/sandbox.ts'), 'utf8')

  it('no lee ~/.local ni XDG_DATA_HOME y usa appAuthFile(', () => {
    expect(src).not.toContain('.local')
    expect(src).not.toContain('XDG_DATA_HOME')
    expect(src).toContain('appAuthFile(')
  })

  it('readProviderAuth falla cerrado: fichero ausente o JSON inválido → null', async () => {
    const { readProviderAuth } = await import('./sandbox')
    const dir = mkdtempSync(join(tmpdir(), 'onyx-auth-'))
    try {
      expect(readProviderAuth(join(dir, 'no-existe.json'))).toBeNull()
      const bad = join(dir, 'bad.json')
      writeFileSync(bad, '{no es json')
      expect(readProviderAuth(bad)).toBeNull()
      const ok = join(dir, 'auth.json')
      writeFileSync(ok, JSON.stringify({ 'opencode-go': { type: 'api', key: 'k' } }))
      expect(readProviderAuth(ok)).toEqual({ 'opencode-go': { type: 'api', key: 'k' } })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
