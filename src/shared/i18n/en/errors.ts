import type { Messages } from '../index'
import type { errors as es } from '../es/errors'

export const errors = {
  'errors.noAi.title': 'You haven’t connected an AI yet',
  'errors.noAi.body':
    'To send messages you need to connect an AI: your OpenCode Go subscription or another provider’s key. It only takes a minute.',
  'errors.yourAi': 'your AI',
  'errors.context.title': 'This conversation is too long',
  'errors.context.message': 'Compact it or start a new conversation to keep going.',
  'errors.modelNotFound.title': 'The selected model isn’t available',
  'errors.modelNotFound.fallbackId': 'the model',
  'errors.modelNotFound.message': '“{id}” doesn’t belong to any connected AI. Choose another model or connect an AI.',
  'errors.auth.title': 'The AI rejected the connection',
  'errors.auth.message': 'The key or session for {provider} is invalid or has expired. Reconnect it in Settings › Models.',
  'errors.quota.title': 'Usage limit reached',
  'errors.quota.message': 'Your AI has reached its usage or quota limit. Wait a few minutes or check your plan.',
  'errors.network.title': 'No connection',
  'errors.network.message': 'Couldn’t reach the AI. Check your internet connection and try again.',
  'errors.system.permission':
    'A file or folder couldn’t be accessed because permission is missing. Make sure it is inside the chosen folder, or give the app access, and try again.',
  'errors.system.missing':
    'A file or folder that was needed couldn’t be found. Check that it is still where it was and try again.',
  'errors.system.noSpace':
    'There is no free space left on the disk. Free up some space and try again.',
  'errors.system.busy':
    'Another program is using the file, or too many are open at once. Close them or wait a moment and try again.',
  'errors.system.exists':
    'A file or folder with that name already exists. Pick another name or remove the extra one and try again.',
  'errors.system.unreadable':
    'The reply arrived incomplete or in a format that couldn’t be read. Try again.',
  'errors.unknown.title': 'Something went wrong',
  'errors.unknown.message': 'An unexpected error happened. Try again; if it keeps happening, open “View details” and share it with support.'
} as const satisfies Messages<typeof es>
