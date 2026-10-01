import type { Messages } from '../index'
import type { settings as es } from '../es/settings'

export const settings = {} as const satisfies Messages<typeof es>
