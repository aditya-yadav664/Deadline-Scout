$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath $PSScriptRoot
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Install Node.js 24 or newer, reopen PowerShell, then run this script again.'
    }
    $nodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
    if ($nodeMajor -lt 24) { throw 'Deadline Diff requires Node.js 24 or newer.' }
    & node --env-file-if-exists=.env server/index.js
} finally {
    Pop-Location
}
