/**
 * Marcas de tiempo del arranque de la PWA (`performance.mark`, prefijo `lazunox:`). Solo viven en el teléfono: no se envían a
 * ninguna parte. Se leen desde la consola remota con `__lazunoxPerf()` → `[[nombre, ms], …]` (ver docs/MOBILE-UI.md).
 */
export function mark(name: string): void {
  try {
    performance.mark(`lazunox:${name}`)
  } catch {
    /* sin Performance API: no pasa nada */
  }
}

/** Instala `globalThis.__lazunoxPerf`. */
export function installPerfReader(): void {
  ;(globalThis as { __lazunoxPerf?: () => Array<[string, number]> }).__lazunoxPerf = () =>
    performance
      .getEntriesByType('mark')
      .filter((m) => m.name.startsWith('lazunox:'))
      .map((m): [string, number] => [m.name, Math.round(m.startTime)])
}
