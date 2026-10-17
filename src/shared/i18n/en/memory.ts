/** Custom instructions and memory for Chat and Code. */
import type { Messages } from '../index'
import type { memory as es } from '../es/memory'

export const memory = {
  'settings.nav.instructions': 'Instructions',
  'settings.nav.memory': 'Memory',

  'instr.title': 'Custom instructions',
  'instr.intro':
    'Tell the AI how you want it to answer and what it should know about you. They are sent with every Chat and Code message, to whichever model you have connected.',
  'instr.global.label': 'For Chat and Code',
  'instr.global.placeholder': 'For example: always answer me in English and keep it short. I am a designer and I do not code.',
  'instr.global.help':
    'They are saved on this computer and travel to the connected model along with your messages, just like what you type in the chat. Do not put keys or anything you would not share with it. They do not change the security rules or permissions.',
  'instr.global.count': '{count} of {max} characters',
  'instr.saved': 'Saved',
  'instr.project.title': 'Instructions for a Code project',
  'instr.project.intro':
    'This is the AGENTS.md file in the project folder: Code reads it on its own when it works there. What you write is saved in that folder and will travel with it if you share it or push it to a repository.',
  'instr.project.folder': 'Project',
  'instr.project.none': 'Open a project in Code to see and edit its instructions.',
  'instr.project.path': 'Saved to {path}',
  'instr.project.willCreate': 'This folder does not have the file yet; it will be created when you save.',
  'instr.project.edit': 'Edit',
  'instr.project.preview': 'Preview',
  'instr.project.previewEmpty': 'Nothing to show yet.',
  'instr.project.placeholder': 'For example: use pnpm, write tests with Vitest and do not touch the dist folder.',
  'instr.project.save': 'Save to the folder',
  'instr.project.saving': 'Saving…',
  'instr.project.saved': 'Saved to the project folder',
  'instr.project.failed': 'Could not save: {error}',
  'instr.project.loadFailed': 'Could not read the file: {error}',
  'instr.open': 'Instructions and memory',

  'memory.title': 'Memory',
  'memory.intro':
    'What the AI remembers about you and your projects between conversations. The AI can only propose a note; nothing is saved until you approve it, and you can edit or delete it whenever you want.',
  'memory.toggle': 'Use memory',
  'memory.toggleDesc':
    'When off, the AI does not receive your notes and does not propose new ones in Chat, Code and Overdrive. It does not delete what is already saved.',
  'memory.privacy':
    'Notes are saved only on this computer and go through a filter that drops keys and passwords. They leave only toward the model you have connected, together with your message, like the rest of the conversation. «For everything» notes are shared across Chat, Code and Overdrive.',
  'memory.scope.usuario': 'For everything',
  'memory.scope.proyecto': 'For a project',
  'memory.project.label': 'Project',
  'memory.project.none': 'Open a project in Code to see its memory.',
  'memory.search': 'Search memory',
  'memory.empty.usuario': 'No notes saved yet. When the AI proposes one and you approve it, it will show up here.',
  'memory.empty.proyecto': 'This project has no saved notes yet.',
  'memory.noMatch': 'No note matches your search.',
  'memory.count': '{count} of {max} notes',
  'memory.edit': 'Edit',
  'memory.editAria': 'Edit this note',
  'memory.save': 'Save',
  'memory.cancel': 'Cancel',
  'memory.delete': 'Delete this note',
  'memory.err.secreto': 'That text looks like it contains a key or password, so it is not saved.',
  'memory.err.duplicado': 'An identical note already exists.',
  'memory.err.generic': 'Could not save the change.',
  'memory.forgetAll': 'Forget everything',
  'memory.forgetAllTitle': 'Forget all memory?',
  'memory.forgetAllMsg':
    'This deletes every «for everything» note and every project note, in Chat, Code and Overdrive. It cannot be undone.',
  'memory.forgetAllConfirm': 'Forget everything',
  'memory.open': 'Manage memory',

  'memory.card.title': 'The AI suggests remembering this',
  'memory.card.hint': 'Choose what to save, edit the text if you like, or dismiss. Nothing is saved without your approval.'
} as const satisfies Messages<typeof es>
