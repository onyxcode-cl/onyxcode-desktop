import type { Messages } from '../index'
import type { search as es } from '../es/search'

export const search = {
  'search.group.messages': 'Inside your conversations',
  'search.mode.chat': 'Chat',
  'search.mode.code': 'Code',
  'search.role.user': 'You',
  'search.role.assistant': 'AI',
  'search.titleMatch': 'Matches the name',
  'search.more': { one: 'and 1 more message in this conversation', other: 'and {count} more messages in this conversation' },
  'search.hitAria': '{role}, {date}: {snippet}. Conversation "{title}".',
  'search.count': {
    one: '1 message found in {groups} conversations',
    other: '{count} messages found in {groups} conversations'
  },
  'search.countOneGroup': { one: '1 message found in 1 conversation', other: '{count} messages found in 1 conversation' },
  'search.none': 'No messages with "{query}"',
  'search.preparing': 'Getting search ready for your messages… {done} of {total} conversations',
  'search.partial': 'Some conversations are still being read; results may be missing.',
  'search.error': 'Could not read your history to search inside messages. Searching by name only.',
  'search.failedSome': { one: 'Could not read 1 conversation.', other: 'Could not read {count} conversations.' },
  'search.scope':
    'Searches your {total} most recent Chat conversations and those of the projects open in Code. Everything stays on this computer.',
  'search.clear': 'Clear what was read',
  'search.clearTitle': 'Removes the text prepared for searching from memory. It is prepared again the next time you search.',
  'search.cleared': 'Done: the text prepared for searching was cleared.'
} as const satisfies Messages<typeof es>
