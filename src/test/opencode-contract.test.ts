/**
 * Contrato con la API de OpenCode, SIN ejecutar el binario ni usar la red:
 *  - las rutas que la app usa (derivadas del código) existen en el SDK fijado;
 *  - la instantánea `resources/opencode-bin/api-routes.json` está alineada con el SDK y contiene las rutas usadas;
 *  - el comparador da 1 (falta ruta usada), 0 (ruta nueva) o 2 (esquema cambiado).
 * La comprobación contra el binario real es `npm run check:opencode`.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compareContract, sdkCallsInSource, sdkRoutes, usedRoutes } from '../../scripts/opencode-contract-lib.mjs'

const sdk = sdkRoutes()
const used = usedRoutes({ sdk })
const snapshot = JSON.parse(readFileSync('resources/opencode-bin/api-routes.json', 'utf8')) as {
  routeCount: number
  routes: string[]
  usedSchemas: Record<string, string>
}

describe('rutas que la app usa', () => {
  it('se derivan del código y existen todas en el SDK fijado', () => {
    expect(used.routes.length).toBeGreaterThan(30)
    expect(used.unmatched).toEqual([])
    for (const r of used.routes) expect(sdk.routes.has(r), r).toBe(true)
  })

  it('cubre llamadas al SDK y peticiones directas al sidecar', () => {
    expect(used.routes).toContain('GET /session/{sessionID}/message') // client.session.messages (renderer)
    expect(used.routes).toContain('GET /session/{sessionID}/children') // run.client.session.children (main)
    expect(used.routes).toContain('GET /session/status') // fetch directo (monitor)
    expect(used.routes).toContain('GET /global/health') // fetch directo (util/net)
    expect(used.routes).toContain('POST /global/dispose')
  })

  it('el extractor resuelve alias, cadenas multilínea y descarta lo que no es el cliente', () => {
    const src = `
      const a = await client.session.get({ sessionID })
      client
        .find.files({ query })
      const b = getClient()?.global.dispose()
      api.pty.kill(id)
      // client.session.delete({})
      const c = store.session.list()
    `
    const calls = sdkCallsInSource(src, sdk.tree).map((c: { route: string }) => c.route)
    expect(calls.sort()).toEqual(['GET /find/file', 'GET /session/{sessionID}', 'POST /global/dispose'])
  })
})

describe('instantánea api-routes.json', () => {
  it('coincide en número de rutas con el SDK fijado (detecta desalineación al subir el pin)', () => {
    expect(sdk.routes.size).toBe(188)
    expect(snapshot.routeCount).toBe(snapshot.routes.length)
    // El motor propio de Lazunox añade dos rutas que el SDK oficial no conoce (panel de trabajos); el resto debe coincidir con el SDK.
    // Formularios de conectores (`elicitation`): rutas del motor propio; entran en la instantánea al regenerarla con el motor nuevo (antes no están).
    const FORMULARIOS = ['GET /mcp/elicitation', 'POST /mcp/elicitation/{requestID}/reply']
    // Rebobinar por turno: cinco rutas propias del motor (`/turnos` y `/rebobinar`).
    const REBOBINAR = [
      'GET /experimental/session/{sessionID}/rebobinar/{messageID}',
      'GET /experimental/session/{sessionID}/turnos',
      'GET /experimental/session/{sessionID}/turnos/{messageID}/diff',
      'POST /experimental/session/{sessionID}/rebobinar',
      'POST /experimental/session/{sessionID}/rebobinar/deshacer'
    ]
    const propias = snapshot.routes.filter(
      (r: string) => /\/experimental\/session\/[^\s]*\/trabajos/.test(r) || FORMULARIOS.includes(r) || REBOBINAR.includes(r)
    )
    const enSnapshot = propias.filter((r: string) => FORMULARIOS.includes(r))
    expect(enSnapshot.length === 0 || enSnapshot.length === FORMULARIOS.length).toBe(true) // las dos o ninguna
    expect(propias.filter((r: string) => !FORMULARIOS.includes(r)).sort()).toEqual(
      [
        ...REBOBINAR,
        'GET /experimental/session/{sessionID}/trabajos',
        'POST /experimental/session/{sessionID}/trabajos/{id}/terminar'
      ].sort()
    )
    expect(snapshot.routes.length - propias.length).toBe(sdk.routes.size)
    expect([...snapshot.routes].filter((r: string) => !propias.includes(r)).sort()).toEqual([...sdk.routes].sort())
  })

  it('contiene todas las rutas usadas y un resumen de esquema de cada una', () => {
    for (const r of used.routes) {
      expect(snapshot.routes, r).toContain(r)
      expect(snapshot.usedSchemas[r], r).toMatch(/^[0-9a-f]{16}$/)
    }
  })
})

describe('comparador', () => {
  const base = {
    used: ['GET /a', 'POST /b'],
    actual: ['GET /a', 'POST /b', 'GET /c'],
    snapshot: ['GET /a', 'POST /b', 'GET /c'],
    actualSchemas: { 'GET /a': 'h1', 'POST /b': 'h2' },
    snapshotSchemas: { 'GET /a': 'h1', 'POST /b': 'h2' }
  }

  it('sin cambios: 0', () => {
    expect(compareContract(base).code).toBe(0)
  })

  it('ruta usada que falta: 1 (aunque además cambie un esquema)', () => {
    const r = compareContract({ ...base, actual: ['GET /a', 'GET /c'], actualSchemas: { 'GET /a': 'otro' } })
    expect(r.code).toBe(1)
    expect(r.missing).toEqual(['POST /b'])
    expect(r.removed).toEqual(['POST /b'])
  })

  it('ruta nueva (no usada): 0, solo informativo', () => {
    const r = compareContract({ ...base, actual: [...base.actual, 'PUT /nueva'] })
    expect(r.code).toBe(0)
    expect(r.added).toEqual(['PUT /nueva'])
  })

  it('ruta eliminada que la app no usa: 0 e informada', () => {
    const r = compareContract({ ...base, actual: ['GET /a', 'POST /b'] })
    expect(r.code).toBe(0)
    expect(r.removed).toEqual(['GET /c'])
  })

  it('esquema cambiado en una ruta usada: 2 y dice cuál', () => {
    const r = compareContract({ ...base, actualSchemas: { 'GET /a': 'h1', 'POST /b': 'cambiado' } })
    expect(r.code).toBe(2)
    expect(r.changed).toEqual(['POST /b'])
  })
})
