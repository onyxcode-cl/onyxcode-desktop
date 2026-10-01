import type { Messages } from '../index'
import type { notices as es } from '../es/notices'

export const notices = {} as const satisfies Messages<typeof es>
