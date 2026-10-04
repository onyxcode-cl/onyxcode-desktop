// Datos SINTÉTICOS (nada real) que el FakeLink devuelve a la interfaz móvil: ajustes, motor OpenCode (sesiones, mensajes,
// permisos, proveedores) y los canales IPC que la pantalla necesita. Todo es inventado; las rutas son de un usuario ficticio.
import type { FakeLink } from '../../src/renderer/remote/fake-link'

const CHAT_DIR = '/Users/demo/.onyxcode/chat-workspace'
const PROJECT = '/Users/demo/proyectos/tienda-web'
const NOW = Date.UTC(2026, 9, 4, 15, 30, 0)
const MIN = 60_000

type Json = Record<string, unknown>

const MD_PLAN = `Claro. Te dejo un **plan de migración** en tres fases y un ejemplo para empezar.

## Fases

1. **Inventario**: listar las tablas y sus dependencias.
2. **Migración**: mover los datos con \`pg_dump\` y validar los conteos.
3. **Corte**: cambiar la cadena de conexión y vigilar los errores 24 horas.

> Haz siempre un respaldo antes del corte. Es lo único que no se puede improvisar.

### Comparativa rápida

| Opción | Tiempo | Riesgo | Costo |
| --- | --- | --- | --- |
| Volcado completo | 2 h | Bajo | Bajo |
| Réplica lógica | 1 día | Medio | Medio |
| Doble escritura | 1 semana | Alto | Alto |

Para el volcado, este script comprueba que los conteos coinciden:

\`\`\`ts
import { Client } from 'pg'

export async function compararConteos(origen: string, destino: string): Promise<boolean> {
  const a = new Client({ connectionString: origen })
  const b = new Client({ connectionString: destino })
  await Promise.all([a.connect(), b.connect()])
  const sql = 'select count(*)::int as n from pedidos'
  const [x, y] = await Promise.all([a.query(sql), b.query(sql)])
  await Promise.all([a.end(), b.end()])
  return x.rows[0].n === y.rows[0].n
}
\`\`\`

Si quieres, lo adapto a tu esquema. Dime cuántas tablas tienes y si hay vistas materializadas.`

const MD_LONG_A = `Buena pregunta. Hay tres causas habituales de que una consulta tarde mucho:

- Falta un índice en la columna del \`WHERE\`.
- El plan usa un recorrido secuencial porque las estadísticas están viejas.
- La consulta trae más columnas de las necesarias.

Primero revisa el plan con \`EXPLAIN (ANALYZE, BUFFERS)\` y busca el nodo que más tiempo consume.`

const MD_LONG_B = `Aquí tienes un ejemplo de índice parcial y la consulta que lo aprovecha:

\`\`\`sql
create index concurrently idx_pedidos_pendientes
  on pedidos (creado_en desc)
  where estado = 'pendiente';

select id, cliente_id, total
from pedidos
where estado = 'pendiente'
order by creado_en desc
limit 50;
\`\`\`

Con \`concurrently\` no se bloquean las escrituras, pero tarda más y no puede ir dentro de una transacción.`

const MD_LONG_C = `Resumen de lo que medimos antes y después:

| Consulta | Antes | Después | Mejora |
| --- | --- | --- | --- |
| Pendientes (50) | 1840 ms | 12 ms | 99 % |
| Ventas por día | 920 ms | 140 ms | 85 % |
| Búsqueda por cliente | 310 ms | 9 ms | 97 % |

**Conclusión:** el índice parcial resolvió el caso principal. La consulta de ventas por día conviene moverla a una vista materializada que se refresque cada hora.`

const MD_CODE_REPLY = `Revisé el carrito y encontré el problema: \`calcularTotal\` suma el descuento dos veces cuando el cupón es porcentual.

Ya preparé el arreglo y una prueba que lo cubre. Necesito permiso para editar \`src/carrito/total.ts\`.`

let seq = 0
const mid = (): string => `msg_${String(++seq).padStart(4, '0')}`
const pid = (): string => `prt_${String(++seq).padStart(4, '0')}`

interface Entry {
  info: Json
  parts: Json[]
}

function user(session: string, text: string, at: number): Entry {
  const id = mid()
  return {
    info: { id, sessionID: session, role: 'user', time: { created: at }, agent: 'build', model: { providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash' } },
    parts: [{ id: pid(), sessionID: session, messageID: id, type: 'text', text }]
  }
}

function assistant(session: string, parent: string, at: number, parts: Array<(m: string) => Json>, agent = 'build'): Entry {
  const id = mid()
  return {
    info: {
      id, sessionID: session, role: 'assistant', parentID: parent, time: { created: at, completed: at + 8_000 },
      modelID: 'deepseek-v4.1-flash', providerID: 'opencode-go', mode: agent, agent, path: { cwd: PROJECT, root: PROJECT },
      cost: 0.0012, tokens: { input: 1800, output: 420, reasoning: 0, cache: { read: 0, write: 0 } }, finish: 'stop'
    },
    parts: parts.map((f) => f(id))
  }
}

const text = (s: string, body: string) => (m: string): Json => ({ id: pid(), sessionID: s, messageID: m, type: 'text', text: body })

const tool =
  (s: string, name: string, title: string, input: Json, output: string, status: 'completed' | 'running' = 'completed') =>
  (m: string): Json => ({
    id: pid(), sessionID: s, messageID: m, type: 'tool', callID: `call_${seq}`, tool: name,
    state:
      status === 'completed'
        ? { status, input, output, title, metadata: {}, time: { start: NOW - 20_000, end: NOW - 18_000 } }
        : { status, input, title, metadata: {}, time: { start: NOW - 2_000 } }
  })

function session(id: string, title: string, directory: string, ageMin: number, extra: Json = {}): Json {
  return {
    id, slug: id, projectID: 'proj_demo', directory, title, version: '1.0.0',
    time: { created: NOW - (ageMin + 5) * MIN, updated: NOW - ageMin * MIN }, ...extra
  }
}

const S = {
  plan: 'ses_plan001',
  largo: 'ses_largo002',
  c1: 'ses_code001',
  c2: 'ses_code002',
  c3: 'ses_code003'
}

function buildMessages(): Record<string, Entry[]> {
  const out: Record<string, Entry[]> = {}
  const u1 = user(S.plan, 'Necesito migrar mi base de datos de Postgres a otro servidor. ¿Cómo lo planeo sin perder datos?', NOW - 9 * MIN)
  out[S.plan] = [
    u1,
    assistant(S.plan, u1.info.id as string, NOW - 9 * MIN + 5_000, [
      tool(S.plan, 'websearch', 'Buscar: migrar postgres sin downtime', { query: 'migrar postgres sin downtime' }, '5 resultados'),
      text(S.plan, MD_PLAN)
    ], 'chat')
  ]
  const longQs = [
    ['Tengo una consulta que tarda casi 2 segundos. ¿Por qué?', MD_LONG_A],
    ['¿Me das un ejemplo de índice parcial?', MD_LONG_B],
    ['¿Y si la tabla tiene 40 millones de filas?', 'Con 40 millones de filas el índice parcial **sigue siendo buena idea** porque solo indexa lo pendiente (normalmente un porcentaje pequeño).\n\nLo que cambia es el mantenimiento: programa un `VACUUM` regular y vigila el tamaño del índice con `pg_relation_size`.'],
    ['¿Cómo mido la mejora antes y después?', 'Ejecuta cada consulta cinco veces y quédate con la mediana; la primera suele estar fría. Usa `EXPLAIN (ANALYZE, BUFFERS)` para ver también las lecturas de disco.'],
    ['Listo, ya medí. Te paso los números.', MD_LONG_C],
    ['Perfecto. ¿Algún riesgo al dejarlo en producción?', 'Dos, ambos menores:\n\n1. El índice ocupa espacio extra (unos 30 MB en tu caso).\n2. Cada `UPDATE` que cambie `estado` toca el índice, así que las escrituras cuestan un poco más.\n\nSi las escrituras son muy frecuentes, mídelo antes con una copia de la base.']
  ] as const
  out[S.largo] = []
  let t0 = NOW - 6 * 60 * MIN
  for (const [q, a] of longQs) {
    const u = user(S.largo, q, t0)
    out[S.largo].push(u, assistant(S.largo, u.info.id as string, t0 + 4_000, [text(S.largo, a)], 'chat'))
    t0 += 40 * MIN
  }
  const cu = user(S.c1, 'El total del carrito se calcula mal cuando uso un cupón del 10 %. Revísalo y arréglalo.', NOW - 3 * MIN)
  out[S.c1] = [
    cu,
    assistant(S.c1, cu.info.id as string, NOW - 3 * MIN + 3_000, [
      tool(S.c1, 'read', 'src/carrito/total.ts', { filePath: `${PROJECT}/src/carrito/total.ts` }, 'export function calcularTotal(items, cupon) { ... }'),
      tool(S.c1, 'bash', 'npm test -- total', { command: 'npm test -- total', description: 'Ejecutar las pruebas del total' }, 'FAIL src/carrito/total.test.ts\n  × aplica el cupón porcentual una sola vez'),
      text(S.c1, MD_CODE_REPLY),
      tool(S.c1, 'edit', 'src/carrito/total.ts', { filePath: `${PROJECT}/src/carrito/total.ts` }, '', 'running')
    ])
  ]
  const c2u = user(S.c2, 'Agrega validación del correo en el formulario de registro.', NOW - 120 * MIN)
  out[S.c2] = [c2u, assistant(S.c2, c2u.info.id as string, NOW - 119 * MIN, [text(S.c2, 'Listo. Agregué `validarCorreo` y mostré el error bajo el campo.')])]
  out[S.c3] = []
  return out
}

function buildProviders(): Json {
  const model = (id: string, name: string): Json => ({
    id, providerID: 'opencode-go', api: { id, url: 'https://example.invalid', npm: '@ai-sdk/openai-compatible' }, name, family: 'demo',
    capabilities: { temperature: true, reasoning: false, attachment: true, toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true }, output: { text: true, audio: false, image: false, video: false, pdf: false }, interleaved: false },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } }, limit: { context: 128000, output: 8192 }, status: 'active', options: {}, headers: {}, release_date: '2026-01-01'
  })
  return {
    providers: [
      { id: 'opencode-go', name: 'OpenCode Go', source: 'api', env: [], options: {},
        models: { 'deepseek-v4.1-flash': model('deepseek-v4.1-flash', 'DeepSeek V4.1 Flash'), 'qwen-3.5-coder': model('qwen-3.5-coder', 'Qwen 3.5 Coder') } }
    ],
    default: { 'opencode-go': 'deepseek-v4.1-flash' }
  }
}

export interface Fx {
  theme: 'dark' | 'light'
}

export function attachFixtures(link: FakeLink, scenario: string): void {
  const q = new URLSearchParams(location.search)
  const theme = q.get('theme') === 'light' ? 'light' : 'dark'
  const messages = buildMessages()
  const chatSessions = [
    session(S.plan, 'Plan de migración de Postgres', CHAT_DIR, 9),
    session(S.largo, 'Optimizar consultas lentas', CHAT_DIR, 25),
    session('ses_chat003', 'Receta de pan de masa madre', CHAT_DIR, 60 * 5),
    session('ses_chat004', 'Correo para el proveedor de embalajes', CHAT_DIR, 60 * 26),
    session('ses_chat005', 'Ideas de nombre para la tienda', CHAT_DIR, 60 * 24 * 3),
    session('ses_chat006', 'Resumen del artículo sobre RAG', CHAT_DIR, 60 * 24 * 9)
  ]
  const codeSessions = [
    session(S.c1, 'Arreglar total del carrito con cupón', PROJECT, 3, { summary: { additions: 14, deletions: 6, files: 2 } }),
    session(S.c2, 'Validación del correo en el registro', PROJECT, 120, { summary: { additions: 38, deletions: 2, files: 3 } }),
    session(S.c3, 'Páginas de error 404 y 500', PROJECT, 60 * 24 * 2)
  ]
  const permiso = scenario === 'permiso'
  const settings = {
    defaultModel: { providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash' }, theme,
    recentFolders: [PROJECT, '/Users/demo/proyectos/blog', '/Users/demo/proyectos/api-pagos'],
    tasksGlobalInstructions: '', onboarded: true, routinesTermsAcknowledged: true, language: 'es', opencodeBin: '', checkUpdates: true
  }
  const unknown = new Set<string>()
  const note = (k: string): void => {
    if (!unknown.has(k)) unknown.add(k)
    ;(globalThis as { __unknown?: string[] }).__unknown = [...unknown]
  }

  link.onCall = (ch, p) => {
    const arg = (p ?? {}) as Json
    switch (ch) {
      case 'settings:get':
        return Promise.resolve(settings)
      case 'settings:set':
        return Promise.resolve({ ...settings, ...arg })
      case 'settings:addRecentFolder':
        return Promise.resolve(settings)
      case 'app:opencodeInfo':
        return Promise.resolve({ found: true, path: '/Mac/opencode', source: 'bundled', version: '1.0.0', sdkVersion: '1.0.0', compatible: true })
      case 'app:bootConfirm':
        return Promise.resolve(undefined)
      case 'opencode:status':
        return Promise.resolve({ state: 'ready', restarts: 0, version: '1.0.0' })
      case 'opencode:connection':
        return Promise.resolve({ baseUrl: 'onyx://engine/main', authorization: '', username: 'demo', chatDirectory: CHAT_DIR, version: '1.0.0' })
      case 'extras:getPrefs':
        return Promise.resolve({
          prefs: { quickEntryShortcut: 'Alt+Space', modelsByMode: {}, showTray: true, notificationsEnabled: true, soundEnabled: true, lastEditor: '', keybindings: {} },
          shortcutError: null
        })
      case 'extras:takePendingPrompt':
        return Promise.resolve(null)
      default:
        note('call ' + ch)
        return Promise.resolve(undefined)
    }
  }

  link.onHttp = (req) => {
    const ok = (body: unknown): Promise<unknown> => Promise.resolve({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    const dir = req.query?.directory
    const m = /^\/session\/([^/]+)\/message$/.exec(req.path)
    if (req.method === 'GET') {
      if (req.path === '/session') return ok(dir === PROJECT ? codeSessions : dir === CHAT_DIR ? chatSessions : [])
      if (m) return ok(messages[m[1] as string] ?? [])
      if (req.path === '/session/status') return ok({})
      if (req.path === '/config/providers') return ok(buildProviders())
      if (req.path === '/permission') {
        return ok(
          permiso && dir === PROJECT
            ? [{ id: 'per_demo001', sessionID: S.c1, permission: 'edit', patterns: ['src/carrito/total.ts'], metadata: { filepath: 'src/carrito/total.ts' }, always: ['src/carrito/*'], tool: { messageID: 'msg_x', callID: 'call_x' } }]
            : []
        )
      }
      if (req.path === '/question') return ok([])
    }
    note(`http ${req.method} ${req.path}`)
    return ok([])
  }
}
