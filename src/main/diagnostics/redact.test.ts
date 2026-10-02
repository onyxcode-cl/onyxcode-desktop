import { describe, expect, it } from 'vitest'
import { MAX_LINE_CHARS, collectMcpSecrets, collectStringValues, makeRedactor } from './redact'

const redact = makeRedactor({ exact: [], home: '/Users/ana' })

describe('patrones', () => {
  // [línea, parte secreta que no puede sobrevivir]
  const secrets: Record<string, [string, string]> = {
    bearer: ['Authorization: Bearer abcDEF123456xyz', 'abcDEF123456xyz'],
    basic: ['proxy Basic dXN1YXJpbzpjbGF2ZTEyMzQ1', 'dXN1YXJpbzpjbGF2ZTEyMzQ1'],
    sk: ['clave sk-proj-AbCdEf1234567890', 'AbCdEf1234567890'],
    skAnt: ['clave sk-ant-api03-AbCdEf1234567890', 'AbCdEf1234567890'],
    google: ['k=AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'],
    ghp: ['token ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'abcdefghijklmnopqrstuvwxyz0123456789'],
    ghPat: ['github_pat_11ABCDEFG0abcdefghijklmnop_qrstuvwxyz0123456789', 'qrstuvwxyz0123456789'],
    xox: ['slack xoxb-1234567890-abcdefghijkl', 'abcdefghijkl'],
    glpat: ['gl glpat-abcdefghij0123456789', 'abcdefghij0123456789'],
    akia: ['aws AKIAIOSFODNN7EXAMPLE', 'IOSFODNN7EXAMPLE'],
    jwt: ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r', 'dBjftJeZ4CVPmB92K27uhbUJU1p1r'],
    kv1: ['api_key=Zm9vYmFyMTIz', 'Zm9vYmFyMTIz'],
    kv2: ['password: hunter2hunter2', 'hunter2hunter2'],
    kv3: ['"x-api-key": "abc123xyz"', 'abc123xyz'],
    kv4: ['TOKEN = tok_12345', 'tok_12345'],
    param: ['GET https://x.example/v1?foo=1&key=SECRETVALUE99&b=2', 'SECRETVALUE99'],
    param2: ['https://x.example/?access_token=SECRETVALUE99', 'SECRETVALUE99'],
    urlCred: ['https://usuario:contrasenaSecreta@host.example/path', 'contrasenaSecreta'],
    hex: ['id 0123456789abcdef0123456789abcdef0123456789abcdef', '0123456789abcdef0123'],
    b64: ['blob QWxhZGRpbjpvcGVuIHNlc2FtZUFsYWRkaW46b3BlbiBzZXNhbWU', 'QWxhZGRpbjpvcGVuIHNlc2FtZQ']
  }
  for (const [name, [line, secret]] of Object.entries(secrets)) {
    it(`oculta ${name}`, () => {
      const out = redact(line)
      expect(out).toContain('…')
      expect(out).not.toContain(secret)
    })
  }

  it('respeta texto normal', () => {
    const normal = 'listening on 127.0.0.1:4096 session ses_abc123 model fake-model keyboard_shortcuts_enabled=true'
    expect(redact(normal)).toBe(normal)
    expect(redact('uuid 123e4567-e89b-12d3-a456-426614174000 ok')).toContain('123e4567-e89b-12d3-a456-426614174000')
    expect(redact('una-palabra-muy-larga-solo-con-letras-y-guiones-sin-numeros')).toContain('una-palabra-muy-larga')
  })

  it('home → ~ y recorta a 4000', () => {
    expect(redact('abrió /Users/ana/Documents/x.txt')).toBe('abrió ~/Documents/x.txt')
    const out = redact('a'.repeat(10_000))
    expect(out.length).toBeLessThan(MAX_LINE_CHARS + 10)
    expect(out.endsWith('[…]')).toBe(true)
  })
})

describe('secretos exactos', () => {
  it('los oculta (más largo primero) aunque no tengan forma de clave', () => {
    const r = makeRedactor({ exact: ['hunter2xyz', 'hunter2xyz-extendida', 'abc'], home: '' })
    expect(r('p=hunter2xyz-extendida y hunter2xyz')).toBe('p=… y …')
    // Menos de 6 caracteres: se ignora (rompería palabras comunes).
    expect(r('abc abc')).toBe('abc abc')
  })

  it('«Bearer xyz» exacto también oculta la credencial suelta', () => {
    const r = makeRedactor({ exact: ['Bearer mi-token-raro'], home: '' })
    expect(r('envié mi-token-raro al servidor')).toBe('envié … al servidor')
  })

  it('collectStringValues toma toda cadena de auth.json salvo `type`', () => {
    const v = collectStringValues({
      openai: { type: 'api', key: 'k1-secreto' },
      anth: { type: 'oauth', access: 'acc-1', refresh: 'ref-1', expires: 5 }
    })
    expect(v.sort()).toEqual(['acc-1', 'k1-secreto', 'ref-1'])
  })

  it('collectMcpSecrets toma headers y environment', () => {
    const v = collectMcpSecrets({
      mcp: {
        a: { type: 'remote', url: 'https://x', headers: { Authorization: 'Bearer zzz-123456' } },
        b: { type: 'local', command: ['x'], environment: { TOKEN: 'envsecret1' } },
        c: { type: 'local', command: ['y'] }
      }
    })
    expect(v.sort()).toEqual(['Bearer zzz-123456', 'envsecret1'])
    expect(collectMcpSecrets(null)).toEqual([])
  })
})

describe('propiedades', () => {
  const rnd = (n: number): string =>
    Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')

  it('secretos aleatorios incrustados en logfmt/JSON/URL no sobreviven', () => {
    for (let i = 0; i < 100; i++) {
      const s = `${rnd(3)}Zq${rnd(14)}`
      const r = makeRedactor({ exact: [s], home: '' })
      for (const line of [
        `level=info msg="llamada" key=${s} t=1`,
        JSON.stringify({ a: 1, v: s }),
        `GET /x/${s}/y 200`,
        `${s}${s}`,
        `x ${s}\n`
      ])
        expect(r(line), line).not.toContain(s)
    }
  })

  it('claves con formato conocido y aleatorias no sobreviven', () => {
    for (let i = 0; i < 100; i++) {
      const body = rnd(30)
      for (const secret of [`sk-${body}`, `sk-ant-${body}`, `AIza${body}`, `ghp_${body}`, `xoxb-${body}`]) {
        const out = redact(`antes ${secret} después`)
        expect(out, secret).not.toContain(body.slice(5))
      }
    }
  })

  it('una línea de 1 MB se redacta en menos de 200 ms (sin ReDoS)', () => {
    const adversarial = [
      'a'.repeat(1_000_000),
      'Bearer '.repeat(140_000),
      'token='.repeat(160_000),
      'sk-'.repeat(330_000),
      '-'.repeat(1_000_000),
      'api_key = '.repeat(100_000),
      `${'0123456789abcdef'.repeat(62_000)}`,
      'https://a:'.repeat(100_000),
      'eyJ'.repeat(330_000),
      '?key=&'.repeat(160_000)
    ]
    for (const line of adversarial) {
      const t0 = performance.now()
      redact(line)
      const ms = performance.now() - t0
      expect(ms, line.slice(0, 20)).toBeLessThan(200)
    }
  })
})

describe('carpeta del usuario en Windows (privacidad)', () => {
  const win = makeRedactor({ exact: [], home: 'C:\\Users\\Bentec' })
  const variants = [
    'C:\\Users\\Bentec\\repo\\a.ts',
    'C:/Users/Bentec/repo/a.ts',
    'C:\\\\Users\\\\Bentec\\\\repo\\\\a.ts', // escapada dentro de un JSON
    'c:\\users\\BENTEC\\repo', // otra capitalización
    'file:///C:/Users/Bentec/repo',
    'file:///c:/Users/Bentec/repo',
    'C%3A%5CUsers%5CBentec%5Crepo',
    'C:%5CUsers%5CBentec',
    '/c/Users/Bentec/repo', // Git Bash
    '/mnt/c/Users/Bentec/repo', // WSL
    'C:\\Users\\Bentec', // sola
    'C:\\Users\\Bentec\\',
    'C:\\Users/Bentec\\mixto'
  ]
  it.each(variants)('no deja el usuario: %s', (v) => {
    const out = win(`error en ${v} y fin`)
    expect(out).not.toMatch(/bentec/i)
    expect(out).toContain('~')
  })
  it('también dentro de JSON y comillas', () => {
    const out = win(JSON.stringify({ cwd: 'C:\\Users\\Bentec\\AppData\\Roaming\\OnyxCode', p: 'C:/Users/Bentec/x' }))
    expect(out).not.toMatch(/bentec/i)
    expect(JSON.parse(out).cwd).toBe('~\\AppData\\Roaming\\OnyxCode')
  })
  it('un nombre más largo no deja un resto del usuario', () => {
    const out = win('C:\\Users\\Bentec2\\x y C:\\Users\\Bentec.old\\y')
    expect(out).not.toMatch(/bentec/i)
  })
  it('nombre con espacios', () => {
    const w = makeRedactor({ exact: [], home: 'C:\\Users\\Ana Perez' })
    expect(w('abrir C:\\Users\\Ana Perez\\Docs y C:/users/ana perez/x')).toBe('abrir ~\\Docs y ~/x')
  })
  it('carpeta fuera de C:\\Users y unidad D:', () => {
    const w = makeRedactor({ exact: [], home: 'D:\\perfiles\\bob' })
    expect(w('D:\\perfiles\\bob\\x d:/Perfiles/Bob/y')).toBe('~\\x ~/y')
  })
  it('UNC', () => {
    const w = makeRedactor({ exact: [], home: '\\\\srv\\home\\bob' })
    expect(w('\\\\srv\\home\\bob\\x y //srv/home/bob/z')).not.toMatch(/bob/)
  })
  it('perfiles ajenos de Windows también se ocultan, aunque el home sea de otro estilo', () => {
    const mac = makeRedactor({ exact: [], home: '/Users/ana' })
    const out = mac('log C:\\Users\\Otro\\AppData y D:/Users/Maria/x y /Users/ana/ok')
    expect(out).not.toMatch(/otro|maria|ana/i)
  })
  it('no toca rutas que no son perfiles ni el resto de la línea', () => {
    expect(win('C:\\Windows\\System32 y C:\\onyx\\wt')).toBe('C:\\Windows\\System32 y C:\\onyx\\wt')
  })
  it('home de macOS sigue funcionando igual', () => {
    expect(makeRedactor({ exact: [], home: '/Users/ana/' })('/Users/ana/x')).toBe('~/x')
  })
  it('sigue siendo lineal con entradas largas y patológicas', () => {
    const evil = 'C:' + '\\'.repeat(50000) + 'Users' + '/'.repeat(50000)
    const t0 = Date.now()
    win(evil)
    expect(Date.now() - t0).toBeLessThan(1500)
  })
})
