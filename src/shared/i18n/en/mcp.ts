import type { Messages } from '../index'
import type { mcp as es } from '../es/mcp'

export const mcp = {} as const satisfies Messages<typeof es>
