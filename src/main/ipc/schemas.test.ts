import { describe, expect, it } from 'vitest'
import { IPC_INVOKE_CHANNELS } from '@shared/ipc'
import { CODE_INVOKE_CHANNELS } from '@shared/ipc-code'
import { CHANNEL_ROLES, IPC_SCHEMAS, missingSchemas } from './schemas'

describe('contrato IPC', () => {
  it('todos los canales de invoke tienen esquema', () => {
    expect(missingSchemas()).toEqual([])
  })
})

describe('settings:set', () => {
  it('acepta checkUpdates booleano y rechaza otros tipos', () => {
    const v = IPC_SCHEMAS['settings:set']
    expect(v({ checkUpdates: false })).toEqual({ checkUpdates: false })
    expect(() => v({ checkUpdates: 'no' })).toThrow()
  })

  it('acepta language system/es/en y rechaza otros idiomas', () => {
    const v = IPC_SCHEMAS['settings:set']
    for (const language of ['system', 'es', 'en']) expect(v({ language })).toEqual({ language })
    expect(() => v({ language: 'fr' })).toThrow()
    expect(() => v({ language: 1 })).toThrow()
  })
})

describe('canales de Probar clave y Diagnóstico', () => {
  const CHANNELS = ['app:testProviderKey', 'diag:logs', 'diag:copy', 'diag:export']

  it('existen en el contrato, tienen esquema y son solo de la ventana principal', () => {
    for (const c of CHANNELS) {
      expect(IPC_INVOKE_CHANNELS as readonly string[], c).toContain(c)
      expect(IPC_SCHEMAS[c], c).toBeTypeOf('function')
      for (const [role, set] of Object.entries(CHANNEL_ROLES)) expect(set.has(c), `${c} en ${role}`).toBe(false)
    }
  })

  it('app:testProviderKey: solo el id del proveedor (nunca una clave)', () => {
    const v = IPC_SCHEMAS['app:testProviderKey']
    expect(v({ providerID: 'openai' })).toEqual({ providerID: 'openai' })
    expect(v({ providerID: 'my.provider_2-x' })).toEqual({ providerID: 'my.provider_2-x' })
    for (const bad of [
      {},
      { providerID: '' },
      { providerID: 'a b' },
      { providerID: 'a/b' },
      { providerID: 'x'.repeat(201) },
      { providerID: 'openai', key: 'sk-1' },
      { providerID: 1 }
    ]) {
      expect(() => v(bad), JSON.stringify(bad).slice(0, 40)).toThrow()
    }
  })

  it('diag:logs / diag:copy: fuente de la lista y maxLines acotado', () => {
    const logs = IPC_SCHEMAS['diag:logs']
    expect(logs({ source: 'engine' })).toEqual({ source: 'engine' })
    expect(logs({ source: 'report', maxLines: 200 })).toEqual({ source: 'report', maxLines: 200 })
    for (const bad of [
      {},
      { source: 'sandbox' },
      { source: 'engine', maxLines: 0 },
      { source: 'engine', maxLines: 5001 },
      { source: 'engine', maxLines: 1.5 },
      { source: 'engine', path: '/etc/passwd' }
    ]) {
      expect(() => logs(bad), JSON.stringify(bad)).toThrow()
    }
    expect(IPC_SCHEMAS['diag:copy']({ source: 'engine-file' })).toEqual({ source: 'engine-file' })
    expect(() => IPC_SCHEMAS['diag:copy']({ source: 'otra' })).toThrow()
    expect(IPC_SCHEMAS['diag:export'](undefined)).toBeUndefined()
    expect(() => IPC_SCHEMAS['diag:export']({ x: 1 })).toThrow()
  })
})

describe('catálogo MCP (mcp:catalog, mcp:installCatalog)', () => {
  const ok = { id: 'github', name: 'github', inputs: { token: 'ghp_x' }, enable: true, askEachUse: true }

  it('existen, tienen esquema y son solo de la ventana principal', () => {
    for (const c of ['mcp:catalog', 'mcp:installCatalog']) {
      expect(IPC_SCHEMAS[c], c).toBeTypeOf('function')
      for (const [role, set] of Object.entries(CHANNEL_ROLES)) expect(set.has(c), `${c} en ${role}`).toBe(false)
    }
  })

  it('acepta una petición válida y rechaza id, nombre, entradas o booleanos malformados', () => {
    const v = IPC_SCHEMAS['mcp:installCatalog']
    expect(v(ok)).toEqual(ok)
    expect(v({ ...ok, inputs: {} })).toBeTruthy()
    for (const id of ['', 'GitHub', 'a/b', '../x', 'x'.repeat(65)]) expect(() => v({ ...ok, id }), id).toThrow()
    for (const name of ['', 'con espacio', 'a/b', 'x'.repeat(65)]) expect(() => v({ ...ok, name }), name).toThrow()
    expect(() => v({ ...ok, inputs: { token: 'x'.repeat(4097) } })).toThrow()
    expect(() => v({ ...ok, inputs: { token: 5 } })).toThrow()
    expect(() => v({ ...ok, inputs: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 'v'])) })).toThrow()
    expect(() => v({ ...ok, inputs: JSON.parse('{"__proto__":"x"}') })).toThrow()
    expect(() => v({ ...ok, enable: 'si' })).toThrow()
    expect(() => v({ ...ok, askEachUse: undefined })).toThrow()
    expect(() => v({ id: 'github', name: 'github' })).toThrow()
  })

  it('mcp:catalog no admite parámetros', () => {
    const v = IPC_SCHEMAS['mcp:catalog']
    expect(() => v(undefined)).not.toThrow()
    expect(() => v({ x: 1 })).toThrow()
  })
})

describe('canales git:discard y git:discardUndo (R2-A)', () => {
  const cwd = '/Users/x/repo'
  const uuid = '123e4567-e89b-12d3-a456-426614174000'

  it('existen, tienen esquema y son solo de la ventana principal', () => {
    for (const c of ['git:discard', 'git:discardUndo']) {
      expect(CODE_INVOKE_CHANNELS as readonly string[], c).toContain(c)
      expect(IPC_SCHEMAS[c], c).toBeTypeOf('function')
      for (const [role, set] of Object.entries(CHANNEL_ROLES)) expect(set.has(c), `${c} en ${role}`).toBe(false)
    }
  })

  it('git:discard exige cwd absoluto y una lista acotada de rutas no vacías', () => {
    const v = IPC_SCHEMAS['git:discard']
    expect(v({ cwd, paths: ['a.txt', 'src/b.txt'] })).toEqual({ cwd, paths: ['a.txt', 'src/b.txt'] })
    expect(() => v({ cwd: 'repo', paths: ['a'] })).toThrow()
    expect(() => v({ cwd, paths: 'a.txt' })).toThrow()
    expect(() => v({ cwd, paths: [''] })).toThrow()
    expect(() => v({ cwd, paths: [5] })).toThrow()
    expect(() => v({ cwd, paths: Array.from({ length: 201 }, (_, i) => `f${i}`) })).toThrow()
    expect(() => v({ cwd })).toThrow()
  })

  it('git:discardUndo solo admite ids con forma de uuid', () => {
    const v = IPC_SCHEMAS['git:discardUndo']
    expect(v({ cwd, undoId: uuid })).toEqual({ cwd, undoId: uuid })
    for (const undoId of ['', '../../etc', 'x'.repeat(36), `${uuid}/..`]) expect(() => v({ cwd, undoId }), undoId).toThrow()
  })
})

describe('canales de archivos del proyecto y «Abrir en…»', () => {
  const CHANNELS = [
    'files:watch',
    'files:setDirs',
    'files:unwatch',
    'files:create',
    'files:rename',
    'files:trash',
    'editors:list',
    'editors:open'
  ]
  const SUB = '0123456789abcdef'
  it('existen, tienen esquema y son solo de la ventana principal', () => {
    for (const c of CHANNELS) {
      expect(CODE_INVOKE_CHANNELS).toContain(c)
      expect(IPC_SCHEMAS[c], c).toBeTypeOf('function')
      for (const role of Object.keys(CHANNEL_ROLES) as Array<keyof typeof CHANNEL_ROLES>)
        expect(CHANNEL_ROLES[role].has(c), `${c} en ${role}`).toBe(false)
    }
  })
  it('files:watch: carpeta absoluta e id de suscripción con forma', () => {
    const v = IPC_SCHEMAS['files:watch']
    expect(v({ folder: '/tmp/p', subId: SUB })).toEqual({ folder: '/tmp/p', subId: SUB })
    for (const bad of [
      { folder: 'rel', subId: SUB },
      { folder: '/tmp/p', subId: 'x' },
      { folder: '/tmp/p', subId: 'a b c d e f g h' },
      { folder: '/tmp/p' },
      { folder: '/tmp/p', subId: SUB, extra: 1 }
    ])
      expect(() => v(bad)).toThrow()
  })
  it('files:setDirs acota la lista', () => {
    const v = IPC_SCHEMAS['files:setDirs']
    expect(v({ subId: SUB, dirs: ['.', 'src'] })).toEqual({ subId: SUB, dirs: ['.', 'src'] })
    expect(() => v({ subId: SUB, dirs: Array.from({ length: 101 }, () => 'a') })).toThrow()
    expect(() => v({ subId: SUB, dirs: [1] })).toThrow()
  })
  it('files:create / rename / trash: tipos estrictos', () => {
    expect(IPC_SCHEMAS['files:create']({ cwd: '/tmp/p', parent: '.', name: 'a.txt', kind: 'file' })).toBeTruthy()
    expect(() => IPC_SCHEMAS['files:create']({ cwd: '/tmp/p', parent: '.', name: 'a', kind: 'link' })).toThrow()
    expect(() => IPC_SCHEMAS['files:create']({ cwd: '/tmp/p', parent: '.', name: '', kind: 'dir' })).toThrow()
    expect(() => IPC_SCHEMAS['files:create']({ cwd: 'rel', parent: '.', name: 'a', kind: 'dir' })).toThrow()
    expect(IPC_SCHEMAS['files:rename']({ cwd: '/tmp/p', path: 'a.txt', name: 'b.txt' })).toBeTruthy()
    expect(() => IPC_SCHEMAS['files:rename']({ cwd: '/tmp/p', path: '', name: 'b' })).toThrow()
    expect(IPC_SCHEMAS['files:trash']({ cwd: '/tmp/p', path: 'a.txt' })).toBeTruthy()
    expect(() => IPC_SCHEMAS['files:trash']({ cwd: '/tmp/p', path: 'a.txt', force: true })).toThrow()
  })
  it('editors:open solo admite ids del catálogo (nunca rutas ni comandos)', () => {
    const v = IPC_SCHEMAS['editors:open']
    expect(v({ cwd: '/tmp/p', id: 'zed' })).toEqual({ cwd: '/tmp/p', id: 'zed' })
    for (const id of ['/usr/bin/vim', 'code --new-window', 'vim', '', 'ZED']) expect(() => v({ cwd: '/tmp/p', id })).toThrow()
  })
})

describe('remote:confirmAction', () => {
  it('esquema estricto y solo para la ventana principal', () => {
    const v = IPC_SCHEMAS['remote:confirmAction']
    expect(v({ requestId: 'abc123', accept: true })).toEqual({ requestId: 'abc123', accept: true })
    expect(() => v({ requestId: 'abc123' })).toThrow()
    expect(() => v({ requestId: 'a b', accept: true })).toThrow()
    expect(() => v({ requestId: 'abc', accept: true, extra: 1 })).toThrow()
    for (const [role, set] of Object.entries(CHANNEL_ROLES)) expect(set.has('remote:confirmAction'), role).toBe(false)
  })
})

describe('remote:setDeviceTtl y remote:revokeAll', () => {
  const id = 'a'.repeat(32)
  it('solo 30, 90, 365 o null; nada extra', () => {
    const v = IPC_SCHEMAS['remote:setDeviceTtl']
    for (const days of [30, 90, 365, null]) expect(v({ deviceId: id, days })).toEqual({ deviceId: id, days })
    for (const days of [0, 7, 366, '90', undefined]) expect(() => v({ deviceId: id, days })).toThrow()
    expect(() => v({ deviceId: 'x', days: 30 })).toThrow()
    expect(() => v({ deviceId: id, days: 30, extra: 1 })).toThrow()
  })
  it('solo la ventana principal', () => {
    for (const ch of ['remote:setDeviceTtl', 'remote:revokeAll'] as const) {
      for (const [role, set] of Object.entries(CHANNEL_ROLES)) expect(set.has(ch), `${role} ${ch}`).toBe(false)
    }
  })
})

describe('extras:chatDoc:open', () => {
  const common = { title: 'T', sessionId: 's1', lang: 'es' as const, theme: 'light' as const }
  const v = IPC_SCHEMAS['extras:chatDoc:open']

  it('pdf: acepta html', () => {
    expect(() => v({ ...common, kind: 'pdf', html: '<p>x</p>' })).not.toThrow()
  })

  it('xlsx: acepta columnFormats y una celda de fórmula (el bug real que esto atrapa: faltaba declarar un campo opcional)', () => {
    expect(() =>
      v({
        ...common,
        kind: 'xlsx',
        data: { sheets: [{ name: 'A', rows: [['Monto'], [{ formula: 'SUM(A1:A1)', value: 1 }]], columnFormats: ['currency'] }] }
      })
    ).not.toThrow()
  })

  it('xlsx: rechaza un formato de columna que no exista', () => {
    expect(() => v({ ...common, kind: 'xlsx', data: { sheets: [{ name: 'A', rows: [[1]], columnFormats: ['moneda'] }] } })).toThrow()
  })

  it('pptx: acepta theme y layout por diapositiva (el mismo tipo de bug: faltaba declarar "layout")', () => {
    expect(() => v({ ...common, kind: 'pptx', data: { theme: 'dark', slides: [{ title: 'X', layout: 'section' }] } })).not.toThrow()
  })

  it('pptx: rechaza un theme o un layout que no exista', () => {
    expect(() => v({ ...common, kind: 'pptx', data: { theme: 'fucsia', slides: [{ title: 'X' }] } })).toThrow()
    expect(() => v({ ...common, kind: 'pptx', data: { slides: [{ title: 'X', layout: 'collage' }] } })).toThrow()
  })

  it('pptx: acepta layout "chart" con su gráfico (mismo tipo de bug: faltaba declarar el campo "chart")', () => {
    expect(() =>
      v({
        ...common,
        kind: 'pptx',
        data: { slides: [{ title: 'Ventas', layout: 'chart', chart: { type: 'bar', categories: ['Ene', 'Feb'], values: [10, 20] } }] }
      })
    ).not.toThrow()
  })

  it('pptx: acepta los layouts "two-col"/"cards" (sin campos extra, solo título/viñetas)', () => {
    expect(() => v({ ...common, kind: 'pptx', data: { slides: [{ title: 'X', bullets: ['a', 'b'], layout: 'two-col' }] } })).not.toThrow()
    expect(() => v({ ...common, kind: 'pptx', data: { slides: [{ title: 'X', bullets: ['a', 'b'], layout: 'cards' }] } })).not.toThrow()
  })

  it('pptx: rechaza un tipo de gráfico inventado', () => {
    expect(() =>
      v({ ...common, kind: 'pptx', data: { slides: [{ layout: 'chart', chart: { type: 'donut', categories: ['A'], values: [1] } }] } })
    ).toThrow()
  })

  it('pptx: acepta eyebrow/note por diapositiva y footer del deck (mismo tipo de bug: faltaba declarar estos campos)', () => {
    expect(() =>
      v({
        ...common,
        kind: 'pptx',
        data: { footer: 'Empresa · Q3', slides: [{ title: 'X', eyebrow: 'Informe', note: 'Cifras en miles' }] }
      })
    ).not.toThrow()
  })

  it('pptx: acepta "columns" (2 columnas con heading/bullets) en two-col', () => {
    expect(() =>
      v({
        ...common,
        kind: 'pptx',
        data: {
          slides: [
            {
              title: 'X',
              layout: 'two-col',
              columns: [
                { heading: 'Antes', bullets: ['a'] },
                { heading: 'Después', bullets: ['b'] }
              ]
            }
          ]
        }
      })
    ).not.toThrow()
  })

  it('pptx: rechaza "columns" con 1 o 3 columnas (tiene que ser exactamente 2)', () => {
    expect(() =>
      v({ ...common, kind: 'pptx', data: { slides: [{ title: 'X', layout: 'two-col', columns: [{ bullets: ['a'] }] }] } })
    ).toThrow()
    expect(() =>
      v({
        ...common,
        kind: 'pptx',
        data: { slides: [{ title: 'X', layout: 'two-col', columns: [{ bullets: ['a'] }, { bullets: ['b'] }, { bullets: ['c'] }] }] }
      })
    ).toThrow()
  })

  it('pptx: acepta "kpis" (label/value/delta por métrica, mismo tipo de bug: faltaba declarar este campo)', () => {
    expect(() =>
      v({
        ...common,
        kind: 'pptx',
        data: {
          slides: [
            {
              title: 'X',
              layout: 'kpis',
              kpis: [
                { label: 'Ventas', value: '$1M', delta: '+10%' },
                { label: 'Y', value: '2' }
              ]
            }
          ]
        }
      })
    ).not.toThrow()
  })

  it('pptx: acepta "style" (mismo tipo de bug: faltaba declarar este campo)', () => {
    expect(() =>
      v({
        ...common,
        kind: 'pptx',
        data: { style: 'editorial', slides: [{ title: 'X', layout: 'kpis', kpis: [{ label: 'A', value: '1' }] }] }
      })
    ).not.toThrow()
  })

  it('pptx: rechaza un "style" que no exista', () => {
    expect(() => v({ ...common, kind: 'pptx', data: { style: 'rococo', slides: [{ title: 'X' }] } })).toThrow()
  })

  it('rechaza un kind que no exista', () => {
    expect(() => v({ ...common, kind: 'docx', html: 'x' })).toThrow()
  })
})

describe('extras:downloadChatDoc', () => {
  const v = IPC_SCHEMAS['extras:downloadChatDoc']

  it('xlsx y pptx, con sus campos opcionales', () => {
    expect(() => v({ kind: 'xlsx', title: 'T', data: { sheets: [{ name: 'A', rows: [[1]], columnFormats: ['integer'] }] } })).not.toThrow()
    expect(() => v({ kind: 'pptx', title: 'T', data: { theme: 'warm', slides: [{ title: 'X', layout: 'closing' }] } })).not.toThrow()
  })
})

describe('extras:chatDoc:open — gráficos de Excel y libertad de diseño de PowerPoint', () => {
  const common = { title: 'T', sessionId: 's1', lang: 'es' as const, theme: 'light' as const }
  const v = IPC_SCHEMAS['extras:chatDoc:open']
  const sheet = (charts: unknown) => ({
    kind: 'xlsx',
    data: {
      sheets: [
        {
          name: 'A',
          rows: [
            ['Mes', 'V'],
            ['x', 1]
          ],
          charts
        }
      ]
    }
  })

  it('xlsx: acepta un gráfico nativo (el bug real: «Clave inesperada data.sheets[0].charts» rechazaba el documento y el panel no abría)', () => {
    expect(() =>
      v({ ...common, ...sheet([{ type: 'column', range: 'A1:C7', title: 'Ventas', at: 'F2', width: 520, height: 300 }]) } as never)
    ).not.toThrow()
    expect(() => v({ ...common, ...sheet([{ type: 'pie', range: 'A1:B7' }]) } as never)).not.toThrow()
  })

  it.each([
    [{ type: 'radar', range: 'A1:C7' }],
    [{ type: 'column', range: 'A1' }],
    [{ type: 'column', range: 'A1:C7,E1:E7' }],
    [{ type: 'column', range: 'A1:C7', at: 'F2:G3' }],
    [{ type: 'column', range: 'A1:C7', width: 5 }],
    [{ type: 'column', range: 'A1:C7', macro: 'x' }]
  ])('xlsx: rechaza un gráfico inválido (%#)', (chart) => {
    expect(() => v({ ...common, ...sheet([chart]) } as never)).toThrow()
  })

  it('pptx: acepta paleta propia, fuentes, fondo por diapositiva y lienzo libre', () => {
    expect(() =>
      v({
        ...common,
        kind: 'pptx',
        data: {
          palette: { bg: '#0E2A2F', text: '#F4F1EA', accent: '#F2B544', accent2: '#7FD1B9' },
          fonts: { title: 'Georgia', body: 'Arial' },
          slides: [
            { title: 'X', background: '#F2B544' },
            {
              layout: 'free',
              elements: [
                {
                  type: 'text',
                  x: 84,
                  y: 110,
                  w: 600,
                  h: 180,
                  text: 'Hola',
                  size: 58,
                  bold: true,
                  color: '#FFFFFF',
                  font: 'Georgia',
                  align: 'left',
                  spacing: -2
                },
                {
                  type: 'shape',
                  shape: 'ellipse',
                  x: 560,
                  y: -120,
                  w: 560,
                  h: 560,
                  fill: '#F2B544',
                  fillTo: '#E07A5F',
                  angle: 45,
                  opacity: 0.9,
                  rotate: 15,
                  text: 'ok'
                }
              ]
            }
          ]
        }
      } as never)
    ).not.toThrow()
  })

  it.each([
    ['color sin #', { palette: { bg: '0E2A2F', text: '#FFFFFF', accent: '#000000' }, slides: [{ title: 'x' }] }],
    ['color con script', { palette: { bg: '#0E2A2F', text: '#FFFFFF', accent: 'red;rm -rf' }, slides: [{ title: 'x' }] }],
    ['fuente fuera de la lista', { fonts: { title: 'Comic Sans MS' }, slides: [{ title: 'x' }] }],
    ['forma desconocida', { slides: [{ layout: 'free', elements: [{ type: 'shape', shape: 'bomba', x: 0, y: 0, w: 1, h: 1 }] }] }],
    ['tipo de elemento desconocido', { slides: [{ layout: 'free', elements: [{ type: 'image', x: 0, y: 0, w: 1, h: 1 }] }] }],
    ['posición absurda', { slides: [{ layout: 'free', elements: [{ type: 'text', x: 99999, y: 0, w: 10, h: 10, text: 'a' }] }] }],
    ['fondo inválido', { slides: [{ title: 'x', background: 'url(x)' }] }]
  ])('pptx: rechaza %s', (_n, data) => {
    expect(() => v({ ...common, kind: 'pptx', data } as never)).toThrow()
  })
})
