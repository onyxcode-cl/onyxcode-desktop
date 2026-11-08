// Línea base de la Ola A (1.8.12) con el motor REAL (lazunox.14): ocho comprobaciones que la auditoría dedujo leyendo código.
// Sin modelo ni red: proveedor falso del arnés (`harness.mjs`). Cada una imprime «CONFIRMADO» o «NO SE REPRODUCE» con el detalle.
// Una comprobación «NO SE REPRODUCE» hace fallar la corrida (código 1): no es un error del arnés, es que el motor ya no se comporta
// como dijo la auditoría. W-A3 y W-M2 dan la vuelta a las comprobaciones 1, 6 y 7 cuando arreglen lo que describen.
//   PROBE_ONLY=olaA node scripts/engine-probe/run.mjs [ruta/al/opencode]
//   1  `general` lanzado por `task` desde Code (padre build + reglas de sesión de cada modo + guardián real + config inline real, W-A3): PASA en
//      los cuatro modos preguntando antes de editar/ejecutar (sesión hija), respeta las protecciones de W-A1, y sigue BLOQUEADO en «Solo explorar»
//   2  R2: el `command` de un conector del opencode.json de una carpeta se ARRANCA con solo `GET /mcp?directory=<carpeta>`
//   3  R2: en modo «manual» las herramientas de ese conector se usan sin `permission.asked`
//   4  R4: en el bloque «plan» (Solo explorar) `webfetch` no pregunta
//   5  `websearch` solo aparece con proveedor `opencode` o con `OPENCODE_ENABLE_EXA=1`
//   6  AGENTS.md de 100 KB: el sistema de la primera petición lo trae entero (sin tope de 32 KB)
//   7  `respaldo` solo en OPENCODE_CONFIG_CONTENT: no conmuta ante un 429 de cuota (control: en la config global sí)
//   8  `LAZUNOX_HOOKS_SHA256` de otro contenido: el gancho PreToolUse no se ejecuta (control: con la huella correcta sí)
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const str = (c) => (typeof c === 'string' ? c : JSON.stringify(c))
const corto = (x) => (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 700)

/** Lanza si la comprobación no se reprodujo; si se cumple imprime «CONFIRMADO». */
class NoSeReproduce extends Error {}
const confirmado = (detalle) => console.log(`      CONFIRMADO: ${detalle}`)
const noSeReproduce = (detalle) => {
  throw new NoSeReproduce(`NO SE REPRODUCE: ${detalle}`)
}

export const FAMILIAS = ['olaA']

export function registrarOlaA({ bin, checkRun: registrar, runEngine, tsModule, repo }) {
  const checkRun = (name, run) => registrar(name, run, 'olaA')
  const motor = async (sc) => {
    const r = await runEngine(bin, sc)
    if (r.error) throw new Error(`el escenario falló: ${r.error}${r.log ? '\n' + r.log : ''}`)
    return r
  }
  const J = async (r) => {
    const t = await r.text()
    try {
      return JSON.parse(t)
    } catch {
      return t
    }
  }
  const agentsDir = join(repo, 'resources', 'opencode', 'agents')
  const win = process.platform === 'win32'

  // Módulos reales de la app (empaquetados con esbuild): config inline, guardián y reglas de sesión de Code.
  let modulos = null
  const reales = async () =>
    (modulos ??= {
      ...(await tsModule('src/main/opencode/config.ts')),
      ...(await tsModule('src/main/opencode/subagent-guard.ts')),
      ...(await tsModule('src/main/opencode/code-mcp-permission.ts')),
      ...(await tsModule('src/shared/shell-bg-permissions.ts')),
      ...(await tsModule('src/shared/documents-permissions.ts')),
      ...(await tsModule('src/renderer/src/features/code/impl/permission-rules.ts'))
    })

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const espera = async (fn, ms = 12_000, paso = 250) => {
    const t0 = Date.now()
    for (;;) {
      const v = await fn()
      if (v) return v
      if (Date.now() - t0 > ms) return v
      await sleep(paso)
    }
  }

  // ── 1. `general` desde Code (W-A3, D5=A: `general` declara «preguntar» y el guardián lo deja pasar) ─────────────────────────────────
  // Config inline como la de la app: bloque `agent` real + `permission` de bgshell y documentos (server.ts: `codeMcpPermission`).
  const configReal = (m) => {
    const permission = m.buildCodeMcpPermission({
      servers: [],
      trusted: [],
      internal: [],
      base: {},
      fixed: { ...m.bgshellConfigPermission(), ...m.documentsConfigPermission() },
      fixedServers: [m.SHELL_BG_SERVER, m.DOCUMENTS_SERVER]
    })
    return m.buildInlineConfig({ permission })
  }
  // Acciones que la hija intenta (el padre le pasa el nombre en el prompt: `HIJA:<acción>`).
  const ACCIONES = {
    escribir: { name: 'write', args: { filePath: 'x.txt', content: 'x' }, archivo: 'x.txt', permiso: 'write' },
    config: { name: 'write', args: { filePath: 'opencode.json', content: '{}' }, archivo: 'opencode.json', permiso: 'write' },
    git: { name: 'write', args: { filePath: '.git/config', content: '[core]\n' }, archivo: null, permiso: 'write' },
    opencode: { name: 'write', args: { filePath: '.opencode/x.md', content: 'x' }, archivo: '.opencode/x.md', permiso: 'write' },
    shell: { name: 'bash', args: { command: 'echo hola > y.txt', description: 'escribe y.txt' }, archivo: 'y.txt', permiso: 'bash' }
  }
  /** Lanza `task general` desde un padre `build` con las reglas de sesión de `modo`; la hija hace `accion`. Contesta `respuesta` a lo que pregunte. */
  const hija = async (modo, accion, respuesta, agente = 'build') => {
    const m = await reales()
    const a = ACCIONES[accion]
    const preguntas = []
    const r = await motor({
      agent: agente,
      agentsDir,
      git: true,
      plugins: { 'lazunox-subagent-guard.js': m.subagentGuardPluginSource() },
      inline: configReal(m),
      sessionBody: { permission: m.rulesetFor(modo) },
      decide: ({ tools, toolTexts, userTexts }) => {
        if (toolTexts.length) return null
        const u = userTexts.at(-1)
        if (u === 'HIJA:' + accion && tools.includes(a.name)) return { name: a.name, args: a.args }
        if (u === 'hola' && tools.includes('task'))
          return { name: 'task', args: { subagent_type: 'general', description: 'trabajo', prompt: 'HIJA:' + accion } }
        return null
      },
      call: { name: 'task', args: {} },
      reply: async (props, { proj }) => {
        // Se anota si el archivo ya existía en el instante de la pregunta (debe ser que no) y de qué sesión viene.
        preguntas.push({
          permission: props.permission,
          patterns: props.patterns,
          sessionID: props.sessionID,
          existiaAlPreguntar: a.archivo ? existsSync(join(proj, a.archivo)) : false
        })
        return respuesta(props)
      },
      http: async (h) => ({
        existe: a.archivo ? existsSync(join(h.proj, a.archivo)) : false,
        gitConfig: readFileSync(join(h.proj, '.git', 'config'), 'utf8'),
        padre: h.sessionID,
        hijas: ((await J(await h.q(`/session/${h.sessionID}/children`))) || []).map((x) => x.id)
      })
    })
    const tp = r.toolParts.find((p) => p.tool === 'task')
    if (!tp) throw new Error(`el padre no llegó a llamar a task. Herramientas ofrecidas: ${corto(r.toolsOffered)}`)
    return { tp, preguntas, http: r.http, a }
  }
  const resumen = (tp) => `${tp.status}: ${tp.output.replace(/\s+/g, ' ').slice(0, 300)}`

  // Los cuatro modos: el guardián deja pasar a `general`; en todos la hija PREGUNTA antes de escribir (permission.asked de la sesión hija) y,
  // contestando «una vez», escribe; no existe antes de contestar.
  for (const [modo, etiqueta] of [
    ['manual', 'Preguntar siempre'],
    ['acceptEdits', 'Editar sin preguntar'],
    ['auto', 'Automático'],
    ['bypass', 'Todo sin preguntar']
  ]) {
    checkRun(
      `olaA 1 (${modo}, ${etiqueta}): task general PASA el guardián y su write pregunta (sesión hija); x.txt solo existe tras «una vez»`,
      async () => {
        const x = await hija(modo, 'escribir', () => 'once')
        const pw = x.preguntas.filter((q) => q.permission === 'edit' || q.permission === 'write')
        if (x.tp.status !== 'completed' || !x.http.existe)
          noSeReproduce(
            `se esperaba que pasara y escribiera tras «una vez»: task=${resumen(x.tp)}; x.txt=${x.http.existe}; preguntas=${corto(x.preguntas)}`
          )
        if (pw.length !== 1) noSeReproduce(`se esperaba UNA pregunta de edición de la hija y hubo ${pw.length}: ${corto(x.preguntas)}`)
        if (pw[0].existiaAlPreguntar) noSeReproduce('x.txt ya existía al preguntar: el ayudante escribió antes de preguntar')
        if (!x.http.hijas.includes(pw[0].sessionID) || pw[0].sessionID === x.http.padre)
          noSeReproduce(
            `la pregunta no es de la sesión HIJA: pregunta=${pw[0].sessionID}, padre=${x.http.padre}, hijas=${corto(x.http.hijas)}`
          )
        confirmado(
          `pasa; pregunta ${pw[0].permission} ${corto(pw[0].patterns)} de la sesión hija ${pw[0].sessionID} (padre ${x.http.padre}); x.txt aparece solo tras «una vez»`
        )
        return true
      }
    )
  }

  // Tope del padre y protecciones de W-A1 en «Automático» (el modo más libre que antes dejaba editar solo): la hija NO hereda los `ask` de .git,
  // opencode.json y .opencode/* (el motor solo hereda `deny`), pero su `edit/write` es `ask` para todo: pregunta y, rechazado, no se crea nada.
  for (const accion of ['config', 'git', 'opencode', 'shell']) {
    checkRun(`olaA 1 (auto): la hija que intenta «${accion}» PREGUNTA y, rechazada, no cambia nada`, async () => {
      const x = await hija('auto', accion, () => 'reject')
      const q = x.preguntas.filter((p) => p.permission === x.a.permiso || (x.a.permiso === 'write' && p.permission === 'edit'))
      if (!q.length) noSeReproduce(`la hija no preguntó por «${accion}»: task=${resumen(x.tp)}; preguntas=${corto(x.preguntas)}`)
      if (!q.every((p) => x.http.hijas.includes(p.sessionID))) noSeReproduce(`una pregunta no es de la sesión hija: ${corto(x.preguntas)}`)
      if (x.http.existe) noSeReproduce(`«${accion}» se ejecutó pese al rechazo (${x.a.archivo})`)
      if (accion === 'git' && x.http.gitConfig.includes('[core]\n') && x.http.gitConfig.trim() === '[core]')
        noSeReproduce('.git/config fue sobrescrito pese al rechazo')
      confirmado(`pregunta ${q[0].permission} ${corto(q[0].patterns)}; rechazada, nada cambió`)
      return true
    })
  }

  // «Solo explorar» (sesión con el bloque plan) sigue sin dejar trabajar a `general`: aquí lo para la regla `task general deny` del propio bloque
  // (permission-rules.ts); el guardián, por su parte, deja pasar la sesión porque la hija heredaría el `edit deny` (el motor copia los deny).
  checkRun('olaA 1 (plan, Solo explorar): task general sigue BLOQUEADO (regla task general deny) y no escribe nada', async () => {
    const x = await hija('plan', 'escribir', () => 'reject')
    if (
      x.tp.status === 'error' &&
      /prevents you from using this specific tool call|bloqueado por Lazunox/.test(x.tp.output) &&
      !x.http.existe &&
      !x.preguntas.length
    ) {
      confirmado(`bloqueado (${resumen(x.tp)})`)
      return true
    }
    noSeReproduce(`se esperaba bloqueo: task=${resumen(x.tp)}; x.txt=${x.http.existe}; preguntas=${corto(x.preguntas)}`)
  })

  // ── 2 y 3. R2: conector declarado en el opencode.json de la carpeta ─────────────────────────────────────────────
  const MARCA = 'MARCA-R2'
  const comandoMarca = win ? ['cmd', '/c', `echo x> ${MARCA}`] : [process.execPath, '-e', `require('fs').writeFileSync('${MARCA}','x')`]
  checkRun(
    'olaA 2 (R2): solo GET /mcp?directory=<carpeta> arranca el command del opencode.json de esa carpeta (aparece MARCA-R2)',
    async () => {
      const r = await motor({
        skipFirst: true,
        call: { name: 'read', args: {} },
        http: async (h) => {
          // Carpeta aparte (el motor arrancó en otra, sin configuración): se escribe su opencode.json y SOLO se hace GET /mcp?directory=<carpeta>.
          const carpeta = mkdtempSync(join(h.root, 'victima-'))
          writeFileSync(join(carpeta, 'opencode.json'), JSON.stringify({ mcp: { prueba: { type: 'local', command: comandoMarca } } }))
          const antes = existsSync(join(carpeta, MARCA))
          // `#`: el arnés añade su propio `&directory=<proyecto>` al final de la ruta; tras el `#` queda en el fragmento y no se envía.
          const resp = await h.q(`/mcp?directory=${encodeURIComponent(carpeta)}#`)
          const estado = await J(resp)
          const aparece = await espera(() => existsSync(join(carpeta, MARCA)) || existsSync(join(h.proj, MARCA)))
          return { antes, estado, aparece, enCarpeta: existsSync(join(carpeta, MARCA)), enProyecto: existsSync(join(h.proj, MARCA)) }
        }
      })
      const x = r.http
      if (x.antes) throw new Error('la marca ya existía antes del GET: la prueba no vale')
      if (x.aparece) {
        confirmado(
          `MARCA-R2 apareció (${x.enCarpeta ? 'en la carpeta consultada' : 'en la carpeta del arnés'}) tras solo un GET /mcp; estado del conector: ${corto(x.estado)}`
        )
        return true
      }
      noSeReproduce(`MARCA-R2 no apareció en 12 s tras GET /mcp?directory=<carpeta>; respuesta: ${corto(x.estado)}`)
    }
  )

  checkRun('olaA 3 (R2): en modo manual una herramienta del conector de la carpeta se ejecuta SIN permission.asked', async () => {
    const m = await reales()
    const r = await motor({
      agent: 'build',
      projectFiles: {
        'opencode.json': JSON.stringify({ mcp: { prueba: { type: 'local', command: [process.execPath, join(here, 'probe-mcp.mjs')] } } })
      },
      sessionBody: { permission: m.rulesetFor('manual') },
      // El conector del proyecto se conecta al cargar la carpeta: se espera a que esté listo antes del primer turno.
      pre: async ({ q }) => espera(async () => (await J(await q('/mcp'))).prueba?.status === 'connected', 20_000),
      call: { name: 'prueba_start', args: { command: 'a' } }
    })
    const tp = r.toolParts.find((p) => p.tool === 'prueba_start')
    const preguntas = r.asked.filter((a) => a.permission === 'prueba_start')
    if (!tp)
      throw new Error(
        `el modelo no pudo llamar a prueba_start (¿el conector no se conectó?). Pre: ${corto(r.pre)}; herramientas: ${corto(r.toolsOffered)}`
      )
    if (tp.status === 'completed' && preguntas.length === 0) {
      confirmado(`prueba_start ejecutada sin preguntar (preguntas en total: ${r.asked.length})`)
      return true
    }
    noSeReproduce(`prueba_start=${tp.status}, preguntas=${corto(r.asked)}`)
  })

  // ── 4. R4: web en el bloque «plan» ───────────────────────────────────────────────────────────────────────────────
  checkRun('olaA 4 (R4): con el bloque plan (Solo explorar) webfetch a un servidor local NO genera permission.asked', async () => {
    const m = await reales()
    const web = http.createServer((_q, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end('hola desde el servidor falso'))
    await new Promise((ok) => web.listen(0, '127.0.0.1', ok))
    try {
      const url = `http://127.0.0.1:${web.address().port}/`
      const llamada = { name: 'webfetch', args: { url, format: 'text' } }
      const r = await motor({ agent: 'build', sessionBody: { permission: m.rulesetFor('plan') }, call: llamada })
      // Control: si la regla fuera «preguntar», el arnés sí vería la pregunta (así la prueba no pasa en vacío).
      const c = await motor({
        agent: 'build',
        sessionBody: { permission: [...m.rulesetFor('plan'), { permission: 'webfetch', pattern: '*', action: 'ask' }] },
        call: llamada
      })
      if (!c.asked.some((a) => a.permission === 'webfetch'))
        throw new Error(`control: con webfetch=ask tampoco hubo pregunta (prueba en vacío): ${corto(c.asked)}`)
      const tp = r.toolParts.find((p) => p.tool === 'webfetch')
      if (tp?.status === 'completed' && !r.asked.some((a) => a.permission === 'webfetch')) {
        confirmado('webfetch ejecutado sin preguntar con el bloque plan (el control con ask sí pregunta)')
        return true
      }
      noSeReproduce(`webfetch=${tp?.status ?? 'sin parte'} ${tp?.output.slice(0, 200) ?? ''}; preguntas=${corto(r.asked)}`)
    } finally {
      web.close()
    }
  })

  // ── 5. websearch con proveedor que no es opencode ───────────────────────────────────────────────────────────────
  checkRun(
    'olaA 5: con proveedor falso (no opencode) websearch no se ofrece; con OPENCODE_ENABLE_EXA=1 sí (solo se mira la lista)',
    async () => {
      const sin = await motor({ call: { name: 'read', args: { filePath: '.' } } })
      const con = await motor({ call: { name: 'read', args: { filePath: '.' } }, env: { OPENCODE_ENABLE_EXA: '1' } })
      const a = sin.toolsOffered ?? []
      const b = con.toolsOffered ?? []
      if (!a.length || !b.length) throw new Error(`no se obtuvo la lista de herramientas (sin=${a.length}, con=${b.length})`)
      if (!a.includes('websearch') && b.includes('websearch')) {
        confirmado(`sin bandera: ${a.length} herramientas y sin websearch; con OPENCODE_ENABLE_EXA=1: ${b.length} y con websearch`)
        return true
      }
      noSeReproduce(`sin bandera websearch=${a.includes('websearch')}; con bandera websearch=${b.includes('websearch')}`)
    }
  )

  // ── 6. AGENTS.md de 100 KB ─────────────────────────────────────────────────────────────────────────────────────
  checkRun('olaA 6: AGENTS.md de 100 KB entra ENTERO en el sistema de la primera petición (sin tope de 32 KB)', async () => {
    const inicio = 'INICIO-AGENTS-A0'
    const fin = 'FIN-AGENTS-A0'
    const relleno = 'Regla de relleno para medir el tamaño del archivo de instrucciones del proyecto.\n'
    let texto = `${inicio}\n`
    while (texto.length < 100 * 1024) texto += relleno
    texto += `${fin}\n`
    const r = await motor({ git: true, projectFiles: { 'AGENTS.md': texto }, call: { name: 'read', args: { filePath: '.' } } })
    const b = (r.bodies ?? []).find((x) => (x.tools ?? []).length > 0)
    const sistema = (b?.messages ?? [])
      .filter((x) => x.role === 'system')
      .map((x) => str(x.content))
      .join('\n---\n')
    const cuenta = sistema.split(relleno.trim()).length - 1
    const esperadas = texto.split(relleno.trim()).length - 1
    if (sistema.includes(inicio) && sistema.includes(fin) && cuenta === esperadas) {
      confirmado(
        `el sistema trae las ${cuenta} líneas del archivo (${texto.length} caracteres; sistema total ${sistema.length}); no hay recorte`
      )
      return true
    }
    noSeReproduce(
      `inicio=${sistema.includes(inicio)}, fin=${sistema.includes(fin)}, líneas de relleno ${cuenta}/${esperadas}, sistema ${sistema.length} caracteres`
    )
  })

  // ── 7. respaldo solo en la config inline ──────────────────────────────────────────────────────────────────────
  const PROVEEDORES = (pport) => {
    const modelo = (id) => ({ name: id, tool_call: true, cost: { input: 0, output: 0 } })
    const prov = (id, modelos) => ({
      npm: '@ai-sdk/openai-compatible',
      name: id,
      options: { baseURL: `http://127.0.0.1:${pport}/${id}/v1`, apiKey: 'no-usado' },
      models: modelos
    })
    return { pa: prov('pa', { a1: modelo('a1'), a2: modelo('a2') }) }
  }
  const CUOTA = {
    status: 429,
    headers: { 'retry-after-ms': '50' },
    rawBody: { error: { message: 'Free usage exceeded', type: 'FreeUsageLimitError' } }
  }
  const conCuota = (sc) => {
    const llamadas = []
    return motor({
      git: true,
      providers: PROVEEDORES,
      model: 'pa/a1',
      smallModel: 'pa/a2',
      skipFirst: true,
      decide: (ctx) => {
        const modelo = `${/^\/(\w+)\//.exec(ctx.url)?.[1]}/${ctx.model}`
        if (!(ctx.tools ?? []).length) return { text: 'titulo' }
        llamadas.push(modelo)
        return modelo === 'pa/a1' ? CUOTA : { text: `OK_${modelo}` }
      },
      call: { name: 'read', args: {} },
      ...sc,
      http: async (h) => {
        const estado = await h.prompt('HAZ_ALGO', { timeoutMs: 60_000 })
        const msgs = await J(await h.q(`/session/${h.sessionID}/message`))
        const avisos = msgs.flatMap((x) => x.parts.filter((p) => p.type === 'text' && p.metadata?.lazunox_respaldo))
        return { estado, llamadas, avisos: avisos.length, ultimo: msgs.filter((x) => x.info.role === 'assistant').at(-1)?.info.modelID }
      }
    })
  }
  checkRun(
    'olaA 7: con `respaldo` solo en OPENCODE_CONFIG_CONTENT un 429 de cuota NO conmuta (control: en la config global sí)',
    async () => {
      const ctl = await conCuota({ globalConfig: { respaldo: { modelos: ['pa/a2'] } } })
      if (!ctl.http.llamadas.includes('pa/a2') || ctl.http.avisos < 1)
        throw new Error(`control: con respaldo global tampoco conmutó (prueba en vacío): ${corto(ctl.http)}`)
      const r = await conCuota({ inline: { respaldo: { modelos: ['pa/a2'] } } })
      const x = r.http
      if (!x.llamadas.includes('pa/a2') && x.avisos === 0) {
        confirmado(
          `no conmuta: llamadas=${corto(x.llamadas)}, avisos=${x.avisos}; el control con config global sí (a2, ${ctl.http.avisos} aviso)`
        )
        return true
      }
      noSeReproduce(`sí conmutó con respaldo inline: llamadas=${corto(x.llamadas)}, avisos=${x.avisos}, último modelo=${x.ultimo}`)
    }
  )

  // ── 8. huella de los ganchos ──────────────────────────────────────────────────────────────────────────────────
  checkRun(
    'olaA 8: LAZUNOX_HOOKS_SHA256 de otro contenido → el PreToolUse que crea un archivo NO lo crea (control: con la huella correcta sí)',
    async () => {
      const d = mkdtempSync(join(tmpdir(), 'lz-olaA-hooks-'))
      try {
        const marca = join(d, 'gancho-corrio.txt').replaceAll('\\', '/')
        const archivo = join(d, 'hooks.json')
        const contenido = JSON.stringify({
          hooks: { PreToolUse: [{ matcher: 'read', command: `"${process.execPath}" -e "require('fs').writeFileSync('${marca}', 'ok')"` }] }
        })
        writeFileSync(archivo, contenido)
        const huella = createHash('sha256').update(readFileSync(archivo)).digest('hex')
        const ajena = createHash('sha256').update('otro contenido').digest('hex')
        const base = { OPENCODE_DISABLE_DEFAULT_PLUGINS: '0', LAZUNOX_HOOKS_FILE: archivo }
        const correr = async (sha) => {
          rmSync(marca, { force: true })
          await motor({ env: { ...base, LAZUNOX_HOOKS_SHA256: sha }, call: { name: 'read', args: { filePath: '.' } }, settleMs: 800 })
          return existsSync(marca)
        }
        const control = await correr(huella)
        if (!control) throw new Error('control: con la huella correcta el gancho tampoco corrió (prueba en vacío)')
        const ajeno = await correr(ajena)
        if (!ajeno) {
          confirmado('con huella ajena el gancho no corrió; con la correcta sí')
          return true
        }
        noSeReproduce('con huella ajena el gancho SÍ corrió')
      } finally {
        rmSync(d, { recursive: true, force: true })
      }
    }
  )
}
