# Stáhne Windows embeddable Python + nainstaluje pypdf do python-runtime/
# Použití: npm run prepare:python   (nebo přímo tento skript)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Dest = Join-Path $Root "python-runtime"
$Version = "3.12.8"
$ZipName = "python-$Version-embed-amd64.zip"
$Url = "https://www.python.org/ftp/python/$Version/$ZipName"
$ZipPath = Join-Path $env:TEMP $ZipName
$GetPip = Join-Path $env:TEMP "get-pip.py"

Write-Host "==> ADHD Planer: prepare embeddable Python $Version"

if (Test-Path (Join-Path $Dest "python.exe")) {
    Write-Host "python-runtime už existuje — aktualizuji pypdf..."
} else {
    Write-Host "Stahuji $Url ..."
    Invoke-WebRequest -Uri $Url -OutFile $ZipPath
    if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
    New-Item -ItemType Directory -Path $Dest | Out-Null
    Expand-Archive -Path $ZipPath -DestinationPath $Dest -Force
    Remove-Item $ZipPath -Force -ErrorAction SilentlyContinue
}

# Povolit site-packages v ._pth
$pth = Get-ChildItem -Path $Dest -Filter "python*._pth" | Select-Object -First 1
if ($pth) {
    $content = Get-Content $pth.FullName
    $new = @()
    foreach ($line in $content) {
        if ($line -match '^\s*#\s*import\s+site') {
            $new += "import site"
        } elseif ($line -match '^\s*import\s+site') {
            $new += "import site"
        } else {
            $new += $line
        }
    }
    if ($new -notcontains "import site") { $new += "import site" }
    Set-Content -Path $pth.FullName -Value $new -Encoding ASCII
}

$python = Join-Path $Dest "python.exe"
if (-not (Test-Path $python)) { throw "python.exe nenalezen v $Dest" }

Write-Host "Instaluji pip..."
Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $GetPip
& $python $GetPip --no-warn-script-location
Remove-Item $GetPip -Force -ErrorAction SilentlyContinue

Write-Host "Instaluji pypdf z requirements.txt..."
$req = Join-Path $Root "requirements.txt"
& $python -m pip install --no-warn-script-location -r $req

Write-Host "Hotovo: $Dest"
Write-Host "Ověření: & `"$python`" -c `"import pypdf; print(pypdf.__version__)`""
