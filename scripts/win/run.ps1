# Ejecuta pasos de validacion (npm) sobre el codigo subido por scripts/win/sync.sh.
# Vive en C:\onyx\run.ps1 (copia de este archivo). Solo trabaja bajo C:\onyx\.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File C:\onyx\run.ps1 -Branch rama -Steps ci,typecheck,unit,build
param(
  [string]$Branch = 'default',
  [string]$Steps = 'ci,typecheck,unit,build',
  [string]$Root = 'C:\onyx',
  [string]$Spec = ''
)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$Branch = $Branch -replace '[\\/:*?"<>|]', '-'
$inbox = Join-Path $Root 'inbox\onyx.tgz'
$stage = Join-Path $Root 'stage'
$wt = Join-Path $Root 'wt'
$logs = Join-Path $Root "logs\$Branch"
$summary = Join-Path $logs 'summary.txt'
$limits = @{ ci = 900; typecheck = 300; unit = 600; build = 300; e2e = 2400; package = 1500; lint = 300; format = 300; noop = 60; fetch = 600; bundle = 60 }
$cmds = @{ ci = 'npm ci'; typecheck = 'npm run typecheck'; unit = 'npm test'; build = 'npm run build'; e2e = 'npm run test:e2e'; package = 'npm run package:win'; lint = 'npm run lint'; format = 'npm run format:check'; noop = 'node -v'; fetch = 'node scripts\fetch-opencode.mjs'; bundle = 'node scripts\check-win-bundle.mjs' }

New-Item -ItemType Directory -Force $logs, $stage, $wt, (Join-Path $Root 'npm-cache') | Out-Null
Set-Content -Path $summary -Value ("RUN " + (Get-Date -Format s) + " branch=$Branch steps=$Steps") -Encoding ascii

function Log([string]$m) { Add-Content -Path $summary -Value $m -Encoding ascii; Write-Output $m }

function Stop-Orphans {
  $self = $PID
  $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
  foreach ($p in $procs) {
    if ($p.ProcessId -eq $self) { continue }
    $exe = [string]$p.ExecutablePath
    $cl = [string]$p.CommandLine
    $hit = $false
    if ($exe -and $exe.StartsWith("$Root\wt\", [StringComparison]::OrdinalIgnoreCase)) { $hit = $true }
    elseif ($cl -match 'onyx-e2e-|onyx-smoke-') { $hit = $true }
    elseif ($exe -and $exe.StartsWith("$Root\", [StringComparison]::OrdinalIgnoreCase) -and $cl -match 'opencode(\.exe)?"?\s+serve') { $hit = $true }
    elseif ($cl -match [regex]::Escape("$Root\wt\") -and $p.Name -match '^(node|cmd|electron)\.exe$') { $hit = $true }
    if ($hit) {
      & taskkill.exe /PID $p.ProcessId /T /F *> $null
      Log ("orphan killed: pid=" + $p.ProcessId + " " + $p.Name)
    }
  }
}

function Finish([int]$code) {
  Stop-Orphans
  Log "EXIT=$code"
  exit $code
}

$env:Path = "$Root\node22;$env:Path"
$env:npm_config_cache = Join-Path $Root 'npm-cache'
$env:npm_config_update_notifier = 'false'
$env:npm_config_fund = 'false'
$env:npm_config_audit = 'false'
$env:CI = '1'

Stop-Orphans

if (Test-Path $inbox) {
  if (Test-Path $stage) { Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue }
  New-Item -ItemType Directory -Force $stage | Out-Null
  & "$env:SystemRoot\System32\tar.exe" -xzf $inbox -C $stage
  if ($LASTEXITCODE -ne 0) { Log "extract: FAIL ($LASTEXITCODE)"; Finish 2 }
  & robocopy.exe $stage $wt /MIR /XD node_modules out dist (Join-Path $wt 'resources\opencode-bin\bin') /XF .lockhash /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Log "robocopy: FAIL ($LASTEXITCODE)"; Finish 2 }
  Log 'sync: ok'
} else {
  Log 'sync: sin inbox, se usa wt tal cual'
}

Set-Location $wt
$allOk = $true
foreach ($raw in ($Steps -split '[,; ]+')) {
  $s = $raw.Trim()
  if (-not $s) { continue }
  if (-not $cmds.ContainsKey($s)) { Log "${s}: FAIL (paso desconocido)"; $allOk = $false; break }
  $cmd = $cmds[$s]
  if ($s -eq 'e2e' -and $Spec) { $cmd = "npm run test:e2e -- $Spec" }
  if ($s -eq 'ci') {
    $hash = (Get-FileHash -Algorithm SHA256 (Join-Path $wt 'package-lock.json')).Hash
    $hf = Join-Path $wt 'node_modules\.lockhash'
    if ((Test-Path $hf) -and ((Get-Content $hf -Raw).Trim() -eq $hash)) { Log 'ci: SKIP (package-lock sin cambios)'; continue }
  }
  $log = Join-Path $logs "$s.log"
  $limit = [int]$limits[$s]
  $t0 = Get-Date
  $p = Start-Process -FilePath cmd.exe -ArgumentList "/d /c $cmd > `"$log`" 2>&1" -WorkingDirectory $wt -PassThru -WindowStyle Hidden
  $done = $p.WaitForExit($limit * 1000)
  if (-not $done) {
    & taskkill.exe /PID $p.Id /T /F *> $null
    Stop-Orphans
    $secs = [int]((Get-Date) - $t0).TotalSeconds
    Log "${s}: FAIL (limite de $limit s superado, ${secs}s)"
    $allOk = $false
    break
  }
  $rc = $p.ExitCode
  $secs = [int]((Get-Date) - $t0).TotalSeconds
  if ($rc -eq 0) {
    if ($s -eq 'ci') { New-Item -ItemType Directory -Force (Join-Path $wt 'node_modules') | Out-Null; Set-Content -Path (Join-Path $wt 'node_modules\.lockhash') -Value $hash -Encoding ascii }
    Log "${s}: PASS (${secs}s)"
  } else {
    Log "${s}: FAIL (codigo $rc, ${secs}s) log=$log"
    $allOk = $false
    break
  }
}
if ($allOk) { Finish 0 } else { Finish 1 }
