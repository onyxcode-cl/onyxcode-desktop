/**
 * Variables del entorno de `opencode serve` que NO deben ver ni el shell (bash/pty) ni los MCP locales: contraseña y usuario del servidor,
 * credenciales y configuración inline, puerta del plan y canal del guardián de subagentes. UNA sola lista: `lazunox-env.js` (shell) y el
 * envoltorio de los MCP (`MCP_ENV_WRAPPER`) la derivan de aquí, para que no puedan divergir. Módulo sin dependencias a propósito.
 */
export const HIDDEN_SHELL_ENV = [
  'OPENCODE_SERVER_PASSWORD',
  'OPENCODE_SERVER_USERNAME',
  'OPENCODE_AUTH_CONTENT',
  'OPENCODE_CONFIG_CONTENT',
  'LAZUNOX_PLAN_GATE_URL',
  'LAZUNOX_GUARD_URL',
  'LAZUNOX_GUARD_TOKEN'
] as const
