param(
  [Parameter(Mandatory = $true)]
  [string]$Destination,

  [switch]$WriteGithubEnv
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'windows-fingerprint.ps1')

function Fail([string]$Message) {
  throw $Message
}

if ([string]::IsNullOrWhiteSpace($env:CSC_BASE64)) {
  Fail 'Required secret MYKHATA_WINDOWS_CSC_BASE64 is missing.'
}
if ([string]::IsNullOrWhiteSpace($env:CSC_PASSWORD)) {
  Fail 'Required secret MYKHATA_WINDOWS_CSC_PASSWORD is missing.'
}
if ([string]::IsNullOrWhiteSpace($env:MYKHATA_WINDOWS_CERT_SHA256)) {
  Fail 'Required secret MYKHATA_WINDOWS_CERT_SHA256 is missing.'
}

try {
  $bytes = [Convert]::FromBase64String($env:CSC_BASE64)
} catch {
  Fail 'MYKHATA_WINDOWS_CSC_BASE64 is not valid base64.'
}
if ($null -eq $bytes -or $bytes.Length -eq 0) {
  Fail 'MYKHATA_WINDOWS_CSC_BASE64 decoded to an empty certificate.'
}

$directory = Split-Path -Parent $Destination
if ($directory -and -not (Test-Path -LiteralPath $directory)) {
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
}
[IO.File]::WriteAllBytes($Destination, $bytes)

$flags = [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable
try {
  $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
    $Destination,
    $env:CSC_PASSWORD,
    $flags
  )
} catch {
  Fail 'The Windows code-signing certificate or its password is invalid.'
}

try {
  if (-not $certificate.HasPrivateKey) {
    Fail 'The Windows code-signing certificate does not contain a private key.'
  }

  $now = Get-Date
  if ($now -lt $certificate.NotBefore -or $now -gt $certificate.NotAfter) {
    Fail 'The Windows code-signing certificate is not currently valid.'
  }

  $eku = @($certificate.EnhancedKeyUsageList | ForEach-Object { $_.ObjectId })
  if ($eku -notcontains '1.3.6.1.5.5.7.3.3') {
    Fail 'The Windows certificate is not valid for code signing.'
  }

  $expected = Normalize-WindowsCertificateFingerprint $env:MYKHATA_WINDOWS_CERT_SHA256
  if ($expected -notmatch '^[0-9A-F]{64}$') {
    Fail 'MYKHATA_WINDOWS_CERT_SHA256 must be a 64-character SHA-256 fingerprint.'
  }
  $actual = Get-WindowsCertificateSha256 -Certificate $certificate
  if ($actual -ne $expected) {
    Fail 'The Windows certificate SHA-256 fingerprint does not match the pinned identity.'
  }
} finally {
  $certificate.Dispose()
}

if ($WriteGithubEnv) {
  # Only the path is written; the password is passed directly to the build step.
  "CSC_LINK=$Destination" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
}

Write-Host 'Windows code-signing certificate validated.'
