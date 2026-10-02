/**
 * Lanzador SOLO PARA PRUEBAS: el OpenCode falso de los E2E es un script (`.mjs`). En Windows no se puede
 * ejecutar un script directamente (no hay shebang), así que se lanza con `node <mjs>`. Nunca aplica a la
 * app empaquetada ni a un binario real (`opencode.exe`).
 */
export function testLauncher(
  command: string,
  args: string[],
  opts: { isPackaged: boolean; platform?: NodeJS.Platform }
): { command: string; args: string[] } {
  const platform = opts.platform ?? process.platform
  if (!opts.isPackaged && platform === 'win32' && command.toLowerCase().endsWith('.mjs'))
    return { command: 'node', args: [command, ...args] }
  return { command, args }
}
