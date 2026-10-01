import type { Messages } from '../index'
import type { errors as es } from '../es/errors'

export const errors = {} as const satisfies Messages<typeof es>
