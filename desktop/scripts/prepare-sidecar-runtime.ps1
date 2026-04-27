$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopDir = Split-Path -Parent $scriptDir
$repoRoot = Split-Path -Parent $desktopDir
$runtimeDir = Join-Path $desktopDir 'sidecar-python'

if (Test-Path $runtimeDir) {
  Remove-Item $runtimeDir -Recurse -Force
}

python -m venv $runtimeDir
$runtimePython = Join-Path $runtimeDir 'Scripts\python.exe'

if (!(Test-Path $runtimePython)) {
  throw "Bundled runtime python.exe was not created at $runtimePython"
}

& $runtimePython -m pip install --upgrade pip

$projectSpec = "$repoRoot[discord]"
& $runtimePython -m pip install $projectSpec

Write-Host "Prepared bundled sidecar runtime at $runtimeDir"
