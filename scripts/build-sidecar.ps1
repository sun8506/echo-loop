param(
    [string]$TargetTriple = ""
)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $ProjectDir "backend"
$Python = Join-Path $BackendDir ".venv\Scripts\python.exe"
$OutputDir = Join-Path $ProjectDir "src-tauri\binaries"

if (-not (Test-Path $Python)) {
    throw "缺少 backend\.venv。请先执行：py -3.12 -m venv backend\.venv，然后安装 backend\requirements.txt 和 pyinstaller。"
}

if (-not $TargetTriple) {
    $TargetTriple = (& rustc --print host-tuple).Trim()
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
Push-Location $BackendDir
try {
    & $Python -m PyInstaller --noconfirm --clean --onefile `
        --name echo-loop-backend `
        --paths . `
        --collect-all faster_whisper `
        --collect-all ctranslate2 `
        --collect-all av `
        desktop_server.py
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller 构建失败。" }

    $Destination = Join-Path $OutputDir "echo-loop-backend-$TargetTriple.exe"
    Copy-Item -Force "dist\echo-loop-backend.exe" $Destination
    Write-Host "Created $Destination"
}
finally {
    Pop-Location
}
