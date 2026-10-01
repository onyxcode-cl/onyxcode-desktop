import type { Messages } from '../index'
import type { wizard as es } from '../es/wizard'

export const wizard = {} as const satisfies Messages<typeof es>
