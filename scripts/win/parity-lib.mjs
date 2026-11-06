// Logica pura de scripts/win/parity-check.mjs (W14): compara lo observado en la app armada de Windows con
// docs/PARIDAD-WINDOWS.json (esperadoEnEjecucion.win32) y arma el informe. Sin Electron ni red: se prueba en
// scripts/win-parity-lib.test.mjs.

/** Quita el sobre {ok,data} del puente de tareas si viene; devuelve el estado de la sandbox tal cual. */
export function desenvolverEstado(r) {
  if (r && typeof r === 'object' && 'data' in r && r.data && typeof r.data === 'object') return r.data
  return r
}

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * @param {object} tabla  contenido de docs/PARIDAD-WINDOWS.json
 * @param {{platform?:unknown, capsFlags?:unknown, sandbox?:unknown, error?:string}} obs  lo leido en ejecucion
 * @param {{exigirSinAdmin?:boolean}} [opts]
 * @returns {{ok:boolean, elevada:boolean, filas:{nombre:string, estado:'OK'|'FALLA'|'AVISO', detalle:string}[], fallos:number}}
 */
export function compararParidad(tabla, obs, opts = {}) {
  const filas = []
  const add = (nombre, estado, detalle = '') => filas.push({ nombre, estado, detalle })
  const esp = tabla?.esperadoEnEjecucion?.win32
  if (!esp) {
    add('tabla', 'FALLA', 'docs/PARIDAD-WINDOWS.json no trae esperadoEnEjecucion.win32')
    return { ok: false, elevada: false, filas, fallos: 1 }
  }
  if (obs?.error) add('lectura', 'FALLA', String(obs.error))

  // platform
  if (obs?.platform === esp.platform) add('window.api.platform', 'OK', String(obs.platform))
  else add('window.api.platform', 'FALLA', `esperado ${esp.platform}, llego ${JSON.stringify(obs?.platform)}`)

  // capsFlags: clave por clave, solo las de la tabla (se ignora glass y lo demas)
  const flags = obs?.capsFlags && typeof obs.capsFlags === 'object' ? obs.capsFlags : {}
  for (const [k, v] of Object.entries(esp.capsFlags ?? {})) {
    if (flags[k] === v) add(`capsFlags.${k}`, 'OK', String(v))
    else add(`capsFlags.${k}`, 'FALLA', `esperado ${v}, llego ${JSON.stringify(flags[k])}`)
  }

  // sandbox
  const sb = obs?.sandbox && typeof obs.sandbox === 'object' ? obs.sandbox : null
  const sbEsp = esp.sandbox ?? {}
  let elevada = false
  if (!sb) {
    add('tasks:sandbox:status', 'FALLA', 'sin respuesta')
  } else {
    const detalle = `backend=${sb.backend} state=${sb.state}${sb.detail ? ` detail=${sb.detail}` : ''}`
    const conAdmin = sbEsp.conAdministrador
    elevada = !!conAdmin && sb.state === conAdmin.state && sb.detail === conAdmin.detail
    if (elevada) {
      // Sesion elevada (p. ej. SSH como administrador): la puerta cerrada es lo ESPERADO ahi; no es fallo, pero no prueba el caso real.
      if (opts.exigirSinAdmin) add('sandbox (sesion elevada)', 'FALLA', `${detalle}: se exigio sesion sin administrador`)
      else add('sandbox (sesion elevada)', 'AVISO', `${detalle}: coincide con conAdministrador; el caso sinAdministrador NO se pudo verificar`)
    } else {
      if (sb.backend === sbEsp.backend) add('sandbox.backend', 'OK', String(sb.backend))
      else add('sandbox.backend', 'FALLA', `esperado ${sbEsp.backend}, llego ${JSON.stringify(sb.backend)}`)
      const prohibidos = sbEsp.sinAdministrador?.estadosProhibidos ?? []
      if (prohibidos.includes(sb.state)) add('sandbox.state', 'FALLA', `${detalle} (estado prohibido sin administrador)`)
      else add('sandbox.state', 'OK', detalle)
    }
  }
  const fallos = filas.filter((f) => f.estado === 'FALLA').length
  return { ok: fallos === 0, elevada, filas, fallos }
}

/** Informe legible, una linea por comprobacion y un resumen final. */
export function formatearInforme(res, encabezado = 'PARITY-CHECK Windows') {
  const lineas = [encabezado]
  for (const f of res.filas) lineas.push(`${f.estado === 'OK' ? 'OK   ' : f.estado === 'AVISO' ? 'AVISO' : 'FALLA'} ${f.nombre}${f.detalle ? ' - ' + f.detalle : ''}`)
  lineas.push(res.ok ? `RESULTADO: OK${res.elevada ? ' (con aviso: sesion elevada)' : ''}` : `RESULTADO: FALLA (${res.fallos})`)
  return lineas.join('\n')
}

/** Lee de vuelta un informe producido por formatearInforme (lo usa el release para decidir sin volver a ejecutar). */
export function parsearInforme(texto) {
  const filas = []
  let resultado = null
  for (const l of String(texto).split(/\r?\n/)) {
    const m = /^(OK|AVISO|FALLA) {1,2}(\S.*?)(?: - (.*))?$/.exec(l.trimEnd())
    if (m && !l.startsWith('RESULTADO')) filas.push({ estado: m[1], nombre: m[2], detalle: m[3] ?? '' })
    const r = /^RESULTADO: (OK|FALLA)/.exec(l)
    if (r) resultado = r[1]
  }
  return { filas, resultado, ok: resultado === 'OK', elevada: /sesion elevada/.test(String(texto)) && resultado === 'OK' }
}
