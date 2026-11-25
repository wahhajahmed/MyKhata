param(
  [Parameter(Mandatory = $true)]
  [string]$ReleaseVersion,

  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,

  [Parameter(Mandatory = $true)]
  [string]$VerifiedDir
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'windows-fingerprint.ps1')

function Fail([string]$Message) {
  throw $Message
}

if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
  Fail "Expected signed installer was not found: $InstallerPath"
}

$name = Split-Path -Leaf $InstallerPath
if ($name -ne "MyKhata Setup $ReleaseVersion.exe") {
  Fail "Installer name does not match the release version: $name"
}

$signtool = $null
$command = Get-Command signtool.exe -ErrorAction SilentlyContinue
if ($command) {
  $signtool = $command.Source
}
if (-not $signtool) {
  $candidates = @(
    Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe' -ErrorAction SilentlyContinue |
      Sort-Object FullName -Descending |
      ForEach-Object { $_.FullName }
  )
  $signtool = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
}
if (-not $signtool) {
  Fail 'SignTool was not found on this runner.'
}

& $signtool verify /pa /v $InstallerPath
if ($LASTEXITCODE -ne 0) {
  Fail 'SignTool Authenticode verification failed.'
}

$signature = Get-AuthenticodeSignature -LiteralPath $InstallerPath
if ($signature.Status -ne 'Valid') {
  Fail "Authenticode signature is not valid: $($signature.Status)"
}
if (-not $signature.SignerCertificate) {
  Fail 'Authenticode signature has no signer certificate.'
}

if (-not [string]::IsNullOrWhiteSpace($env:MYKHATA_WINDOWS_CERT_SHA256)) {
  $expected = Normalize-WindowsCertificateFingerprint $env:MYKHATA_WINDOWS_CERT_SHA256
  $actual = Get-WindowsCertificateSha256 -Certificate $signature.SignerCertificate
  if ($actual -ne $expected) {
    Fail 'The signed installer SHA-256 fingerprint does not match the pinned certificate.'
  }
}

$versionInfo = (Get-Item -LiteralPath $InstallerPath).VersionInfo
if ($versionInfo.ProductName -ne 'MyKhata') {
  Fail "Unexpected Windows product identity: $($versionInfo.ProductName)"
}
if ($versionInfo.ProductVersion -ne $ReleaseVersion -or $versionInfo.FileVersion -ne $ReleaseVersion) {
  Fail 'Windows installer product/file version does not match the release tag.'
}

if (Test-Path -LiteralPath $VerifiedDir) {
  Remove-Item -LiteralPath $VerifiedDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $VerifiedDir | Out-Null
Copy-Item -LiteralPath $InstallerPath -Destination (Join-Path $VerifiedDir $name) -Force

$hash = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
$sumsPath = Join-Path $VerifiedDir 'SHA256SUMS.txt'
[IO.File]::WriteAllText($sumsPath, "$hash  $name`n", (New-Object System.Text.UTF8Encoding($false)))

Write-Host "Verified signed Windows installer: $name"
