/**
 * Registro dinámico de acciones: un componente declara aquí qué hace una acción mientras está montado (sin importar los
 * stores ni los modos: es seguro de importar desde cualquier feature sin ciclos). Ver `runtime.ts` para las integradas.
 */
export interface ActionHandler {
  /** Devuelve `false` si en este momento no hace nada (el evento no se consume y puede probar otra acción). */
  run: () => boolean | void
  /** ¿Está disponible ahora? Si no, el atajo no se consume. */
  enabled?: () => boolean
  /** `false`: no llama a `preventDefault` (p. ej. Esc, que otros diálogos también escuchan). Por defecto `true`. */
  consume?: boolean
}

const dynamic = new Map<string, ActionHandler>()

/** Registra la ejecución de una acción mientras el componente está montado (tiene prioridad sobre la integrada). */
export function registerAction(id: string, handler: ActionHandler): () => void {
  dynamic.set(id, handler)
  return () => {
    if (dynamic.get(id) === handler) dynamic.delete(id)
  }
}

export function dynamicHandler(id: string): ActionHandler | undefined {
  return dynamic.get(id)
}
