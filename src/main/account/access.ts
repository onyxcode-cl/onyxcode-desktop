/**
 * Punto único para preguntar «¿la cuenta deja usar la app?» desde partes de main que no deben
 * conocer el servicio (Quick Entry, atajo global, bandeja). Por defecto SIEMPRE true: mientras
 * nadie registre el servicio (cuenta apagada o pruebas), nada se bloquea.
 */
let check: () => boolean = () => true

/** Lo registra `ipc/account.ts` al crear el servicio. */
export function setAccountAccessCheck(fn: (() => boolean) | null): void {
  check = fn ?? (() => true)
}

export function isAccountAllowed(): boolean {
  try {
    return check()
  } catch {
    return false // ante un fallo del servicio de cuenta, cerrado
  }
}

/** Envuelve una acción para que solo corra con la cuenta al día (atajo global, bandeja). */
export function whenAccountAllowed<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  return (...args) => {
    if (isAccountAllowed()) fn(...args)
  }
}
