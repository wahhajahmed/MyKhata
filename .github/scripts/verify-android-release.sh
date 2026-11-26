#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "$1" >&2
  exit 1
}

if [[ $# -ne 3 ]]; then
  fail 'Usage: verify-android-release.sh <version-name> <version-code> <verified-dir>'
fi

version_name="$1"
version_code="$2"
verified_dir="$3"
package_id='com.mykhata.app'
bundletool_version='1.18.3'
bundletool_sha256='a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29'

[[ -n "${MYKHATA_KEYSTORE_CERT_SHA256:-}" ]] \
  || fail 'Required secret MYKHATA_KEYSTORE_CERT_SHA256 is missing.'
expected="$(printf '%s' "$MYKHATA_KEYSTORE_CERT_SHA256" | tr -d '[:space:]:' | tr '[:lower:]' '[:upper:]')"
[[ -n "$expected" ]] || fail 'MYKHATA_KEYSTORE_CERT_SHA256 is empty.'

sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[[ -n "$sdk" ]] || fail 'ANDROID_HOME/ANDROID_SDK_ROOT is not set.'

find_sdk_tool() {
  find "$sdk/build-tools" -maxdepth 3 -type f \
    \( -name "$1" -o -name "$1.bat" -o -name "$1.exe" \) 2>/dev/null \
    | sort -V | tail -n 1
}

apksigner="$(find_sdk_tool apksigner || true)"
aapt2="$(find_sdk_tool aapt2 || true)"
[[ -n "$apksigner" ]] || fail 'apksigner was not found in the Android SDK.'
[[ -n "$aapt2" ]] || fail 'aapt2 was not found in the Android SDK.'

keytool_bin="$(command -v keytool || true)"
jarsigner_bin="$(command -v jarsigner || true)"
java_bin="$(command -v java || true)"
[[ -n "$keytool_bin" ]] || fail 'keytool was not found on PATH.'
[[ -n "$jarsigner_bin" ]] || fail 'jarsigner was not found on PATH.'
[[ -n "$java_bin" ]] || fail 'java was not found on PATH.'

source_apk='android/app/build/outputs/apk/release/app-release.apk'
source_aab='android/app/build/outputs/bundle/release/app-release.aab'
[[ -f "$source_apk" ]] || fail 'Signed release APK app-release.apk is missing.'
[[ -f "$source_aab" ]] || fail 'Signed release AAB app-release.aab is missing.'

apk_name="MyKhata-${version_name}.apk"
aab_name="MyKhata-${version_name}.aab"

temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT

# APK: v1/v2/v3 signature verification plus signer identity.
"$apksigner" verify --verbose --print-certs "$source_apk" > "$temporary/apksigner.txt" 2>&1 \
  || { cat "$temporary/apksigner.txt" >&2; fail 'APK signature verification failed.'; }
apk_digest="$(sed -n 's/.*certificate SHA-256 digest:[[:space:]]*//p' "$temporary/apksigner.txt" \
  | tr -d ':\r\n' | tr '[:lower:]' '[:upper:]' | sed '/^$/d')"
apk_digest_count="$(printf '%s\n' "$apk_digest" | grep -c . || true)"
[[ "$apk_digest_count" -eq 1 ]] || fail 'APK must be signed by exactly one certificate.'
[[ "$apk_digest" == "$expected" ]] || fail 'APK signer identity does not match the pinned keystore certificate.'

# AAB: JAR signature verification plus signer identity. apksigner does not verify AABs.
"$jarsigner_bin" -verify -verbose:summary "$source_aab" > "$temporary/jarsigner.txt" 2>&1 \
  || { cat "$temporary/jarsigner.txt" >&2; fail 'AAB JAR signature verification failed.'; }
grep -qi 'jar verified' "$temporary/jarsigner.txt" \
  || fail 'AAB JAR signature verification did not report a verified jar.'

"$keytool_bin" -printcert -jarfile "$source_aab" > "$temporary/aabcert.txt" 2>&1 \
  || { cat "$temporary/aabcert.txt" >&2; fail 'AAB signer certificate could not be read.'; }
aab_digest="$(sed -n 's/^[[:space:]]*SHA256:[[:space:]]*//p' "$temporary/aabcert.txt" \
  | tr -d ':\r\n' | tr '[:lower:]' '[:upper:]' | sed '/^$/d')"
aab_digest_count="$(printf '%s\n' "$aab_digest" | grep -c . || true)"
[[ "$aab_digest_count" -eq 1 ]] || fail 'AAB must be signed by exactly one certificate.'
[[ "$aab_digest" == "$expected" ]] || fail 'AAB signer identity does not match the pinned keystore certificate.'

# Package identity and release version from both artifact formats.
"$aapt2" dump badging "$source_apk" > "$temporary/badging.txt" 2>&1 \
  || fail 'APK package metadata could not be read.'
grep -q "package: name='$package_id' versionCode='$version_code' versionName='$version_name'" \
  "$temporary/badging.txt" \
  || fail 'APK package identity or release version does not match the tag.'

bundletool_url="https://github.com/google/bundletool/releases/download/${bundletool_version}/bundletool-all-${bundletool_version}.jar"
curl -fsSL -o "$temporary/bundletool.jar" "$bundletool_url" \
  || fail 'bundletool could not be downloaded for AAB verification.'
printf '%s  %s\n' "$bundletool_sha256" "$temporary/bundletool.jar" | sha256sum --check --status \
  || fail 'bundletool checksum verification failed.'

"$java_bin" -jar "$temporary/bundletool.jar" dump manifest --bundle="$source_aab" \
  > "$temporary/aab-manifest.xml" 2> "$temporary/bundletool.err" \
  || { cat "$temporary/bundletool.err" >&2; fail 'AAB manifest could not be parsed by bundletool.'; }
grep -q "package=\"$package_id\"" "$temporary/aab-manifest.xml" \
  || fail 'AAB package identity does not match the expected application id.'
grep -q "android:versionCode=\"$version_code\"" "$temporary/aab-manifest.xml" \
  || fail 'AAB versionCode does not match the release tag.'
grep -q "android:versionName=\"$version_name\"" "$temporary/aab-manifest.xml" \
  || fail 'AAB versionName does not match the release tag.'

rm -rf "$verified_dir"
mkdir -p "$verified_dir"
cp "$source_apk" "$verified_dir/$apk_name"
cp "$source_aab" "$verified_dir/$aab_name"
(
  cd "$verified_dir"
  sha256sum "$apk_name" "$aab_name" > SHA256SUMS.txt
)

echo 'Verified signed Android release APK and AAB.'
