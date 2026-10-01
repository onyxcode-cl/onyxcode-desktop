import type { Messages } from '../index'
import type { misc as es } from '../es/misc'

export const misc = {} as const satisfies Messages<typeof es>
