// T30 — Dos escrituras simultáneas al MISMO archivo en el mismo paso (dos rondas de dos `edit` en una sola respuesta cada una; la segunda ronda
// toca líneas contiguas). Mide: paralelismo seguro (7.3): si el motor ejecuta las llamadas a la vez sin serializar las del mismo archivo, una
// escritura puede pisar a la otra y se pierde un cambio. El verificador exige los cuatro cambios y nada más.
import { escribir, falla, leer, ok } from '../lib.mjs'
import { editar } from './_pasos.mjs'

const INICIAL = ['nombre=pagos', 'puerto=8080', 'modo=lectura', 'reintentos=3', 'timeout=30', 'region=norte', 'log=info', 'cache=off', 'version=1'].join('\n') + '\n'
const FINAL = ['nombre=pagos', 'puerto=9090', 'modo=lectura', 'reintentos=5', 'timeout=60', 'region=norte', 'log=info', 'cache=off', 'version=2'].join('\n') + '\n'

export default {
  id: 'T30',
  nombre: 'Dos escrituras simultáneas al mismo archivo',
  mide: 'Paralelismo seguro (escrituras al mismo archivo en el mismo paso)',
  categoria: 'programacion',
  pedidos: [
    'En `servicio.conf` haz cuatro cambios: `puerto=8080` → `puerto=9090`, `version=1` → `version=2`, `reintentos=3` → `reintentos=5` y `timeout=30` → `timeout=60`. Pide los cambios de dos en dos, en la misma ronda de llamadas (puerto y versión juntos; reintentos y timeout juntos). Al final no puede faltar ninguno.'
  ],
  preparar(dir) {
    escribir(dir, 'servicio.conf', INICIAL)
  },
  verificar(dir) {
    const t = leer(dir, 'servicio.conf').replace(/\r\n/g, '\n')
    if (t === FINAL) return ok()
    const a = t.split('\n')
    const e = FINAL.split('\n')
    for (let i = 0; i < Math.max(a.length, e.length); i++) if (a[i] !== e[i]) return falla(`servicio.conf línea ${i + 1}: «${a[i] ?? ''}» ≠ «${e[i] ?? ''}»`)
    return falla('servicio.conf no coincide')
  },
  guion: (dir) => ({
    turnos: [
      [
        { paralelo: [editar(dir, 'servicio.conf', 'puerto=8080', 'puerto=9090'), editar(dir, 'servicio.conf', 'version=1', 'version=2')] },
        { paralelo: [editar(dir, 'servicio.conf', 'reintentos=3', 'reintentos=5'), editar(dir, 'servicio.conf', 'timeout=30', 'timeout=60')] }
      ]
    ],
    final: 'Hice los cuatro cambios en servicio.conf.'
  })
}
