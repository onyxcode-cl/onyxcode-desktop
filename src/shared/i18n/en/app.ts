import type { Messages } from '../index'
import type { app as es } from '../es/app'

export const app = {} as const satisfies Messages<typeof es>
