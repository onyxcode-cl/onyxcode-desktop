// Flag de fallo inyectable para el harness E2E (solo DEV). Lógica pura, sin React ni DOM.
export type FaultMode = string | null

let current: FaultMode = null
const listeners = new Set<() => void>()

export function getFault(): FaultMode {
  return current
}

export function setFault(mode: FaultMode): void {
  if (mode === current) return
  current = mode
  for (const l of [...listeners]) l()
}

export function subscribeFault(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** True si hay que lanzar en la vista `mode` (el flag coincide o es '*'). */
export function shouldThrow(flag: FaultMode, mode: string): boolean {
  return flag !== null && (flag === mode || flag === '*')
}
