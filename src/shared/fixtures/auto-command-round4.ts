/** V28 ronda 4: transcripción de las tarjetas final2, cambiando solo la raíz personal. */
export function round4Commands(root: string): Array<{ command: string; tool: string; allowed: boolean }> {
  return [
    {
      command: `$dir = "${root}"; Get-ChildItem $dir -Name; foreach ($f in 'index.html','menu.html','contacto.html') { $c = Get-Content (Join-Path $dir $f) -Raw; $links = [regex]::Matches($c, 'href="([^"#]+\\.(html|css))"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique; foreach ($l in $links) { "$f -> $l : " + (Test-Path (Join-Path $dir $l)) } }; Get-Command python -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source`,
      tool: 'bash',
      allowed: true
    },
    { command: `powershell -Command "Get-ChildItem ${root} -Name"`, tool: 'bash', allowed: true }
  ]
}

export function round4MacCommand(root: string): string {
  return `cd ${root} && ls -la && for f in index.html menu.html contacto.html; do echo "== $f"; grep -o 'href="[^\"]*"' $f | sort -u; done && (python3 -m http.server 8765 >/tmp/caf_server.log 2>&1 &) && sleep 2 && for p in index.html menu.html contacto.html style.css; do curl -s -o /dev/null -w "$p -> %{http_code}\\n" http://127.0.0.1:8765/$p; done`
}
