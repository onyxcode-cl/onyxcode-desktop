/**
 * Marcas de tiempo del arranque de la PWA (`performance.mark`, prefijo `onyx:`). Solo viven en el teléfono: no se envían a
 * ninguna parte. Se leen desde la consola remota con `__onyxPerf()` → `[[nombre, ms], …]` (ver docs/MOBILE-UI.md).
 */
export function mark(name: string): void {
  try {
    performance.mark(`onyx:${name}`)
  } catch {
    /* sin Performance API: no pasa nada */
  }
}

/** Instala `globalThis.__onyxPerf`. */
export function installPerfReader(): void {
  ;(globalThis as { __onyxPerf?: () => Array<[string, number]> }).__onyxPerf = () =>
    performance
      .getEntriesByType('mark')
      .filter((m) => m.name.startsWith('onyx:'))
      .map((m): [string, number] => [m.name, Math.round(m.startTime)])
}
