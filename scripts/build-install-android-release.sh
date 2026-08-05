#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
apk_path="$repository_root/android/app/build/outputs/apk/release/app-release.apk"
application_id="dev.coulombe.mom"

usage() {
  cat <<'EOF'
Usage: pnpm android:build:install:release [-- --adb [DEVICE]]

Build the signed release APK and install it.

With no options, the script opens Android's package installer when running
inside Termux and uses ADB on desktop hosts. Use --adb to force ADB instead
(optionally selecting DEVICE).

For a Termux install, Android may first ask you to allow Termux to install
unknown apps. Release signing files must exist in private/.
EOF
}

install_method="auto"
device_serial=""

while (( $# )); do
  case "$1" in
    --)
      ;;
    --adb)
      install_method="adb"
      if [[ $# -ge 2 && "$2" != --* ]]; then
        device_serial="$2"
        shift
      fi
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ "$install_method" == auto ]]; then
  if [[ "$(uname -o 2>/dev/null || true)" == Android ]]; then
    install_method="package-installer"
  else
    install_method="adb"
  fi
fi

case "$install_method" in
  package-installer)
    if ! command -v termux-open >/dev/null 2>&1; then
      echo "termux-open is required for installation from Termux." >&2
      echo "Install or update the Termux tools package, or rerun with --adb." >&2
      exit 1
    fi
    ;;
  adb)
    if ! command -v adb >/dev/null 2>&1; then
      echo "adb is required for installation from this host." >&2
      exit 1
    fi
    ;;
esac

cd "$repository_root"

if [[ ! -r private/android-signing.properties || ! -r private/mom-release.jks ]]; then
  echo "Release signing files are missing:" >&2
  echo "  private/android-signing.properties" >&2
  echo "  private/mom-release.jks" >&2
  echo "Restore them from backup before building a release." >&2
  exit 1
fi

pnpm android:build:release

if [[ ! -s "$apk_path" ]]; then
  echo "The release build completed without creating $apk_path." >&2
  exit 1
fi

case "$install_method" in
  package-installer)
    echo "Opening Android's installer for $application_id…"
    echo "Approve the update in the system dialog to finish installation."
    termux-open --content-type application/vnd.android.package-archive "$apk_path"
    ;;
  adb)
    adb_args=()
    if [[ -n "$device_serial" ]]; then
      adb_args=(-s "$device_serial")
    fi
    adb "${adb_args[@]}" install -r "$apk_path"
    echo "Installed $application_id from $apk_path."
    ;;
esac
