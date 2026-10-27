// Comprobaciones del motor REAL para la Ola 7 (motor lazunox.13). Sin modelo ni red: proveedor falso del arnés (`harness.mjs`).
// Escrito por la sesión de armado del candidato lazunox.13 (no está en el repositorio de la app: viene en /tmp/motor-13/probe).
//   PROBE_ONLY=o7-edicion      7.8  edición segura: no UTF-8 se rechaza, CRLF por región, U+FFFD en write.
//   PROBE_ONLY=o7-reparar      7.13 reparación de la entrada (número y arreglo mal tipados).
//   PROBE_ONLY=o7-sanitizar    7.5  sanitizador de secretos (lo guardado; lo que ve el modelo con LAZUNOX_SANITIZAR_MODELO=1; interruptor).
//   PROBE_ONLY=o7-politicas    7.20 políticas duras (deny de herramientas, archivo roto falla cerrado, archivo ausente = sin política).
//   PROBE_ONLY=o7-ahorro       7.2  ahorro de tokens (herramientas y prompt más cortos; LAZUNOX_AHORRO_TOKENS=0 los restablece).
//   PROBE_ONLY=o7-rutas        7.22 /permission/siempre (listar, borrar uno, borrar todos) y 7.18 /session/:id/uso.
//   PROBE_ONLY=o7-imports      7.9  @imports en AGENTS.md (dentro del proyecto sí; archivo sensible y fuera del proyecto, no).
//   PROBE_ONLY=o7-paralelo     7.3  paralelismo seguro: una lectura pedida tras una edición en el mismo paso ve la edición.
//   PROBE_ONLY=o7-cortada      7.4  respuesta cortada por el límite de salida: aviso y otro turno; LAZUNOX_SALIDA_CORTADA=0 lo apaga.
//   PROBE_ONLY=o7-cuaderno     7.15 cuaderno_editar: solo se ofrece con .ipynb; reemplaza una celda sin tocar las demás.
//   PROBE_ONLY=o7-aislado      regla de pruebas: GET /mcp sin conectores ajenos.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const exige = (cond, msg, extra) => {
  if (!cond) throw new Error(extra === undefined ? msg : `${msg} → ${typeof extra === 'string' ? extra : JSON.stringify(extra).slice(0, 1800)}`)
}
const J = async (r) => {
  const texto = await r.text()
  let body = texto
  try {
    body = JSON.parse(texto)
  } catch {
    /* texto */
  }
  return { status: r.status, body }
}
const str = (c) => (typeof c === 'string' ? c : JSON.stringify(c))

export const FAMILIAS = ['o7-edicion', 'o7-reparar', 'o7-sanitizar', 'o7-politicas', 'o7-ahorro', 'o7-rutas', 'o7-imports', 'o7-paralelo', 'o7-cortada', 'o7-cuaderno', 'o7-aislado']

export function registrarOla7({ bin, checkRun: registrar, runEngine }) {
  const checkRun = (name, run, gate) => registrar(name, run, FAMILIAS.find((f) => name.startsWith(f + ':')), gate)
  const conRaiz = async (fn) => {
    const root = mkdtempSync(join(tmpdir(), 'lz-ola7-'))
    try {
      return await fn(root, join(root, 'proj'))
    } finally {
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
      } catch {
        /* temporal */
      }
    }
  }
  const motor = async (sc) => {
    const r = await runEngine(bin, sc)
    if (r.error) throw new Error(`el escenario falló: ${r.error}${r.log ? '\n' + r.log : ''}`)
    return r
  }
  /** Texto del sistema de la primera petición DE TRABAJO (la primera petición del arnés es la del título). */
  const sistemaDe = (r) => {
    const b = (r.bodies ?? []).find((x) => (x.tools ?? []).length > 0)
    return (b?.messages ?? []).filter((m) => m.role === 'system').map((m) => str(m.content)).join('\n---\n')
  }
  const unaVez = (llamada) => ({ decide: ({ toolTexts, tools }) => (tools.length && !toolTexts.length ? llamada : null) })

  // ═══ 7.8 edición segura ═══════════════════════════════════════════════════════════════════════════════════════
  checkRun('o7-edicion: edit sobre un archivo latin-1 (no UTF-8) se rechaza y el archivo no cambia', () =>
    conRaiz(async (root, proj) => {
      mkdirSync(proj, { recursive: true })
      const bytes = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a, 0x6f, 0x6b, 0x0a]) // «café\nok\n» en latin-1
      writeFileSync(join(proj, 'l1.txt'), bytes)
      const r = await motor({ root, git: true, reply: 'once', ...unaVez({ name: 'edit', args: { filePath: join(proj, 'l1.txt'), oldString: 'ok', newString: 'OK' } }) })
      exige(r.toolParts[0]?.status === 'error', 'edit no rechazó el archivo no UTF-8', r.toolParts)
      exige(Buffer.compare(readFileSync(join(proj, 'l1.txt')), bytes) === 0, 'el archivo cambió a pesar del rechazo')
      return true
    })
  )
  checkRun('o7-edicion: edit en un archivo CRLF conserva CRLF en las líneas tocadas y en las no tocadas', () =>
    conRaiz(async (root, proj) => {
      const r = await motor({
        root,
        git: true,
        reply: 'once',
        projectFiles: { 'w.txt': 'uno\r\ndos\r\ntres\r\n' },
        ...unaVez({ name: 'edit', args: { filePath: join(proj, 'w.txt'), oldString: 'dos', newString: 'DOS\nDOS-bis' } })
      })
      exige(r.toolParts[0]?.status === 'completed', 'edit no se completó', r.toolParts)
      const t = readFileSync(join(proj, 'w.txt'), 'utf8')
      exige(t === 'uno\r\nDOS\r\nDOS-bis\r\ntres\r\n', 'los finales de línea no se conservaron', JSON.stringify(t))
      return true
    })
  )
  checkRun('o7-edicion: write con U+FFFD que el archivo no tenía se rechaza', () =>
    conRaiz(async (root, proj) => {
      const r = await motor({ root, git: true, reply: 'once', projectFiles: { 'w.txt': 'hola\n' }, ...unaVez({ name: 'write', args: { filePath: join(proj, 'w.txt'), content: 'ho�la\n' } }) })
      exige(r.toolParts[0]?.status === 'error', 'write aceptó contenido con U+FFFD', r.toolParts)
      exige(readFileSync(join(proj, 'w.txt'), 'utf8') === 'hola\n', 'el archivo cambió')
      return true
    })
  )

  // ═══ 7.13 reparar entrada ═════════════════════════════════════════════════════════════════════════════════════
  checkRun('o7-reparar: read con offset y limit como TEXTO ("2", "1") se repara y se ejecuta', () =>
    conRaiz(async (root, proj) => {
      const r = await motor({ root, git: true, reply: 'once', projectFiles: { 'a.txt': 'L1\nL2\nL3\n' }, ...unaVez({ name: 'read', args: { filePath: join(proj, 'a.txt'), offset: '2', limit: '1' } }) })
      exige(r.toolParts[0]?.status === 'completed', 'read con números como texto no se ejecutó', r.toolParts)
      exige(/L2/.test(r.toolParts[0].output) && !/L3/.test(r.toolParts[0].output), 'la lectura no respetó offset/limit reparados', r.toolParts[0].output)
      return true
    })
  )
  checkRun('o7-reparar: con LAZUNOX_REPARAR_ENTRADA=0 la misma llamada ya no se repara (el interruptor funciona)', () =>
    conRaiz(async (root, proj) => {
      const r = await motor({ root, git: true, reply: 'once', env: { LAZUNOX_REPARAR_ENTRADA: '0' }, projectFiles: { 'a.txt': 'L1\nL2\nL3\n' }, ...unaVez({ name: 'read', args: { filePath: join(proj, 'a.txt'), offset: '2', limit: '1' } }) })
      exige(r.toolParts[0]?.status === 'error', 'con el interruptor apagado la llamada mal tipada se ejecutó igual', r.toolParts)
      return true
    })
  )

  // ═══ 7.5 sanitizador ══════════════════════════════════════════════════════════════════════════════════════════
  const CLAVE = 'sk-ABCDEFGHIJKLMNOPQRSTUVWX0123456789'
  const eco = { name: 'bash', args: { command: `echo ${CLAVE}`, description: 'prueba' } }
  checkRun('o7-sanitizar: lo guardado (comando de la parte) sale sin la clave; la orden ejecutada no cambia (la salida la lleva)', () =>
    conRaiz(async (root) => {
      const r = await motor({ root, git: true, reply: 'once', ...unaVez(eco) })
      const p = r.toolParts[0]
      exige(p?.status === 'completed', 'bash no se completó', r.toolParts)
      exige(!JSON.stringify(p.input).includes(CLAVE), 'la clave quedó en el comando guardado', p.input)
      exige(JSON.stringify(p.input).includes('REDACTED'), 'el comando guardado no lleva la marca', p.input)
      exige(p.output.includes(CLAVE), 'sin el nivel del modelo, la salida debía conservar la clave (la orden no cambia)', p.output)
      return true
    })
  )
  checkRun('o7-sanitizar: con LAZUNOX_SANITIZAR_MODELO=1 el modelo recibe la salida con la marca y sin la clave', () =>
    conRaiz(async (root) => {
      const r = await motor({ root, git: true, reply: 'once', env: { LAZUNOX_SANITIZAR_MODELO: '1' }, ...unaVez(eco) })
      const vistos = r.toolMessages.join('\n')
      exige(vistos.length > 0, 'el modelo no recibió resultado de herramienta')
      exige(!vistos.includes(CLAVE), 'la clave llegó al modelo', vistos.slice(0, 300))
      exige(vistos.includes('REDACTED'), 'no hay marca en lo que ve el modelo', vistos.slice(0, 300))
      return true
    })
  )
  checkRun('o7-sanitizar: con LAZUNOX_SANITIZAR=0 todo queda como antes (la clave en el comando guardado)', () =>
    conRaiz(async (root) => {
      const r = await motor({ root, git: true, reply: 'once', env: { LAZUNOX_SANITIZAR: '0' }, ...unaVez(eco) })
      exige(JSON.stringify(r.toolParts[0]?.input).includes(CLAVE), 'con el interruptor apagado se siguió sanitizando', r.toolParts[0]?.input)
      return true
    })
  )

  // ═══ 7.20 políticas ═══════════════════════════════════════════════════════════════════════════════════════════
  const conPolitica = async (contenido, extra = {}) =>
    conRaiz(async (root) => {
      const arch = join(root, 'politica.json')
      if (contenido !== null) writeFileSync(arch, contenido)
      const r = await runEngine(bin, { root: join(root, 'e'), git: true, reply: 'once', env: { LAZUNOX_POLICY_FILE: arch }, call: { name: 'bash', args: { command: 'echo hola', description: 'x' } }, ...extra })
      try {
        rmSync(join(root, 'e'), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
      } catch {
        /* temporal */
      }
      return r
    })
  checkRun('o7-politicas: deny de la herramienta webfetch → no se ofrece al modelo; bash sí', async () => {
    const r = await conPolitica(JSON.stringify({ version: 1, deny: { tools: ['webfetch'] } }))
    exige(!r.error, 'el escenario falló', r.error)
    exige(r.toolsOffered?.includes('bash') && !r.toolsOffered.includes('webfetch'), 'webfetch sigue ofrecida o bash desapareció', r.toolsOffered)
    return true
  })
  checkRun('o7-politicas: archivo ausente = sin política (webfetch se ofrece)', async () => {
    const r = await conPolitica(null)
    exige(!r.error, 'el escenario falló', r.error)
    exige(r.toolsOffered?.includes('webfetch'), 'con el archivo ausente se perdió webfetch', r.toolsOffered)
    return true
  })
  checkRun('o7-politicas: archivo roto = falla cerrado (no se ofrece ninguna herramienta y el turno no ejecuta nada)', async () => {
    const r = await conPolitica('{esto no es json')
    const ofrecidas = r.toolsOffered ?? []
    exige(ofrecidas.length === 0 && r.toolParts.length === 0, 'con la política rota el motor siguió trabajando', { ofrecidas, partes: r.toolParts, estado: r.promptStatus, error: r.error })
    return true
  })
  checkRun('o7-politicas: deny del modelo fake/* → el turno no usa el modelo (ninguna petición al proveedor)', async () => {
    const r = await conPolitica(JSON.stringify({ version: 1, deny: { providers: ['fake'] } }))
    exige((r.requests ?? 0) === 0, 'el proveedor denegado recibió peticiones', { requests: r.requests, estado: r.promptStatus, error: r.error })
    return true
  })

  // ═══ 7.2 ahorro de tokens ═════════════════════════════════════════════════════════════════════════════════════
  checkRun('o7-ahorro: la primera petición es más corta que con LAZUNOX_AHORRO_TOKENS=0 (herramientas y sistema) y sigue ofreciendo bash/edit/read', () =>
    conRaiz(async (root) => {
      const base = { git: true, reply: 'once', call: { name: 'bash', args: { command: 'echo a', description: 'x' } } }
      const con = await motor({ ...base, root: join(root, 'c') })
      const sin = await motor({ ...base, root: join(root, 's'), env: { LAZUNOX_AHORRO_TOKENS: '0' } })
      exige(con.toolsBytesFirst > 0 && sin.toolsBytesFirst > 0, 'no se midió la lista de herramientas', [con.toolsBytesFirst, sin.toolsBytesFirst])
      exige(con.toolsBytesFirst < sin.toolsBytesFirst * 0.9, `las herramientas no bajaron ≥10 % (con ${con.toolsBytesFirst} B, sin ${sin.toolsBytesFirst} B)`)
      exige(sistemaDe(con).length < sistemaDe(sin).length, `el sistema no es más corto (con ${sistemaDe(con).length}, sin ${sistemaDe(sin).length})`)
      for (const t of ['bash', 'edit', 'read', 'write', 'grep', 'glob']) exige(con.toolsOffered.includes(t), `con el ahorro falta la herramienta ${t}`, con.toolsOffered)
      exige(con.toolParts[0]?.status === 'completed', 'bash no se ejecutó con el ahorro encendido', con.toolParts)
      return true
    })
  )

  // ═══ 7.22 /permission/siempre y 7.18 /session/:id/uso ═════════════════════════════════════════════════════
  checkRun('o7-rutas: /permission/siempre — GET vacío, «siempre» guardado se lista, DELETE/{id} lo quita, DELETE borra todo, id inexistente 404', () =>
    conRaiz(async (root) => {
      const r = await motor({
        root,
        git: true,
        env: { LAZUNOX_PERMISSION_PERSIST: '1' },
        inline: { permission: { bash: 'ask' } },
        reply: 'always',
        ...unaVez({ name: 'bash', args: { command: 'echo siempre-uno', description: 'x' } }),
        http: async ({ q }) => {
          const g1 = await J(await q('/permission/siempre'))
          const d404 = await J(await q('/permission/siempre/noexiste0000', { method: 'DELETE' }))
          return { g1, d404 }
        }
      })
      const { g1, d404 } = r.http
      exige(g1.status === 200 && g1.body?.activo === true, 'GET /permission/siempre no dio 200 con activo=true', g1)
      exige(Array.isArray(g1.body.reglas) && g1.body.reglas.length >= 1, 'el «siempre» aprobado no aparece listado', g1.body)
      exige(d404.status === 404, `DELETE de un id inexistente dio ${d404.status}`, d404)
      return true
    })
  )
  checkRun('o7-rutas: /permission/siempre — borrar uno y borrar todos', () =>
    conRaiz(async (root) => {
      let id
      const r = await motor({
        root,
        git: true,
        env: { LAZUNOX_PERMISSION_PERSIST: '1' },
        inline: { permission: { bash: 'ask' } },
        reply: 'always',
        ...unaVez({ name: 'bash', args: { command: 'echo siempre-dos', description: 'x' } }),
        http: async ({ q }) => {
          const g = await J(await q('/permission/siempre'))
          id = g.body?.reglas?.[0]?.id
          const del = await J(await q(`/permission/siempre/${id}`, { method: 'DELETE' }))
          const g2 = await J(await q('/permission/siempre'))
          const todo = await J(await q('/permission/siempre', { method: 'DELETE' }))
          return { id, del, g2, todo }
        }
      })
      const h = r.http
      exige(h.id, 'no había ningún «siempre» que borrar', h)
      exige(h.del.status === 200 && h.del.body === true, 'DELETE/{id} no devolvió true', h.del)
      exige(h.g2.body?.reglas?.length === 0, 'tras borrar uno sigue en la lista', h.g2.body)
      exige(h.todo.status === 200 && typeof h.todo.body?.borradas === 'number', 'DELETE de todos no devolvió {borradas}', h.todo)
      return true
    })
  )
  checkRun('o7-rutas: GET /session/{id}/uso — cifras tras un turno; sesión inexistente 404; LAZUNOX_USO=0 → 404', () =>
    conRaiz(async (root) => {
      const r = await motor({
        root: join(root, 'u'),
        git: true,
        reply: 'once',
        usage: { prompt_tokens: 1200, completion_tokens: 30, total_tokens: 1230 },
        ...unaVez({ name: 'bash', args: { command: 'echo a', description: 'x' } }),
        http: async ({ q, sessionID }) => ({ uso: await J(await q(`/session/${sessionID}/uso`)), nada: await J(await q('/session/ses_noexiste00000000000000/uso')) })
      })
      const { uso, nada } = r.http
      exige(uso.status === 200, `GET /uso dio ${uso.status}`, uso)
      exige(uso.body?.sesion?.pasos >= 1 && uso.body?.total?.tokensEnviados >= 1200, 'el uso no refleja los tokens del turno', uso.body)
      exige(Array.isArray(uso.body?.porPaso) && uso.body.porPaso.length >= 1, 'falta porPaso', uso.body)
      exige(nada.status === 404, `sesión inexistente dio ${nada.status}`, nada)
      const off = await motor({
        root: join(root, 'o'),
        git: true,
        reply: 'once',
        env: { LAZUNOX_USO: '0' },
        call: { name: 'bash', args: { command: 'echo a', description: 'x' } },
        http: async ({ q, sessionID }) => ({ uso: await J(await q(`/session/${sessionID}/uso`)) })
      })
      exige(off.http.uso.status === 404, `con LAZUNOX_USO=0 dio ${off.http.uso.status}`, off.http.uso)
      return true
    })
  )

  // ═══ 7.9 @imports ═════════════════════════════════════════════════════════════════════════════════════════════
  checkRun('o7-imports: «@docs/regla.md» en AGENTS.md entra al sistema; «@.env» y «@../fuera.md» quedan omitidos sin filtrar su contenido', () =>
    conRaiz(async (root, proj) => {
      mkdirSync(root, { recursive: true })
      writeFileSync(join(root, 'fuera.md'), 'CONTENIDO_FUERA_DEL_PROYECTO')
      const r = await motor({
        root,
        git: true,
        reply: 'once',
        projectFiles: {
          'AGENTS.md': 'Reglas.\n@docs/regla.md\n@.env\n@../fuera.md\n',
          'docs/regla.md': 'REGLA_IMPORTADA_XYZ',
          '.env': 'TOKEN_SECRETO_ENV=abc'
        },
        call: { name: 'bash', args: { command: 'echo a', description: 'x' } }
      })
      const s = sistemaDe(r)
      exige(s.includes('REGLA_IMPORTADA_XYZ'), 'el import válido no entró al sistema', s.slice(0, 400))
      exige(!s.includes('TOKEN_SECRETO_ENV') && !s.includes('abc'), 'el archivo sensible se coló', s.slice(0, 400))
      exige(!s.includes('CONTENIDO_FUERA_DEL_PROYECTO'), 'un archivo de fuera del proyecto se coló')
      exige((s.match(/@import omitido/g) ?? []).length >= 2, 'no hay marcas de import omitido', s.slice(0, 600))
      return true
    })
  )

  // ═══ 7.3 paralelismo seguro ═══════════════════════════════════════════════════════════════════════════════════
  checkRun('o7-paralelo: edit y read pedidos en el MISMO paso — la lectura (pedida después) ve la edición', () =>
    conRaiz(async (root, proj) => {
      const f = join(proj, 'p.txt')
      let hecho = false
      const r = await motor({
        root,
        git: true,
        reply: 'once',
        projectFiles: { 'p.txt': 'ANTES\n' },
        decide: ({ tools, toolTexts }) => {
          if (!tools.length || hecho || toolTexts.length) return null
          hecho = true
          return { calls: [{ name: 'edit', args: { filePath: f, oldString: 'ANTES', newString: 'DESPUES' } }, { name: 'read', args: { filePath: f } }] }
        }
      })
      const lect = r.toolParts.find((p) => p.tool === 'read')
      exige(lect?.status === 'completed' && r.toolParts.find((p) => p.tool === 'edit')?.status === 'completed', 'no se completaron las dos', r.toolParts.map((p) => [p.tool, p.status]))
      exige(/DESPUES/.test(lect.output) && !/ANTES/.test(lect.output), 'la lectura vio el archivo sin editar (carrera)', lect.output)
      return true
    })
  )

  // ═══ 7.4 respuesta cortada ════════════════════════════════════════════════════════════════════════════════════
  checkRun('o7-cortada: texto cortado por el límite (finish_reason=length) → el motor da otro turno con el aviso; con LAZUNOX_SALIDA_CORTADA=0 no', () =>
    conRaiz(async (root) => {
      const corrida = (sub, env) =>
        motor({
          root: join(root, sub),
          git: true,
          reply: 'once',
          env,
          decide: ({ tools, body }) => {
            if (!tools.length) return { text: 'titulo' }
            // la 1.ª petición de trabajo: sin mensajes de la persona extra (solo la pregunta); las siguientes ya llevan el aviso
            const us = (body.messages ?? []).filter((m) => m.role === 'user').length
            return us <= 1 ? { text: 'respuesta a medias', finish: 'length' } : { text: 'listo ya' }
          }
        })
      const con = await corrida('c', {})
      const sin = await corrida('s', { LAZUNOX_SALIDA_CORTADA: '0' })
      const trabajo = (r) => (r.bodies ?? []).filter((b) => (b.tools ?? []).length > 0)
      const conN = trabajo(con).length
      const sinN = trabajo(sin).length
      exige(conN >= 2, `con el aviso se esperaban ≥2 peticiones de trabajo y hubo ${conN}`)
      exige(sinN === 1, `con el interruptor apagado se esperaba 1 petición de trabajo y hubo ${sinN}`)
      const ultimo = trabajo(con).at(-1).messages.filter((m) => m.role === 'user').at(-1)
      exige(/límite de salida|limite de salida/i.test(str(ultimo?.content)), 'el aviso sintético no llegó al modelo', str(ultimo?.content).slice(0, 300))
      return true
    })
  )

  // ═══ 7.15 cuaderno ════════════════════════════════════════════════════════════════════════════════════════════
  const NB = JSON.stringify(
    {
      cells: [
        { cell_type: 'markdown', metadata: {}, source: ['# Titulo'] },
        { cell_type: 'code', execution_count: 3, metadata: {}, outputs: [{ output_type: 'stream', name: 'stdout', text: ['viejo\n'] }], source: ['print("viejo")'] },
        { cell_type: 'code', execution_count: 4, metadata: {}, outputs: [], source: ['x = 1'] }
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 4
    },
    null,
    1
  )
  checkRun('o7-cuaderno: sin .ipynb no se ofrece cuaderno_editar; con .ipynb sí, y «reemplazar» cambia SOLO esa celda', () =>
    conRaiz(async (root, proj) => {
      const sin = await motor({ root: join(root, 'sin'), git: true, reply: 'once', call: { name: 'bash', args: { command: 'echo a', description: 'x' } } })
      exige(!sin.toolsOffered.includes('cuaderno_editar'), 'se ofreció cuaderno_editar sin ningún .ipynb en el proyecto')
      const p2 = join(root, 'con', 'proj')
      const con = await motor({
        root: join(root, 'con'),
        git: true,
        reply: 'once',
        projectFiles: { 'n.ipynb': NB + '\n' },
        ...unaVez({ name: 'cuaderno_editar', args: { filePath: join(p2, 'n.ipynb'), operacion: 'reemplazar', indice: 1, contenido: 'print("nuevo")' } })
      })
      exige(con.toolsOffered.includes('cuaderno_editar'), 'no se ofreció cuaderno_editar con un .ipynb')
      exige(con.toolParts[0]?.status === 'completed', 'cuaderno_editar no se completó', con.toolParts)
      const nb = JSON.parse(readFileSync(join(p2, 'n.ipynb'), 'utf8'))
      exige(nb.cells[1].source.join('') === 'print("nuevo")', 'la celda no cambió', nb.cells[1])
      exige(!nb.cells[1].outputs?.length && (nb.cells[1].execution_count ?? null) === null, 'la celda cambiada conservó salidas viejas', nb.cells[1])
      exige(nb.cells[2].execution_count === 4 && nb.cells[0].source.join('') === '# Titulo', 'se tocaron celdas vecinas', nb.cells)
      return true
    })
  )

  // ═══ aislamiento de las pruebas ═══════════════════════════════════════════════════════════════════════════════
  checkRun('o7-aislado: GET /mcp del motor de pruebas está vacío (HOME y XDG aislados: ningún conector ajeno)', () =>
    conRaiz(async (root) => {
      const r = await motor({ root, git: true, reply: 'once', call: { name: 'bash', args: { command: 'echo a', description: 'x' } }, http: async ({ q }) => J(await q('/mcp')) })
      exige(r.http.status === 200 && Object.keys(r.http.body ?? {}).length === 0, 'hay conectores en el motor de pruebas', r.http)
      return true
    })
  )
}
