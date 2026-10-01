import type { Messages } from '../index'
import type { main as es } from '../es/main'

export const main = {} as const satisfies Messages<typeof es>
