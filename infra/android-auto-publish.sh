#!/usr/bin/env bash
# Runs on the app server (systemd timer, see install-android-auto-publish.sh):
# compares the public android-latest release with the manifest the API
# currently serves and publishes newer builds into the api container's media
# volume. The SHA-256 is verified before anything replaces served files, and
# the last three versionCode directories are kept for rollback. No secrets
# and no GitHub Actions minutes involved - the release assets are public.
set -euo pipefail

PROD_REPO="bi9potato/daily-todo-sync-prod"
ROOT="/opt/daily-todo-sync"
BASE="https://github.com/${PROD_REPO}/releases/download/android-latest"
COMPOSE="docker compose -f ${ROOT}/compose.yml"

mkdir -p "${ROOT}/android-releases"
exec 9> "${ROOT}/android-releases/.publish.lock"
flock -n 9 || exit 0

manifest_file="$(mktemp)"
apk_file="$(mktemp)"
sha_file="$(mktemp)"
trap 'rm -f "${manifest_file}" "${apk_file}" "${sha_file}"' EXIT

curl -fsSL --retry 3 "${BASE}/daily-todo-android-update.json" -o "${manifest_file}"
release_sha="$(sed -n 's/.*"buildSha": *"\([0-9a-f]*\)".*/\1/p' "${manifest_file}")"
version_code="$(sed -n 's/.*"versionCode": *\([0-9][0-9]*\).*/\1/p' "${manifest_file}")"
if [ -z "${release_sha}" ] || [ -z "${version_code}" ]; then
  echo "android-auto-publish: release manifest is missing buildSha/versionCode" >&2
  exit 1
fi

served_sha="$(${COMPOSE} exec -T api cat /app/media/mobile/android-latest.json 2> /dev/null |
  sed -n 's/.*"buildSha": *"\([0-9a-f]*\)".*/\1/p' || true)"
if [ "${served_sha}" = "${release_sha}" ]; then
  exit 0
fi

curl -fsSL --retry 3 "${BASE}/daily-todo-arm64-v8a.apk" -o "${apk_file}"
curl -fsSL --retry 3 "${BASE}/daily-todo-arm64-v8a.apk.sha256" -o "${sha_file}"
expected="$(cut -d' ' -f1 "${sha_file}")"
actual="$(sha256sum "${apk_file}" | cut -d' ' -f1)"
if [ "${expected}" != "${actual}" ]; then
  echo "android-auto-publish: APK SHA-256 mismatch (expected ${expected}, got ${actual})" >&2
  exit 1
fi
manifest_sha="$(sed -n 's/.*"apkSha256": *"\([0-9a-f]*\)".*/\1/p' "${manifest_file}")"
if [ -n "${manifest_sha}" ] && [ "${manifest_sha}" != "${actual}" ]; then
  echo "android-auto-publish: manifest apkSha256 does not match the downloaded APK" >&2
  exit 1
fi

release_dir="${ROOT}/android-releases/${version_code}"
mkdir -p "${release_dir}"
cp "${apk_file}" "${release_dir}/daily-todo-arm64-v8a.apk"
cp "${manifest_file}" "${release_dir}/android-update.json"
chmod 644 "${release_dir}/daily-todo-arm64-v8a.apk" "${release_dir}/android-update.json"
find "${ROOT}/android-releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' |
  grep -E '^[0-9]+$' | sort -nr | tail -n +4 | while read -r old; do
    rm -rf -- "${ROOT}/android-releases/${old}"
  done

${COMPOSE} exec -T api mkdir -p /app/media/mobile
${COMPOSE} cp "${release_dir}/daily-todo-arm64-v8a.apk" api:/app/media/mobile/daily-todo-arm64-v8a.apk
${COMPOSE} cp "${release_dir}/android-update.json" api:/app/media/mobile/android-latest.json

logger -t android-auto-publish "published versionCode ${version_code} (${release_sha})" 2> /dev/null || true
echo "android-auto-publish: published versionCode ${version_code} (${release_sha})"
