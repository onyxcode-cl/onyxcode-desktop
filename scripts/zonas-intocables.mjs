#!/usr/bin/env node
// Uso: npm run zonas:actualizar -- "motivo del cambio en una frase"
// Registra las huellas actuales de las zonas intocables y anota quién/por qué en `docs/zonas-intocables.json`.
import { readFileSync, writeFileSync } from 'node:fs'
import { MANIFIESTO, diferencias, huellasActuales, leerManifiesto } from './zonas-intocables-lib.mjs'

const motivo = process.argv.slice(2).join(' ').trim()
let previo = { huellas: {}, historial: [] }
try {
  previo = leerManifiesto()
} catch {
  /* primer registro */
}
const actuales = huellasActuales()
const d = diferencias(previo, actuales)
const total = d.cambiados.length + d.nuevos.length + d.desaparecidos.length
if (total === 0) {
  console.log('Sin cambios en las zonas intocables.')
  process.exit(0)
}
if (motivo.length < 15) {
  console.error('Escribe el motivo del cambio (mínimo 15 caracteres): npm run zonas:actualizar -- "por qué cambian"')
  console.error('Cambian: ' + [...d.cambiados, ...d.nuevos, ...d.desaparecidos].join(', '))
  process.exit(2)
}
const historial = [
  ...(previo.historial ?? []),
  { fecha: new Date().toISOString().slice(0, 10), motivo, cambiados: d.cambiados, nuevos: d.nuevos, desaparecidos: d.desaparecidos }
].slice(-200)
writeFileSync(
  MANIFIESTO,
  JSON.stringify({ aviso: 'Generado por scripts/zonas-intocables.mjs. No editar a mano.', huellas: actuales, historial }, null, 2) + '\n'
)
console.log(`Registrado: ${total} archivo(s). Motivo: ${motivo}`)
void readFileSync
