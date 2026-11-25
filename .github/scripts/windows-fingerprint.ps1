function Get-WindowsCertificateSha256 {
  param(
    [Parameter(Mandatory = $true)]
    [System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate
  )

  # RawData is the DER-encoded certificate. X509Certificate2.Thumbprint is SHA-1
  # and must not be used for this fingerprint.
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $algorithm.ComputeHash($Certificate.RawData)
  } finally {
    $algorithm.Dispose()
  }
  return ([BitConverter]::ToString($hash) -replace '-', '').ToUpperInvariant()
}

function Normalize-WindowsCertificateFingerprint {
  param(
    [AllowNull()]
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ''
  }
  return (($Value -replace '[^A-Fa-f0-9]', '').ToUpperInvariant())
}
