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
release/MyKhata Setup 0.1.0.exe
```

The installer allows choosing the installation directory and creates a desktop shortcut. MyKhata stores its SQLite database in Electron's per-user application data directory (`app.getPath('userData')/mykhata.sqlite`), not in the application folder.

If `better-sqlite3` fails to load, rerun `npm run rebuild:electron` with the same Node/Electron versions used to build the app.

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

Install it with `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` or copy it to the device. The debug APK is unsigned for distribution; generate a release keystore and signing configuration before publishing to a store. Never commit a keystore or signing credentials.

### Android build notes

- Gradle 8.2.1 is provided by the wrapper in `android/gradle/wrapper`; a global Gradle installation is not required.
- JDK 21 works with Gradle 8.2.1. JDK 26 is not compatible with this Gradle version.
- The generated Android project targets SDK 34. Newer installed SDK platforms work, but the compile/target versions in `android/variables.gradle` should be checked when the Android tooling is upgraded.

## 5. Optional Supabase sync

Sync is disabled unless both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are provided in a local `.env` file. Start from `.env.example`:

```bash
copy .env.example .env
```

The remote table must expose these columns: `id`, `entity_type`, `entity_id`, `operation`, `payload`, `device_id`, and `created_at`, with `id` as the primary key. Never use a service-role key in the client environment.

No data is uploaded until a user checks the explicit approval box on the Backup, Restore & Sync page and clicks **Sync now**.

## Verification performed for 0.1.0

- `npx tsc --noEmit -p tsconfig.json`
- `npx tsc --noEmit -p tsconfig.electron.json`
- `npm test` — 25 tests passing
- `npm run build`
- `npm run desktop:build`
- `npx cap add android` followed by `assembleDebug`
