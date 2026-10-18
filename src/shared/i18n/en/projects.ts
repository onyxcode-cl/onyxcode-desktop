import type { Messages } from '../index'
import type { projects as es } from '../es/projects'

export const projects = {
  'projects.sidebar.title': 'Projects',
  'projects.sidebar.new': 'New project',
  'projects.sidebar.empty': 'Gather instructions and files in a project, and the AI will use them in its conversations.',
  'projects.sidebar.loading': 'Loading projects…',
  'projects.sidebar.error': 'Could not load the projects.',
  'projects.sidebar.retry': 'Try again',
  'projects.sidebar.open': 'Open the project {name}',
  'projects.sidebar.meta': {
    one: '{count} file',
    other: '{count} files'
  },

  'projects.new.title': 'New project',
  'projects.new.message': 'Give it a name. Then you can write instructions and add files.',
  'projects.new.placeholder': 'For example: 2026 contracts',
  'projects.new.confirm': 'Create',

  'projects.view.region': 'Project {name}',
  'projects.view.back': 'Back to chat',
  'projects.view.name': 'Project name',
  'projects.view.delete': 'Delete project',
  'projects.view.missing': 'This project no longer exists.',
  'projects.view.loading': 'Loading the project…',
  'projects.delete.title': 'Delete the project “{name}”?',
  'projects.delete.message':
    'The copies of its files and its index are deleted from this computer. Conversations are not deleted: they just leave the project. This cannot be undone.',
  'projects.delete.confirm': 'Delete project',
  'projects.privacy.title': 'What leaves your computer',
  'projects.privacy':
    'Files are copied to this computer and read here, without sending them to any service. When you ask something in a conversation of the project, only the project instructions and the pieces of the files that look like your question travel to the model you chose. Nothing else.',

  'projects.instr.title': 'Project instructions',
  'projects.instr.help':
    'How you want the AI to answer in this project. They apply to all its conversations. They are preferences: they do not change the rules of the app or grant permissions.',
  'projects.instr.placeholder': 'For example: Answer in formal English and always name the file each fact comes from.',
  'projects.instr.count': '{count} of {max} characters',
  'projects.instr.save': 'Save instructions',
  'projects.instr.saved': 'Instructions saved.',

  'projects.files.title': 'Knowledge files',
  'projects.files.add': 'Add files',
  'projects.files.hint': 'Drop PDF, Word, Excel, PowerPoint, text or Markdown files here, or use the button.',
  'projects.files.drop': 'Drop the files to add them to the project',
  'projects.files.empty.title': 'No files yet',
  'projects.files.empty.desc': 'Add what the AI should know in this project: contracts, reports, notes or spreadsheets.',
  'projects.files.count': '{count} of {max} files',
  'projects.files.used': 'Space used: {used} of {total}',
  'projects.files.limits':
    'Up to {files} files of {size} each, and {total} in total. If a file does not fit, it is not added and you will see the reason here; the others carry on. For a very long file only the beginning is read (about {chars} characters).',
  'projects.files.list': 'Project files',
  'projects.file.waiting': 'Waiting',
  'projects.file.reading': 'Reading…',
  'projects.file.ready': {
    one: 'Ready · {count} piece',
    other: 'Ready · {count} pieces'
  },
  'projects.file.readyPartial': 'Ready · only the beginning was read',
  'projects.file.error': 'Could not read it',
  'projects.file.remove': 'Remove {name}',
  'projects.file.removeHelp': 'Removes the file from the project and deletes its copy from this computer.',

  'projects.fail.unsupported': 'This kind of file cannot be used. Try PDF, Word, Excel, PowerPoint, text or Markdown.',
  'projects.fail.tooBig': 'It is larger than the limit per file.',
  'projects.fail.projectFull': 'The project has no space left. Remove a file and try again.',
  'projects.fail.tooManyFiles': 'The project already has the maximum number of files. Remove one and try again.',
  'projects.fail.reserved': 'It looks like a file with keys or secrets, and those are not added.',
  'projects.fail.encrypted': 'It has a password. Save it without a password and add it again.',
  'projects.fail.legacy': 'It is a very old format. Open it and save it as .docx or .pptx.',
  'projects.fail.corrupt': 'The file is damaged or is not the kind it claims to be.',
  'projects.fail.empty': 'It has no text to read.',
  'projects.fail.noText': 'It is only an image (no text). Try a version whose text can be selected.',
  'projects.fail.unreadable': 'The file could not be opened.',

  'projects.live.reading': 'Reading {name} ({index} of {total})…',
  'projects.live.done': {
    one: 'Done: {count} file added.',
    other: 'Done: {count} files added.'
  },
  'projects.live.doneSome': 'Done: {ok} added, {bad} could not be read.',
  'projects.live.none': 'No file could be added. See the reason for each one in the list.',
  'projects.live.dismiss': 'Close the summary',

  'projects.convs.title': 'Conversations in this project',
  'projects.convs.empty': 'There are no conversations in this project yet.',
  'projects.convs.new': 'New conversation in this project',
  'projects.convs.untitled': 'New conversation',

  'projects.chip.name': 'Project',
  'projects.chip.none': 'No project',
  'projects.chip.noneHint': 'This conversation does not use instructions or files from any project.',
  'projects.chip.hint': {
    one: '{count} knowledge file. It is used from your next message.',
    other: '{count} knowledge files. It is used from your next message.'
  },
  'projects.chip.new': 'New project…',
  'projects.chip.note': 'You can change it any time. Earlier answers do not change.',

  'projects.err.tooMany': 'You reached the maximum of {max} projects. Delete one to create another.',
  'projects.err.notFound': 'That project no longer exists.',
  'projects.err.invalid': 'The name is not valid.',
  'projects.err.expired': 'The file selection expired. Choose the files again.',
  'projects.err.unknown': 'The action could not be completed. Try again.',
  'projects.err.close': 'Close the notice',

  'projects.dialog.title': 'Choose the project files',
  'projects.dialog.filter': 'Documents',
  'projects.dialog.all': 'All files'
} as const satisfies Messages<typeof es>
