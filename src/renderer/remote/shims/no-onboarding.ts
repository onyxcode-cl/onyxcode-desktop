/** El asistente de primer arranque no corre en el celular: el Mac ya está configurado (sus pasos usan diálogos nativos). */
export function OnboardingGate(): null {
  return null
}

/** La revisión de arranque tampoco corre en el celular: deja pasar a los hijos tal cual. */
export function PreflightGate({ children }: { children?: React.ReactNode }): React.JSX.Element {
  return children as React.JSX.Element
}
