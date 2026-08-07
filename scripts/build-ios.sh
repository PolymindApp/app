#!/usr/bin/env bash

set -euo pipefail

ios_project="ios/App/App.xcodeproj"
ios_scheme="App"
ios_configuration="Release"
ios_export_method="${IOS_EXPORT_METHOD:-app-store-connect}"
ios_team_id="${IOS_TEAM_ID:-}"
ios_signing_certificate="${IOS_SIGNING_CERTIFICATE:-}"
ios_provisioning_profile="${IOS_PROVISIONING_PROFILE:-}"
artifact_directory="ios/App/output"

fail() {
  echo "iOS build stopped: $1" >&2
  exit 1
}

[[ "$(uname -s)" == "Darwin" ]] || fail "iOS releases must be built on macOS."
command -v xcodebuild >/dev/null 2>&1 || fail "Xcode is required."
command -v pnpm >/dev/null 2>&1 || fail "pnpm is required."

[[ -d "$ios_project" ]] || fail "the Capacitor iOS project is missing."
[[ -n "$ios_team_id" ]] || fail "IOS_TEAM_ID is required."
[[ -n "$ios_signing_certificate" ]] || fail "IOS_SIGNING_CERTIFICATE is required."
[[ -n "$ios_provisioning_profile" ]] || fail "IOS_PROVISIONING_PROFILE is required."

case "$ios_export_method" in
  app-store-connect | release-testing | enterprise | debugging)
    ;;
  *)
    fail "IOS_EXPORT_METHOD must be app-store-connect, release-testing, enterprise, or debugging."
    ;;
esac

xcode_version="$(xcodebuild -version | sed -n '1s/^Xcode //p')"
xcode_major="${xcode_version%%.*}"
[[ "$xcode_major" =~ ^[0-9]+$ ]] || fail "the installed Xcode version could not be read."
((xcode_major >= 26)) || fail "Capacitor 8 requires Xcode 26 or newer."

pnpm build:prod
pnpm exec cap sync ios

pnpm exec cap build ios \
  --scheme "$ios_scheme" \
  --configuration "$ios_configuration" \
  --xcode-team-id "$ios_team_id" \
  --xcode-export-method "$ios_export_method" \
  --xcode-signing-style manual \
  --xcode-signing-certificate "$ios_signing_certificate" \
  --xcode-provisioning-profile "$ios_provisioning_profile"

ipa_count="$(find "$artifact_directory" -maxdepth 1 -type f -name '*.ipa' | wc -l | tr -d ' ')"
[[ "$ipa_count" == "1" ]] || fail "expected exactly one IPA in $artifact_directory."

ipa_path="$(find "$artifact_directory" -maxdepth 1 -type f -name '*.ipa' -print -quit)"
echo "iOS build created: $ipa_path"
