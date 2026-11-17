import { describe, expect, it, vi } from 'vitest'
import { classifyAutoCommand } from './auto-command'
import { decideAuto, permissionCommandPolicy, ReviewTracker } from './auto-review'
import { allVariableDeletes } from './fixtures/auto-command-var'

describe('V31 R4: variables y red de seguridad de borrados dinámicos', () => {
  for (const root of ['/work/proyecto', 'C:/work/proyecto']) {
    it.each(allVariableDeletes)(`${root}, %s: %s`, async (shell, command) => {
      const result = classifyAutoCommand(command, root, { shell })
      expect(result.verdict).toBe('hard')
      const reviewer = vi.fn(async () => ({ decision: 'allow' as const, reason: 'el usuario pidió borrarlo' }))
      expect(await decideAuto(result, reviewer, new ReviewTracker(), 'session')).toEqual({ action: 'card' })
      expect(reviewer).not.toHaveBeenCalled()
      expect(permissionCommandPolicy({ permission: 'bash', metadata: { command, shell }, patterns: [] }, root).alwaysAsk).toBe(true)
    })
    it.each([
      ['powershell', `$x = 'Get-ChildItem'; iex $x`],
      ['bash', `c='ls -la'; eval "$c"`],
      ['bash', `echo 'remove item from list'`],
      ['bash', `python3 - <<'PY'\ndel self.stack[i:]\nPY`],
      ['bash', `python3 - <<'PY'\n# eval rm Remove-Item\ndel self.stack[i:]\nPY\neval "$unknown"`],
      ['bash', `node <<'JS'\n// iex rm Remove-Item\ndelete list.item;\nJS\neval "$unknown"`],
      ['powershell', `$x = 'rm x'`],
      ['bash', `c='rm x'`]
    ])(`inofensivo ${root}, %s: %s`, (shell, command) => {
      expect(classifyAutoCommand(command, root, { shell }).verdict).not.toBe('hard')
    })
    it.each(['Clear-Content x', 'Remove-ItemProperty x'])(`borrado literal ${root}: %s`, (action) => {
      expect(classifyAutoCommand(`iex '${action}'`, root, { shell: 'powershell' }).verdict).toBe('hard')
      expect(classifyAutoCommand(`'${action}' | pwsh`, root, { shell: 'powershell' }).verdict).toBe('hard')
    })
    it('archivo desconocido sin borrado visible sigue siendo duda', () => {
      expect(classifyAutoCommand('Get-Content limpia.ps1 | iex', root, { shell: 'powershell' }).verdict).toBe('doubt')
    })
    // Sin ninguna palabra de borrado: prueba la propagación, independientemente de la red de seguridad.
    it.each([
      ['bash', `c='touch /otro/salida'; eval "$c"`],
      ['bash', `c='touch /otro/salida'; bash -c "$c"`],
      ['bash', `export c='touch /otro/salida'; sh -c "$c"`],
      ['bash', `c='touch /otro/salida'; echo "$c" | sh`],
      ['powershell', `$x = 'Set-Content C:/otro/salida hola'; iex $x`],
      ['powershell', `$x='Set-Content C:/otro/salida hola'; $x | pwsh`],
      ['powershell', `$x = @'\nSet-Content C:/otro/salida hola\n'@; iex $x`],
      ['powershell', `$x=@'\nSet-Content C:/otro/salida hola\n'@; iex $x`],
      ['powershell', `$x= 'Set-Content C:/otro/salida hola'; iex $x`],
      ['powershell', `$x = 'Set-Content C:/otro/salida hola'; $y = $x; iex $y`],
      ['powershell', `Set-Variable -Name x -Value 'Set-Content C:/otro/salida hola'; iex $x`],
      ['powershell', `$x='Set-Content C:/otro/salida hola'; & ([scriptblock]::Create($x))`],
      ['powershell', `$x='Set-Content C:/otro/salida hola'; . ([scriptblock]::Create($x))`],
      ['powershell', `$x='echo hola > C:/otro/salida'; cmd /c $x`],
      ['powershell', `Set-Variable x 'Set-Content C:/otro/salida hola'; iex $x`],
      ['powershell', `& ([scriptblock]::Create('Set-Content C:/otro/salida hola'))`]
    ])(`propaga código fijo ${root}, %s: %s`, (shell, command) => {
      expect(classifyAutoCommand(command, root, { shell }).verdict).toBe('hard')
    })
    it.each([
      ['bash', `c='touch /otro/salida'; c='ls'; eval "$c"`],
      ['bash', `c='touch /otro/salida'; c="$unknown"; eval "$c"`],
      ['powershell', `$x='Set-Content C:/otro/salida hola'; $x='Get-ChildItem'; iex $x`],
      ['powershell', `$x='Set-Content C:/otro/salida hola'; $x=Get-Content script.ps1; iex $x`]
    ])(`no reutiliza valores anteriores ${root}, %s: %s`, (shell, command) => {
      expect(classifyAutoCommand(command, root, { shell }).verdict).not.toBe('hard')
    })
  }
})

describe('V31 R4: el programa sale de una variable', () => {
  for (const command of ["CMD='rm notas.txt'; $CMD", 'a=rm; $a notas.txt'])
    it(`borrado visible con programa calculado: ${command}`, () => {
      expect(classifyAutoCommand(command, '/Users/x/proyecto', { shell: 'bash', externalDirectories: [] }).verdict).toBe('hard')
    })
  for (const command of ["c='git status'; $c", 'X=ls; $X -la'])
    it(`inofensivo con programa calculado no es hard: ${command}`, () => {
      expect(classifyAutoCommand(command, '/Users/x/proyecto', { shell: 'bash', externalDirectories: [] }).verdict).not.toBe('hard')
    })
})
