import type { Messages } from '../index'
import type { code as es } from '../es/code'

export const code = {} as const satisfies Messages<typeof es>
