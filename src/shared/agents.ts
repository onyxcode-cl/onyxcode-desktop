/**
 * Ids de los agentes de OpenCode de la app: ÚNICA fuente, compartida por main y renderer.
 * Las claves `agent.<id>.permission` del config inline (`main/cowork/inline-config.ts`) son
 * SEGURIDAD (deniegan MCP, aplican `external_directory` y las reglas recordadas): si el id que
 * pide el renderer no coincide con la clave, los permisos dejan de aplicarse sin aviso.
 * Deben coincidir con los ficheros de `resources/opencode/agents/<id>.md`.
 */
export const CHAT_AGENT_ID = 'chat'
/** Agente del modo Tareas (`resources/opencode/agents/tasks.md`). */
export const TASKS_AGENT_ID = 'tasks'
/** Agente del flujo Plan → Aprobar → Ejecutar (`resources/opencode/agents/computer.md`). */
export const COMPUTER_AGENT_ID = 'computer'
