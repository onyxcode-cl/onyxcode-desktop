/** Reconocimiento orientativo para explicar el permiso de carpeta; nunca concede acceso ni sustituye al aislamiento. */
const DELETE_VERB_RE =
  /(^|[\s/;&|(`'"=])(rm|rmdir|unlink|mv|rename|trash|shred)(\s|$|;|&|\||:)|\s-delete\b|--delete\b|--remove-source-files|\b(remove-item|move-item|rename-item)\b|\bgit\s+(clean|checkout|reset|restore|switch|rm|mv|stash)\b|\b(os|shutil|fs|pathlib)\.[\w.]*(remove|unlink|rmdir|rmtree|rename|replace|move|rm)\w*|\.(unlink|rmdir|rename|replace|rmtree|move|remove)(Sync)?\s*\(/i

export function needsDeleteGrant(command: string): boolean {
  return DELETE_VERB_RE.test(command)
}
