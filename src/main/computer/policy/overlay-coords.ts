/**
 * Coordenadas de un evento de acción → píxeles CSS del overlay (C4). Puro.
 * macOS: las acciones llegan en puntos de pantalla = DIP de Electron; basta restar el origen del display principal (`toDip` nulo,
 * idéntico a lo de siempre). Windows: llegan en PÍXELES FÍSICOS del escritorio virtual (el helper trabaja en físicos) y se pasan a
 * DIP con `screen.screenToDipPoint` (DPI por monitor, origen posiblemente negativo) antes de restar el origen.
 */
import type { Point } from './geometry'

export type ToDip = (p: Point) => Point

export function overlayPoint(p: Point, origin: Point, toDip: ToDip | null): Point {
  const q = toDip ? toDip(p) : p
  return { x: q.x - origin.x, y: q.y - origin.y }
}
