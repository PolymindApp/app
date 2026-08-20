#!/usr/bin/env bash

set -euo pipefail

build_variant="${1:-debug}"
web_build_mode="${BACKONTRACK_WEB_BUILD_MODE:-prod}"
signing_properties="private/android-signing.properties"
release_keystore="private/backontrack-release.jks"
termux_aapt2="private/android-sdk/qemu/aapt2"

case "$web_build_mode" in
  dev|prod)
    ;;
  *)
    echo "BACKONTRACK_WEB_BUILD_MODE must be dev or prod." >&2
    exit 2
    ;;
esac

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
    if [[ ! -r "$signing_properties" || ! -r "$release_keystore" ]]; then
      echo "Release signing files are missing from private/. Restore them from backup." >&2
      exit 1
    fi
    gradle_task="assembleRelease"
    artifact_path="android/app/build/outputs/apk/release/app-release.apk"
    ;;
  bundle)
    if [[ ! -r "$signing_properties" || ! -r "$release_keystore" ]]; then
      echo "Release signing files are missing from private/. Restore them from backup." >&2
      exit 1
    fi
    gradle_task="bundleRelease"
    artifact_path="android/app/build/outputs/bundle/release/app-release.aab"
    ;;
  *)
    echo "Usage: pnpm android:build [debug|release|bundle]" >&2
    exit 2
    ;;
esac

if [[ "$web_build_mode" == prod ]]; then
  pnpm build:prod
else
  pnpm exec vue-tsc --noEmit
  pnpm exec vite build --mode "$web_build_mode"
fi
pnpm exec cap sync android

if [[ "$(uname -o 2>/dev/null || true)" == Android && -x "$termux_aapt2" ]]; then
  if ! command -v proot-distro >/dev/null 2>&1; then
    echo "proot-distro is required for Android builds on this phone." >&2
    exit 1
  fi

  repository_root="$(pwd)"
  proot-distro login debian -- bash -lc \
    "cd '$repository_root/android' && ./gradlew '$gradle_task' --no-daemon -Pandroid.aapt2FromMavenOverride='$repository_root/$termux_aapt2'"
else
  (
    cd android
    ./gradlew "$gradle_task"
  )
fi

echo "Android build created: $artifact_path"
