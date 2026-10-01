import type { Messages } from '../index'
import type { browser as es } from '../es/browser'

export const browser = {} as const satisfies Messages<typeof es>
