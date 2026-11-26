import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('release gate regressions', () => {
  it('is included in the Vitest run', () => {
    expect(read('vite.config.ts')).toContain("'tests/**/*.test.ts'")
  })

  it('never lets electron-builder publish a build', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    const command = pkg.scripts['desktop:build'] ?? ''
    expect(command).toContain('electron-builder --win --x64 -p never')
    expect(command).not.toMatch(/electron-builder --win --x64\s*$/)
  })

  it('does not use the broken setup-android action', () => {
    for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
      expect(read(workflow)).not.toContain('android-actions/setup-android@v3')
    }
  })

  it('keeps the release draft-only and verified-artifact-only', () => {
    const workflow = read('.github/workflows/release.yml')
    expect(workflow).toContain('draft: true')
    expect(workflow).not.toContain('draft: false')
    expect(workflow).toContain('pattern: \'*-verified\'')
    expect(workflow).toContain('path: release/verified/*')
    expect(workflow).toContain('path: release/verified-android/*')
  })

  it('stages uniquely named production artifacts with one checked checksum file', () => {
    const workflow = read('.github/workflows/release.yml')
    const androidVerify = read('.github/scripts/verify-android-release.sh')

    expect(androidVerify).toContain('apk_name="MyKhata-${version_name}.apk"')
    expect(androidVerify).toContain('aab_name="MyKhata-${version_name}.aab"')
    expect(workflow).toContain('apk="MyKhata-$RELEASE_VERSION.apk"')
    expect(workflow).toContain('aab="MyKhata-$RELEASE_VERSION.aab"')
    expect(workflow).toContain('cat "$windows/SHA256SUMS.txt" "$android/SHA256SUMS.txt" > "$staged/SHA256SUMS.txt"')
    expect(workflow).toContain('sha256sum --check --status SHA256SUMS.txt')
    expect(workflow).toContain('files: release-assets/*')
    expect(workflow).not.toContain('artifacts/android-verified/app-release.apk')
  })

  it('requires a Windows SHA-256 certificate pin', () => {
    for (const script of [
      '.github/scripts/prepare-windows-signing.ps1',
      '.github/scripts/verify-windows-release.ps1',
    ]) {
      expect(read(script)).toContain('Required secret MYKHATA_WINDOWS_CERT_SHA256 is missing.')
      expect(read(script)).toContain('64-character SHA-256 fingerprint')
    }
    expect(read('.github/scripts/tests/windows-fingerprint.test.ps1'))
      .toContain("Add-TestCertificateToStore -RawCertificate $publicCertificate -StoreName 'Root'")
  })

  it('parses indented keytool SHA-256 fingerprints', () => {
    const pattern = "s/^[[:space:]]*SHA256:[[:space:]]*//p"
    for (const script of [
      '.github/scripts/prepare-android-signing.sh',
      '.github/scripts/verify-android-release.sh',
    ]) {
      expect(read(script)).toContain(pattern)
    }
  })

  it('locates sdkmanager without the removed setup-android action', () => {
    for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
      expect(read(workflow)).toContain('cmdline-tools/latest/bin/sdkmanager')
    }
  })
})
