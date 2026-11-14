/** V28 ronda 3: órdenes transcritas de las capturas Windows; solo se cambia la raíz personal. */
export function round3Commands(root: string): Array<{ command: string; tool: string; allowed: boolean }> {
  return [
    {
      command: `foreach ($p in 'index.html','menu.html','contacto.html') { $html = (Invoke-WebRequest -UseBasicParsing "http://localhost:8765/$p").Content; $links = [regex]::Matches($html, 'href="([^"]+)"') | ForEach-Object { $_.Groups[1].Value } | Where-Object { $_ -notmatch '^(https?:|#)' } | Sort-Object -Unique; foreach ($l in $links) { try { $s = (Invoke-WebRequest -UseBasicParsing "http://localhost:8765/$l").StatusCode } catch { $s = 'ERROR' }; "$p -> $l : $s" } }`,
      tool: 'bash',
      allowed: true
    },
    ...['bash', 'todowrite', 'bash'].map((tool) => ({ command: 'python -m unittest discover -s tests -v', tool, allowed: true })),
    ...['echo "Código de salida: $LASTEXITCODE"', 'Write-Output "---EXIT $LASTEXITCODE"'].map((end) => ({
      command: `python -m unittest discover -s tests -v 2>&1; ${end}`,
      tool: 'bash',
      allowed: true
    })),
    {
      command: `$html = Get-Content -Raw '${root}\\contacto.html'; $js = [regex]::Match($html, '<script>([\\s\\S]*?)</script>').Groups[1].Value; Set-Content -Path "$env:TEMP\\check_contacto.js" -Value $js; node --check "$env:TEMP\\check_contacto.js"; if ($?) { 'JS sintaxis OK' }; Get-NetTCPConnection -LocalPort 8765 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }; Remove-Item "$env:TEMP\\check_contacto.js"`,
      tool: 'bash',
      allowed: false
    }
  ]
}
