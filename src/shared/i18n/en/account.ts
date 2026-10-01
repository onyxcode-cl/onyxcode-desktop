import type { Messages } from '../index'
import type { account as es } from '../es/account'

export const account = {} as const satisfies Messages<typeof es>
