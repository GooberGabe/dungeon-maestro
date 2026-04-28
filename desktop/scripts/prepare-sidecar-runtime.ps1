$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopDir = Split-Path -Parent $scriptDir
$repoRoot = Split-Path -Parent $desktopDir
$runtimeDir = Join-Path $desktopDir 'sidecar-python'
$pythonRootDir = Join-Path $runtimeDir 'python'

if (Test-Path $runtimeDir) {
  Remove-Item $runtimeDir -Recurse -Force
}

$hostPython = (Get-Command python).Source
if (!(Test-Path $hostPython)) {
  throw 'python executable was not found on PATH'
}

$hostPythonRoot = & $hostPython -c "import sys; print(sys.base_prefix)"
if (![string]::IsNullOrWhiteSpace($hostPythonRoot) -and (Test-Path $hostPythonRoot)) {
  New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
  Copy-Item $hostPythonRoot $pythonRootDir -Recurse -Force
} else {
  throw "Unable to determine host Python installation root from $hostPython"
}

$runtimePython = Join-Path $pythonRootDir 'python.exe'

if (!(Test-Path $runtimePython)) {
  throw "Bundled runtime python.exe was not created at $runtimePython"
}

& $runtimePython -m pip install --upgrade pip

$projectSpec = "$repoRoot[discord]"
& $runtimePython -m pip install $projectSpec

Write-Host "Prepared bundled sidecar runtime at $runtimeDir"
