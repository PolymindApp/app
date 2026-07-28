#!/usr/bin/env bash

set -euo pipefail

build_variant="${1:-debug}"

if [[ -z "${JAVA_HOME:-}" || ! -x "$JAVA_HOME/bin/java" ]]; then
  java_command="$(command -v java || true)"
  if [[ -z "$java_command" ]]; then
    echo "Java is required to build Android. Install Android Studio or JDK 21+." >&2
    exit 1
  fi
  java_binary="$(readlink -f "$java_command")"
  export JAVA_HOME="${java_binary%/bin/java}"
fi

case "$build_variant" in
  debug)
    gradle_task="assembleDebug"
    artifact_path="android/app/build/outputs/apk/debug/app-debug.apk"
    ;;
  release)
    gradle_task="assembleRelease"
    artifact_path="android/app/build/outputs/apk/release/app-release-unsigned.apk"
    ;;
  bundle)
    gradle_task="bundleRelease"
    artifact_path="android/app/build/outputs/bundle/release/app-release.aab"
    ;;
  *)
    echo "Usage: pnpm android:build [debug|release|bundle]" >&2
    exit 2
    ;;
esac

pnpm build
pnpm exec cap sync android

(
  cd android
  ./gradlew "$gradle_task"
)

echo "Android build created: $artifact_path"
