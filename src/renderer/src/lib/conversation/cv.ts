/**
 * `content-visibility: auto` en las listas de mensajes (F7-B46). Solo las filas ANTIGUAS reciben la clase: las
 * últimas `CV_RECENT` (donde está el pegado al final y el streaming) se maquetan siempre con su alto real.
 */
export const CV_RECENT = 8

/** ¿La fila `index` de `total` es antigua (candidata a saltarse la maquetación fuera de pantalla)? */
export function isOldRow(index: number, total: number, recent = CV_RECENT): boolean {
  return index < total - recent
}

/**
 * `base` + las clases de la fila. `turn-row` va en TODAS: `contain-intrinsic-size: auto` solo recuerda el alto real de lo
 * que ya lo tenía declarado, y sin ello una fila que pasa a antigua (y se salta) saltaba de golpe a la estimación y hacía
 * perder el pegado al final. `turn-cv` (`content-visibility: auto`) solo en las antiguas. `pad`: la fila tiene
 * márgenes negativos/hover que sobresalen del recorte de `contain: paint`.
 */
export function withCv(base: string, old: boolean, pad = false): string {
  return `${base} turn-row${old ? ' turn-cv' : ''}${pad ? ' turn-cv-pad' : ''}`
}
