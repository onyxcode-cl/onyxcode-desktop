import type { Messages } from '../index'
import type { chat as es } from '../es/chat'

export const chat = {} as const satisfies Messages<typeof es>
