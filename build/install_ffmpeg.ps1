# Detects ffmpeg/ffprobe; if missing, downloads the latest essentials build
# from gyan.dev and copies ffmpeg.exe + ffprobe.exe into the install folder.
# Invoked by the NSIS installer; intended to be re-runnable.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $TargetDir,
    [string] $Url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
)

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"

function Test-FfmpegOnSystem {
    if (Get-Command ffmpeg.exe  -ErrorAction SilentlyContinue) { return $true }
    if (Get-Command ffprobe.exe -ErrorAction SilentlyContinue) {
        if (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue) { return $true }
    }
    if ((Test-Path "C:\ffmpeg\bin\ffmpeg.exe") -and
        (Test-Path "C:\ffmpeg\bin\ffprobe.exe")) { return $true }
    return $false
}

function Test-FfmpegBundled {
    return ((Test-Path (Join-Path $TargetDir "ffmpeg.exe")) -and
            (Test-Path (Join-Path $TargetDir "ffprobe.exe")))
}

if (Test-FfmpegOnSystem) {
    Write-Host "ffmpeg already present on system. Skipping download."
    exit 0
}
if (Test-FfmpegBundled) {
    Write-Host "ffmpeg already bundled in $TargetDir. Skipping download."
    exit 0
}

Write-Host "ffmpeg not found. Downloading from $Url ..."
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

$tempZip     = Join-Path $env:TEMP "ffmpeg-release-essentials.zip"
$tempExtract = Join-Path $env:TEMP "ffmpeg-extract"

try {
    if (Test-Path $tempZip)     { Remove-Item -Force $tempZip }
    if (Test-Path $tempExtract) { Remove-Item -Recurse -Force $tempExtract }

    # PS 5.1's Invoke-WebRequest is slow due to its progress UI rendering;
    # silencing $ProgressPreference (above) and using -UseBasicParsing keeps it brisk.
    Invoke-WebRequest -Uri $Url -OutFile $tempZip -UseBasicParsing

    Write-Host "Extracting..."
    Expand-Archive -Path $tempZip -DestinationPath $tempExtract -Force

    # The archive ships as ffmpeg-X.Y-essentials_build\bin\{ffmpeg,ffprobe}.exe.
    # Don't hard-code the version-stamped folder name; just find them.
    $ffmpeg  = Get-ChildItem -Path $tempExtract -Recurse -Filter "ffmpeg.exe"  | Select-Object -First 1
    $ffprobe = Get-ChildItem -Path $tempExtract -Recurse -Filter "ffprobe.exe" | Select-Object -First 1

    if (-not $ffmpeg -or -not $ffprobe) {
        throw "Couldn't locate ffmpeg.exe/ffprobe.exe inside the downloaded archive."
    }

    Copy-Item $ffmpeg.FullName  (Join-Path $TargetDir "ffmpeg.exe")  -Force
    Copy-Item $ffprobe.FullName (Join-Path $TargetDir "ffprobe.exe") -Force

    Write-Host "Installed ffmpeg + ffprobe to $TargetDir"
}
finally {
    if (Test-Path $tempZip)     { Remove-Item -Force $tempZip -ErrorAction SilentlyContinue }
    if (Test-Path $tempExtract) { Remove-Item -Recurse -Force $tempExtract -ErrorAction SilentlyContinue }
}

exit 0
