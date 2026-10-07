/**
 * Banderas de COMPILACIÓN del producto (constantes, no ajustes del usuario).
 *
 * `TASKS_WIN_BUILD`: puerta de compilación de Tareas en Windows (WSL2). Es un LITERAL booleano en el repositorio y solo cambia en un
 * commit aparte, por decisión del dueño. Pasó a `true` el 2026-10-07 por decisión EXPRESA del dueño: Tareas y Control del PC salen
 * en Windows como BETA OPCIONAL (apagadas por defecto). La batería de ataques A1–A20 NO está completa y los informes de dos sesiones
 * no existen: la guardia de informes se sustituyó por la puerta de beta consentida (docs/WINDOWS-TAREAS.md, AGENTS.md §7). Con `true`,
 * `tasksWin` sigue siendo falsa mientras el usuario no acepte el consentimiento beta, la política no la cierre (`disableWslTasks`),
 * Lazunox corra elevado, o falten/no coincidan la imagen y la carga incluidas. Una guardia de pruebas lee este literal.
 */
export const TASKS_WIN_BUILD = true
