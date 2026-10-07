/**
 * Banderas de COMPILACIÓN del producto (constantes, no ajustes del usuario).
 *
 * `TASKS_WIN_BUILD`: puerta de compilación de Tareas en Windows (WSL2). Es un LITERAL booleano en el repositorio y solo cambia en un
 * commit aparte, por decisión del dueño. Pasó a `true` el 2026-10-07 por decisión EXPRESA del dueño: Tareas y Control del PC salen
 * en Windows ACTIVAS DE ENTRADA, igual que en macOS. Ese mismo día se probó primero con un consentimiento beta opcional, pero el
 * dueño pidió quitarlo del todo («no quiero nada beta»): no hay interruptor ni aviso que aceptar. La batería de ataques A1–A20
 * sigue sin estar completa y los informes de dos sesiones no existen; lo que protege el arranque es solo la puerta de integridad
 * de `win-provider.ts` (`gate()`: Lazunox no elevado, paquete incluido íntegro, `state.json` coherente) y la política de la
 * organización (`disableWslTasks`). Una guardia de pruebas lee este literal.
 */
export const TASKS_WIN_BUILD = true
