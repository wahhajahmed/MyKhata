#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "$1" >&2
  exit 1
}

if [[ $# -ne 1 ]]; then
  fail 'Usage: prepare-android-signing.sh <keystore-destination>'
fi

for pair in \
  'KEYSTORE_BASE64:MYKHATA_KEYSTORE_BASE64' \
  'KEYSTORE_PASSWORD:MYKHATA_KEYSTORE_PASSWORD' \
  'KEY_ALIAS:MYKHATA_KEY_ALIAS' \
  'KEY_PASSWORD:MYKHATA_KEY_PASSWORD' \
  'MYKHATA_KEYSTORE_CERT_SHA256:MYKHATA_KEYSTORE_CERT_SHA256'; do
  variable="${pair%%:*}"
  secret="${pair##*:}"
  if [[ -z "${!variable:-}" ]]; then
    fail "Required secret $secret is missing."
  fi
done

destination="$1"
mkdir -p "$(dirname "$destination")"
printf '%s' "$KEYSTORE_BASE64" | base64 --decode > "$destination"
[[ -s "$destination" ]] || fail 'MYKHATA_KEYSTORE_BASE64 decoded to an empty keystore.'

temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT

# Signing a throwaway JAR proves the store password, alias and key password all work.
mkdir -p "$temporary/probe"
echo 'MyKhata signing probe' > "$temporary/probe/README.txt"
(cd "$temporary/probe" && jar --create --file "$temporary/probe.jar" README.txt)
jarsigner \
  -keystore "$destination" \
  -storepass "$KEYSTORE_PASSWORD" \
  -keypass "$KEY_PASSWORD" \
  "$temporary/probe.jar" \
  "$KEY_ALIAS" >/dev/null 2>&1 \
  || fail 'Android keystore password, alias or key password is invalid.'

keytool -list -v \
  -keystore "$destination" \
  -storepass "$KEYSTORE_PASSWORD" \
  -alias "$KEY_ALIAS" > "$temporary/keystore.txt" 2>&1 \
  || fail 'The Android signing alias could not be read.'
grep -q 'PrivateKeyEntry' "$temporary/keystore.txt" \
  || fail 'The Android signing alias is not a PrivateKeyEntry.'

actual="$(sed -n 's/^SHA256:[[:space:]]*//p' "$temporary/keystore.txt" \
  | head -n 1 | tr -d ':\r\n' | tr '[:lower:]' '[:upper:]')"
expected="$(printf '%s' "$MYKHATA_KEYSTORE_CERT_SHA256" | tr -d '[:space:]:' | tr '[:lower:]' '[:upper:]')"
[[ -n "$actual" ]] || fail 'Could not read the keystore certificate fingerprint.'
[[ "$actual" == "$expected" ]] \
  || fail 'The Android keystore certificate fingerprint does not match the pinned identity.'

echo 'Android keystore credentials validated.'
