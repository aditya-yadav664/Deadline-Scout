$ErrorActionPreference = 'Stop'
$scoutRoot = $PSScriptRoot
$scoutNode = (Get-Command node -ErrorAction Stop).Source
function Test-ScoutBackend {
    & $scoutNode --input-type=module -e 'try { const r=await fetch("http://127.0.0.1:4317/health",{signal:AbortSignal.timeout(1200)}); process.exit(r.ok&&(await r.json()).ok?0:1); } catch { process.exit(1); }' | Out-Null
    return ($LASTEXITCODE -eq 0)
}
if (Test-ScoutBackend) { Write-Output 'Deadline Scout is already running at http://localhost:4317/'; return }
$scoutData = Join-Path $scoutRoot 'data'
New-Item -ItemType Directory -Force -Path $scoutData | Out-Null
$scoutProcess = Start-Process -FilePath $scoutNode -ArgumentList '--env-file-if-exists=.env','server/index.js' -WorkingDirectory $scoutRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $scoutData 'server.stdout.log') -RedirectStandardError (Join-Path $scoutData 'server.stderr.log')
Set-Content -LiteralPath (Join-Path $scoutData 'server.pid') -Value $scoutProcess.Id
for ($scoutAttempt = 0; $scoutAttempt -lt 24; $scoutAttempt++) {
    Start-Sleep -Milliseconds 250
    if (Test-ScoutBackend) { Write-Output 'Deadline Scout is running in the background at http://localhost:4317/'; return }
}
throw 'Deadline Scout did not start. Check data/server.stderr.log.'
