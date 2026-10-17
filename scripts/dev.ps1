$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$python = Join-Path $workspace '.venv\Scripts\python.exe'
$vite = Join-Path $workspace 'frontend\node_modules\vite\bin\vite.js'
if (!$env:JWT_SECRET) {
    $environmentFile = Join-Path $workspace '.env'
    if (Test-Path -LiteralPath $environmentFile) {
        foreach ($line in Get-Content -LiteralPath $environmentFile) {
            if ($line -match '^JWT_SECRET=(.+)$') {
                $env:JWT_SECRET = $Matches[1].Trim().Trim('"').Trim("'")
                break
            }
        }
    }
    if (!$env:JWT_SECRET) { throw 'Set JWT_SECRET in the process environment or the root .env file. See README.md.' }
}
if (!(Test-Path -LiteralPath $python) -or !(Test-Path -LiteralPath $vite)) {
    throw 'Install dependencies first. See README.md.'
}
foreach ($port in @(8000, 5173)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $port is already in use. Stop the existing server first."
    }
}
$logDirectory = Join-Path $workspace 'artifacts'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$backendProcess = $null
$frontendProcess = $null
try {
    $backendProcess = Start-Process -FilePath $python -ArgumentList @('-m', 'uvicorn', 'backend.app.main:app', '--host', '127.0.0.1', '--port', '8000') -WorkingDirectory $workspace -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'backend.log') -RedirectStandardError (Join-Path $logDirectory 'backend-error.log')
    $frontendProcess = Start-Process -FilePath (Get-Command node).Source -ArgumentList @($vite, '--host', '127.0.0.1', '--port', '5173', '--strictPort') -WorkingDirectory (Join-Path $workspace 'frontend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'frontend.log') -RedirectStandardError (Join-Path $logDirectory 'frontend-error.log')
    Write-Host 'Frontend: http://127.0.0.1:5173'
    Write-Host 'FastAPI docs: http://127.0.0.1:8000/docs'
    Write-Host 'Logs: artifacts/. Press Ctrl+C to stop both servers.'
    while (!$backendProcess.HasExited -and !$frontendProcess.HasExited) { Start-Sleep -Seconds 1 }
    throw 'A server stopped. Check artifacts/*-error.log.'
}
finally {
    foreach ($child in @($backendProcess, $frontendProcess)) {
        if ($null -ne $child -and !$child.HasExited) { Stop-Process -Id $child.Id -ErrorAction SilentlyContinue }
    }
}
