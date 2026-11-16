import { describe, expect, it, vi } from 'vitest'
import { classifyAutoCommand } from './auto-command'
import { decideAuto, permissionCommandPolicy, ReviewTracker } from './auto-review'

const deletes = [
  ['powershell', "@'\nbash <<'EOF'\nrm -- notas.txt\nEOF\n'@ | bash"],
  ['powershell', "@'\nrm -- notas.txt\n'@ | bash"],
  ['powershell', "'rm notas.txt' | bash"],
  ['bash', "echo 'rm notas.txt' | bash"],
  ['bash', "echo -e 'ls\\nrm notas.txt' | bash"],
  ['bash', "echo -n 'rm notas.txt' | bash"],
  ['powershell', "Write-Output -InputObject 'rm notas.txt' | bash"],
  ['bash', "bash <<'EOF'\nrm -- notas.txt\nEOF"],
  ['powershell', '@"\nrm -- notas.txt\n"@ | bash'],
  ['powershell', '@"\nRemove-Item notas.txt\n"@ | iex'],
  ['powershell', '@"\n$(Remove-Item notas.txt)\n"@ | bash'],
  ['powershell', '@"\n$(Remove-Item notas.txt)\n"@ | Write-Output'],
  ['powershell', "'Remove-Item notas.txt' | Invoke-Expression"],
  ['powershell', "Write-Output 'rm notas.txt' | wsl bash"],
  ['powershell', "'rm notas.txt' | wsl"],
  ['powershell', "'del notas.txt' | cmd"],
  ['cmd', 'echo del notas.txt | cmd'],
  ['bash', "printf '%s\\n' 'rm notas.txt' | sh"],
  ['bash', "printf '%s' 'rm ' 'notas.txt' | bash"],
  ['bash', "printf 'rm notas.txt\\n' | dash"],
  ['bash', "printf '%b' 'ls\\nrm notas.txt' | zsh"],
  ['bash', "cat <<'EOF' | bash\nrm notas.txt\nEOF"],
  ['powershell', "'Remove-Item notas.txt' | pwsh -Command -"],
  ['powershell', "'Remove-Item notas.txt' | powershell"],
  ['bash', 'echo "echo \'rm notas.txt\' | bash" | bash']
] as const

describe('V31 R3: stdin literal de un intérprete es código', () => {
  for (const root of ['/work/proyecto', 'C:/work/proyecto']) {
    for (const [shell, command] of deletes) {
      it(`${root}, ${shell}: ${command}`, async () => {
        const result = classifyAutoCommand(command, root, { shell })
        expect(result.verdict).toBe('hard')
        const reviewer = vi.fn(async () => ({ decision: 'allow' as const, reason: 'el usuario lo pidió' }))
        expect(await decideAuto(result, reviewer, new ReviewTracker(), 'session')).toEqual({ action: 'card' })
        expect(reviewer).not.toHaveBeenCalled()
        expect(permissionCommandPolicy({ permission: 'bash', metadata: { command, shell }, patterns: [] }, root).alwaysAsk).toBe(true)
      })
    }
    for (const [shell, command] of [
      ['powershell', '$script | bash'],
      ['powershell', 'Get-Content x.sh | bash'],
      ['powershell', '@"\n$script\n"@ | bash'],
      ['powershell', '"$(Get-Content x.sh)" | bash'],
      ['cmd', 'type x.bat | cmd'],
      ['bash', 'cat x.sh | bash'],
      ['bash', 'echo "$script" | bash'],
      ['bash', 'echo "$(cat x.sh)" | bash'],
      ['powershell', '$script | wsl bash'],
      ['powershell', '$script | pwsh -Command -']
    ]) {
      it(`entrada no literal: ${root}, ${command}`, () => {
        expect(classifyAutoCommand(command, root, { shell }).verdict).toBe('doubt')
      })
    }
    for (const [shell, command] of [
      ['powershell', "'ls' | bash"],
      ['powershell', '@"\nls\n"@ | bash'],
      ['powershell', "@'\nWrite-Output 'rm notas.txt'\n'@ | powershell"],
      ['powershell', "@'\n$(Remove-Item notas.txt)\n'@ | Write-Output"],
      ['bash', "echo 'ls' | bash"],
      ['bash', "cat <<'EOF'\nrm notas.txt\nEOF"]
    ]) {
      it(`texto inofensivo: ${root}, ${command}`, () => {
        expect(classifyAutoCommand(command, root, { shell }).verdict).not.toBe('hard')
      })
    }
    it(`la escritura exterior sigue siendo dura: ${root}`, () => {
      expect(classifyAutoCommand("echo 'echo hola > /otro/salida' | bash", root, { shell: 'bash' }).verdict).toBe('hard')
      expect(classifyAutoCommand("'Set-Content C:/otro/salida hola' | pwsh", root, { shell: 'powershell' }).verdict).toBe('hard')
    })
  }
})
