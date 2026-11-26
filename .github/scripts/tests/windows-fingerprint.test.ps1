$ErrorActionPreference = 'Stop'

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )
  if (-not $Condition) {
    throw $Message
  }
}

function Find-SignTool {
  $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }
  $candidates = @(
    Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe' -ErrorAction SilentlyContinue |
      Sort-Object FullName -Descending |
      ForEach-Object { $_.FullName }
  )
  $found = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  Assert-True ([bool]$found) 'SignTool was not found; Windows fingerprint tests require the Windows SDK.'
  return $found
}

function Invoke-PowerShellScript {
  param(
    [string]$Script,
    [string[]]$Arguments
  )

  $all = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Script) + $Arguments
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & (Get-Command powershell.exe).Source @all 2>&1 | Out-String
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  return [pscustomobject]@{ ExitCode = $exitCode; Output = $output }
}

$scriptsDir = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path (Split-Path $scriptsDir -Parent) -Parent
. (Join-Path $scriptsDir 'windows-fingerprint.ps1')

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("mykhata-win-fingerprint-" + [guid]::NewGuid().ToString('N'))
$certificate = $null
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null

try {
  $password = 'test-fingerprint-pass'
  $securePassword = ConvertTo-SecureString $password -AsPlainText -Force
  $pfx = Join-Path $testRoot 'test-signing-cert.pfx'
  $certificate = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject 'CN=MyKhata Windows Fingerprint Test' `
    -CertStoreLocation 'Cert:\CurrentUser\My'
  Export-PfxCertificate -Cert $certificate -FilePath $pfx -Password $securePassword | Out-Null
  Write-Host '[1/9] Temporary code-signing certificate created.'

  # Independent calculation: SHA-256 over the certificate's DER-encoded bytes.
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $algorithm.ComputeHash($certificate.RawData)
  } finally {
    $algorithm.Dispose()
  }
  $fingerprint = ([BitConverter]::ToString($hash) -replace '-', '').ToUpperInvariant()
  Assert-True ($fingerprint.Length -eq 64) 'Expected a 64-character SHA-256 fingerprint.'
  Assert-True ($fingerprint -ne $certificate.Thumbprint) 'SHA-256 fingerprint must not equal the SHA-1 thumbprint.'

  $pairs = for ($index = 0; $index -lt $fingerprint.Length; $index += 2) {
    $fingerprint.Substring($index, 2)
  }
  $spacedLowercase = ($pairs -join ':').ToLowerInvariant()
  $wrongFingerprint = if ($fingerprint.StartsWith('0')) { 'F' * 64 } else { '0' * 64 }

  Assert-True ((Get-WindowsCertificateSha256 -Certificate $certificate) -eq $fingerprint) `
    'Shared helper must compute the SHA-256 DER fingerprint.'
  Assert-True ((Normalize-WindowsCertificateFingerprint $spacedLowercase) -eq $fingerprint) `
    'Shared helper must remove colons/spaces and uppercase the fingerprint.'
  Write-Host '[2/9] Shared SHA-256 helper and normalization assertions passed.'

  # prepare-windows-signing.ps1: correct fingerprint accepted, incorrect rejected.
  $prepare = Join-Path $scriptsDir 'prepare-windows-signing.ps1'
  $env:CSC_BASE64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($pfx))
  $env:CSC_PASSWORD = $password
  $env:MYKHATA_WINDOWS_CERT_SHA256 = $spacedLowercase

  $preparedCorrect = Join-Path $testRoot 'prepared-correct.pfx'
  $result = Invoke-PowerShellScript -Script $prepare -Arguments @('-Destination', $preparedCorrect)
  Assert-True ($result.ExitCode -eq 0) "Correct SHA-256 fingerprint was rejected by prepare script: $($result.Output)"
  Assert-True (Test-Path -LiteralPath $preparedCorrect) 'Prepare script did not write the decoded certificate.'
  Write-Host '[3/9] Prepare script accepted the correct SHA-256 fingerprint.'

  $env:MYKHATA_WINDOWS_CERT_SHA256 = $wrongFingerprint
  $preparedWrong = Join-Path $testRoot 'prepared-wrong.pfx'
  $result = Invoke-PowerShellScript -Script $prepare -Arguments @('-Destination', $preparedWrong)
  Assert-True ($result.ExitCode -ne 0) 'Incorrect SHA-256 fingerprint was accepted by prepare script.'
  Assert-True ($result.Output -match 'SHA-256 fingerprint') `
    "Prepare script failure should name the SHA-256 fingerprint: $($result.Output)"
  Write-Host '[4/9] Prepare script rejected the incorrect SHA-256 fingerprint.'

  # verify-windows-release.ps1: sign a copy of the local installer with the test cert.
  $version = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
  $sourceInstaller = Join-Path $repoRoot "release/MyKhata Setup $version.exe"
  Assert-True (Test-Path -LiteralPath $sourceInstaller) `
    "Build the local Windows installer before running fingerprint tests: $sourceInstaller"

  $installerDir = Join-Path $testRoot 'installer'
  New-Item -ItemType Directory -Force -Path $installerDir | Out-Null
  $installer = Join-Path $installerDir "MyKhata Setup $version.exe"
  Copy-Item -LiteralPath $sourceInstaller -Destination $installer -Force

  $signtool = Find-SignTool
  $signOutput = & $signtool sign /fd SHA256 /f $pfx /p $password $installer 2>&1
  Assert-True ($LASTEXITCODE -eq 0) "Test certificate could not sign the installer: $signOutput"
  Write-Host '[5/9] Temporary installer signed with the test certificate.'

  $publicCertificate = $certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
  $cer = Join-Path $testRoot 'test-signing-cert.cer'
  [IO.File]::WriteAllBytes($cer, $publicCertificate)
  certutil -user -addstore Root $cer | Out-Null
  Assert-True ($LASTEXITCODE -eq 0) 'Could not add the test certificate to CurrentUser Root.'
  certutil -user -addstore TrustedPublisher $cer | Out-Null
  Assert-True ($LASTEXITCODE -eq 0) 'Could not add the test certificate to CurrentUser TrustedPublisher.'
  Write-Host '[6/9] Test certificate added to CurrentUser trust stores.'

  $verify = Join-Path $scriptsDir 'verify-windows-release.ps1'
  $env:RELEASE_VERSION = $version
  $env:MYKHATA_WINDOWS_CERT_SHA256 = $spacedLowercase
  $verifiedCorrect = Join-Path $testRoot 'verified-correct'
  $result = Invoke-PowerShellScript -Script $verify -Arguments @(
    '-ReleaseVersion', $version,
    '-InstallerPath', $installer,
    '-VerifiedDir', $verifiedCorrect
  )
  Assert-True ($result.ExitCode -eq 0) "Correct SHA-256 fingerprint was rejected by verify script: $($result.Output)"
  Assert-True (Test-Path -LiteralPath (Join-Path $verifiedCorrect 'SHA256SUMS.txt')) `
    'Verify script did not stage checksums for the correctly signed installer.'
  Write-Host '[7/9] Verify script accepted the correct SHA-256 fingerprint.'

  $env:MYKHATA_WINDOWS_CERT_SHA256 = $wrongFingerprint
  $verifiedWrong = Join-Path $testRoot 'verified-wrong'
  $result = Invoke-PowerShellScript -Script $verify -Arguments @(
    '-ReleaseVersion', $version,
    '-InstallerPath', $installer,
    '-VerifiedDir', $verifiedWrong
  )
  Assert-True ($result.ExitCode -ne 0) 'Incorrect SHA-256 fingerprint was accepted by verify script.'
  Assert-True ($result.Output -match 'SHA-256 fingerprint') `
    "Verify script failure should name the SHA-256 fingerprint: $($result.Output)"
  Write-Host '[8/9] Verify script rejected the incorrect SHA-256 fingerprint.'

  # Missing fingerprint secret must fail closed in both scripts.
  $env:MYKHATA_WINDOWS_CERT_SHA256 = ''
  $result = Invoke-PowerShellScript -Script $prepare -Arguments @(
    '-Destination', (Join-Path $testRoot 'prepared-missing.pfx')
  )
  Assert-True ($result.ExitCode -ne 0) 'Missing fingerprint secret was accepted by prepare script.'
  Assert-True ($result.Output -match 'MYKHATA_WINDOWS_CERT_SHA256 is missing.') `
    "Prepare script failure should name the missing fingerprint secret: $($result.Output)"

  $result = Invoke-PowerShellScript -Script $verify -Arguments @(
    '-ReleaseVersion', $version,
    '-InstallerPath', $installer,
    '-VerifiedDir', (Join-Path $testRoot 'verified-missing')
  )
  Assert-True ($result.ExitCode -ne 0) 'Missing fingerprint secret was accepted by verify script.'
  Assert-True ($result.Output -match 'MYKHATA_WINDOWS_CERT_SHA256 is missing.') `
    "Verify script failure should name the missing fingerprint secret: $($result.Output)"
  Write-Host '[9/9] Missing fingerprint secret rejected by both scripts.'

  Write-Host 'Windows SHA-256 fingerprint tests passed.'
} finally {
  if ($certificate) {
    certutil -user -f -delstore Root $certificate.Thumbprint | Out-Null
    certutil -user -f -delstore TrustedPublisher $certificate.Thumbprint | Out-Null
    Remove-Item -LiteralPath "Cert:\CurrentUser\My\$($certificate.Thumbprint)" -Force -ErrorAction SilentlyContinue
  }
  Remove-Item Env:CSC_BASE64, Env:CSC_PASSWORD, Env:MYKHATA_WINDOWS_CERT_SHA256, Env:RELEASE_VERSION -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
