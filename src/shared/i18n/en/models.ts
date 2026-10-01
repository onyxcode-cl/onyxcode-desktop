import type { Messages } from '../index'
import type { models as es } from '../es/models'

export const models = {} as const satisfies Messages<typeof es>
