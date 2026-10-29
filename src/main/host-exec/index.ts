/** Instancia única de la herramienta `equipo` (comandos aprobados fuera del aislamiento) con la política gestionada de la organización. */
import { isHostCommandsDisabled, loadManagedPolicy } from '../tasks/policy'
import { HostExecMcpServer } from './mcp-server'

export { HOST_ROUTE_NAME } from './mcp-server'
export const hostExecMcp = new HostExecMcpServer({ enabled: () => !isHostCommandsDisabled(loadManagedPolicy()) })
