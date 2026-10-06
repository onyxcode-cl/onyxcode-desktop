/**
 * Banderas de COMPILACIÓN del producto (constantes, no ajustes del usuario).
 *
 * `TASKS_WIN_BUILD`: puerta de compilación de Tareas en Windows (WSL2). Va `false` como LITERAL en el repositorio
 * y solo se pone a `true` en el commit que cierra la puerta, tras pasar la batería de ataques en el PC y con la
 * decisión del dueño (docs/WINDOWS-TAREAS.md, plan «Parte B» §1.1). Una guardia de pruebas lee este literal.
 * Con `false`, `tasksWin` es siempre falsa aunque el usuario la pida, aunque exista `LAZUNOX_TASKS_WIN=1`
 * o aunque no haya política.
 */
export const TASKS_WIN_BUILD = false
