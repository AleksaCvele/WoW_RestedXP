#!/usr/bin/env bash
# Builds the installers in CI. Update artifacts (for auto-update) are only created and
# signed when the signing key is available, which the workflow only provides to tag builds.
set -eo pipefail

if [[ -n "${TAURI_SIGNING_PRIVATE_KEY}" ]]; then
  echo "Signing auto-update artifacts."
  npm run tauri build -- ${TAURI_BUILD_ARGS} --config '{"bundle":{"createUpdaterArtifacts":true}}'
else
  if [[ "${GITHUB_REF_TYPE}" == "tag" ]]; then
    echo "::warning::The TAURI_SIGNING_PRIVATE_KEY secret is not set, so this release can't be offered as an auto-update."
  fi
  npm run tauri build -- ${TAURI_BUILD_ARGS}
fi
