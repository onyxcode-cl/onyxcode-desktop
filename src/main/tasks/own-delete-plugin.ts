/** Gancho del motor: main borra el lote validado; bash conserva las comprobaciones posteriores. */
export function ownDeletePluginSource(): string {
  return `// Generado por la app; ver src/main/tasks/own-delete-plugin.ts.
const URL = process.env.LAZUNOX_OWN_DELETE_URL || ''
const TOKEN = process.env.LAZUNOX_OWN_DELETE_TOKEN || ''
export default {
  id: 'lazunox-own-delete',
  server: async () => {
    const done = new Set()
    return !URL || !TOKEN ? {} : ({
    'tool.execute.before': async (input, output) => {
      if (input.tool !== 'bash' || !output || !output.args || typeof output.args.command !== 'string') return
      const command = output.args.command
      if (!/\\b(?:rm|rmdir|unlink)\\s/.test(command)) return
      let r
      try {
        r = await fetch(URL, {
          method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: input.sessionID, callId: input.callID, command, workdir: output.args.workdir }),
          redirect: 'error', signal: AbortSignal.timeout(10000)
        })
      } catch {
        // Una respuesta perdida puede llegar DESPUÉS del borrado: nunca ejecutar otra vez el original.
        throw new Error('No se pudo confirmar la limpieza de la tarea. Comprueba sus archivos antes de reintentar.')
      }
      if (!r.ok) throw new Error('No se pudo completar la limpieza de la tarea.')
      const result = await r.json()
      if (result && result.deleted === true) {
        output.args.command = typeof result.command === 'string' ? result.command : ':'
        if (done.size >= 5000) done.clear()
        done.add(input.sessionID + ':' + input.callID)
      }
    },
    'tool.execute.after': async (input, output) => {
      const key = input.sessionID + ':' + input.callID
      if (input.tool === 'bash' && done.delete(key)) {
        output.metadata = { ...output.metadata, lazunoxOwnDelete: true }
      }
    }
  })
  }
}
`
}
