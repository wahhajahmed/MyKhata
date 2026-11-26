# Installation

MyKhata runs entirely offline after installation. Choose one of the three supported modes below.

## Prerequisites

- Node.js 20 or newer (verified with Node 22.17.0 and npm 10.9.2)
- For Windows desktop builds: Windows 10/11 x64 and Visual Studio build tools for native modules
- For Android builds: Android SDK, JDK 21 (recommended), and an Android device/emulator running API 22 or newer
- Python is not required for normal installation

## 1. Install dependencies

```bash
cd MyKhata
npm install
```

The pinned dependency versions are recorded in `package.json` and `package-lock.json`.

## 2. Browser development mode

Browser mode uses sql.js with IndexedDB persistence. It is useful for development and testing, but the desktop and Android builds use their native SQLite drivers.

```bash
npm run dev
```

Open the URL printed by Vite. To check the engine and database tests:

```bash
npm test
npm run typecheck
```

## 3. Windows desktop (Electron)

### Development

```bash
npm run rebuild:electron
npm run desktop:dev
```

### Production installer

```bash
npm run desktop:build
```

The NSIS installer is written to:

```text
release/MyKhata Setup 0.2.0.exe
```

The installer allows choosing the installation directory and creates a desktop shortcut. MyKhata stores its SQLite database in Electron's per-user application data directory (`app.getPath('userData')/mykhata.sqlite`), not in the application folder.

If `better-sqlite3-multiple-ciphers` fails to load, rerun `npm run rebuild:electron` with the same Node/Electron versions used to build the app. `npm run desktop:build` performs this rebuild automatically.

This local command produces an unsigned verification build. Production installers are produced by the manual release workflow with protected `MYKHATA_WINDOWS_CSC_BASE64` and `MYKHATA_WINDOWS_CSC_PASSWORD` secrets and are verified with SignTool before upload.

## 4. Android (Capacitor)

The Android project is already present in `android/`. Rebuild it after changing web assets or Capacitor plugins:

```bash
npm run build
npx cap sync android
```

On Windows PowerShell, set the SDK and Java paths for the current shell:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\openjdk\jdk-21.0.8'
$env:ANDROID_HOME = 'C:\Users\<you>\AppData\Local\Android\Sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
.\android\gradlew.bat -p android assembleDebug
```

The debug APK is written to:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Install it with `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` or copy it to the device. The debug APK is unsigned for distribution; publishing requires the existing release keystore and signing configuration. Never replace an existing production keystore without a deliberate key-rotation decision, and never commit a keystore or signing credentials.

Production release builds are signed and verified by the manual release workflow; unsigned release artifacts are never uploaded. It requires these protected repository secrets:

- Android: `MYKHATA_KEYSTORE_BASE64`, `MYKHATA_KEYSTORE_PASSWORD`, `MYKHATA_KEY_ALIAS`, `MYKHATA_KEY_PASSWORD`, and `MYKHATA_KEYSTORE_CERT_SHA256`.
- Windows: `MYKHATA_WINDOWS_CSC_BASE64`, `MYKHATA_WINDOWS_CSC_PASSWORD`, and `MYKHATA_WINDOWS_CERT_SHA256` (the required SHA-256 DER certificate fingerprint pin).

Generate the Windows pin from the DER-encoded signing certificate (do **not** use the SHA-1 `Thumbprint`):

```powershell
$pfx = 'C:\secure\mykhata-code-signing.pfx'
$password = Read-Host -AsSecureString 'PFX password'
$cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($pfx, $password)
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
  ([BitConverter]::ToString($sha256.ComputeHash($cert.RawData)) -replace '-', '').ToUpperInvariant()
} finally {
  $sha256.Dispose()
  $cert.Dispose()
}
```

Store the 64-character hexadecimal output as `MYKHATA_WINDOWS_CERT_SHA256`. Colons and spaces in the configured value are ignored, and lowercase is accepted.

The workflow fails before any build if a required secret is missing or invalid. It validates the existing keystore alias and pins the Android certificate fingerprint so a replacement keystore is rejected. It also compares the Windows SHA-256 DER fingerprint in both the pre-build credential check and the signed-installer verification. Do not generate a new keystore to satisfy the workflow: recover the original signing material, or make a deliberate key-rotation decision outside this release path. `versionCode` and `versionName` are derived from the release tag.

### Android build notes

- Gradle 8.2.1 is provided by the wrapper in `android/gradle/wrapper`; a global Gradle installation is not required.
- JDK 21 works with Gradle 8.2.1. JDK 26 is not compatible with this Gradle version.
- The generated Android project targets SDK 34. Newer installed SDK platforms work, but the compile/target versions in `android/variables.gradle` should be checked when the Android tooling is upgraded.

## 5. Enable app lock and encryption (recommended)

1. Open MyKhata on Windows or Android.
2. Go to **Settings → Security & encryption** and choose **Enable app lock**.
3. Enter a PIN (4–12 digits, not a trivial sequence) or a password of at least 8 characters with letters and numbers, then confirm it.
4. The existing plaintext database is migrated in place to encrypted storage. No records are deleted. On Android, biometric unlock can then be enabled if the device has enrolled biometrics.
5. On the next launch, unlock with the PIN/password before any financial screen appears. The app also auto-locks after 15 minutes of inactivity by default.

Create and verify an encrypted backup immediately afterwards: a forgotten PIN cannot be recovered from the encrypted database. Disabling the lock requires the PIN and converts the database back to plaintext.

## 6. Optional Supabase sync

Sync is disabled unless both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are provided in a local `.env` file. Start from `.env.example`:

```bash
copy .env.example .env
```

The remote table must expose these columns: `id`, `entity_type`, `entity_id`, `operation`, `payload`, `device_id`, and `created_at`, with `id` as the primary key. Never use a service-role key in the client environment.

No data is uploaded until a user checks the explicit approval box on the Backup, Restore & Sync page and clicks **Sync now**.

## Verification

For 0.2.0, the following were run locally before release preparation:

```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.electron.json
npm test
npm run desktop:build
npx cap sync android
./android/gradlew -p android assembleDebug --no-daemon
./android/gradlew -p android assembleRelease bundleRelease --no-daemon \
  -PmykhataVersionCode=200 -PmykhataVersionName=0.2.0
```

Results: both typechecks passed, 60 tests passed, the Windows installer and all Android targets built successfully, and production output contains no source maps. Exact results and limitations are recorded in `CHANGELOG.md`.

Signed release artifacts are produced only by the manual workflow after credential validation, SignTool/`apksigner`/`jarsigner` verification, package/version checks and SHA-256 checksum generation. That workflow creates a GitHub draft only and never publishes it automatically.

Physical Android SQLCipher unlock-after-restart, physical biometric unlock and airplane-mode offline checks on Android and Windows remain manual release checks until device evidence is provided. Automated builds and tests do not substitute for those checks.
