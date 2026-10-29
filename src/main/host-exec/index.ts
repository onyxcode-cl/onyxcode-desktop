/**
 * Instancia única de la herramienta `equipo` (comandos aprobados fuera del aislamiento) con la política gestionada de la organización.
 * Las variables de la Bóveda del proyecto entran SOLO al proceso que se lanza y sus valores se tapan en lo que vuelve a la IA.
 */
import { isHostCommandsDisabled, loadManagedPolicy } from '../tasks/policy'
import { projectProfiles } from '../project-profile'
import { HostExecMcpServer } from './mcp-server'

export { HOST_ROUTE_NAME } from './names'
export const hostExecMcp = new HostExecMcpServer({
  enabled: () => !isHostCommandsDisabled(loadManagedPolicy()),
  envFor: (folder) => projectProfiles().envFor(folder),
  redact: (folder, text) => projectProfiles().redact(folder, text)
})
