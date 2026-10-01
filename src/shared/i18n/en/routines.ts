import type { Messages } from '../index'
import type { routines as es } from '../es/routines'

export const routines = {} as const satisfies Messages<typeof es>
