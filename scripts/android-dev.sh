#!/usr/bin/env bash

set -euo pipefail

vite_port=5173
pocketbase_port=8090
vite_pid=""
pocketbase_pid=""
device_serial=""
stop_requested=false

cleanup() {
  if [[ -n "$device_serial" ]]; then
    adb -s "$device_serial" reverse --remove "tcp:$vite_port" >/dev/null 2>&1 || true
    adb -s "$device_serial" reverse --remove "tcp:$pocketbase_port" >/dev/null 2>&1 || true
  fi

  if [[ -n "$vite_pid" ]]; then
    kill "$vite_pid" >/dev/null 2>&1 || true
    wait "$vite_pid" >/dev/null 2>&1 || true
  fi

  if [[ -n "$pocketbase_pid" ]]; then
    kill "$pocketbase_pid" >/dev/null 2>&1 || true
    wait "$pocketbase_pid" >/dev/null 2>&1 || true
  fi
}

wait_for_url() {
  local label="$1"
  local url="$2"
  local process_id="$3"

  for _attempt in {1..120}; do
    if curl --silent --fail --output /dev/null "$url"; then
      echo "$label is ready."
      return
    fi
    if [[ -n "$process_id" ]] && ! kill -0 "$process_id" >/dev/null 2>&1; then
      echo "$label stopped before becoming ready." >&2
      exit 1
    fi
    sleep .25
  done

  echo "Timed out waiting for $label at $url." >&2
  exit 1
}

find_android_device() {
  adb start-server >/dev/null

  while true; do
    mapfile -t ready_devices < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')

    if [[ -n "${ANDROID_SERIAL:-}" ]]; then
      for candidate in "${ready_devices[@]}"; do
        if [[ "$candidate" == "$ANDROID_SERIAL" ]]; then
          device_serial="$candidate"
          return
        fi
      done
      echo "Waiting for Android device $ANDROID_SERIAL to be authorized…"
    elif (( ${#ready_devices[@]} == 1 )); then
      device_serial="${ready_devices[0]}"
      return
    elif (( ${#ready_devices[@]} > 1 )); then
      echo "More than one Android device is connected. Run with ANDROID_SERIAL=<device-id> pnpm android:dev." >&2
      adb devices -l >&2
      exit 1
    elif adb devices | awk 'NR > 1 && $2 == "unauthorized" { found = 1 } END { exit !found }'; then
      echo "Unlock the phone and accept the USB debugging authorization prompt…"
    else
      echo "Waiting for an Android phone with USB debugging enabled…"
    fi

    sleep 2
  done
}

trap cleanup EXIT
trap 'stop_requested=true' INT TERM

if ! command -v adb >/dev/null 2>&1; then
  echo "adb is required. Install Android SDK Platform Tools first." >&2
  exit 1
fi

if [[ -z "${JAVA_HOME:-}" || ! -x "$JAVA_HOME/bin/java" ]]; then
  java_command="$(command -v java || true)"
  if [[ -z "$java_command" ]]; then
    echo "Java is required. Install Android Studio or JDK 21+." >&2
    exit 1
  fi
  java_binary="$(readlink -f "$java_command")"
  export JAVA_HOME="${java_binary%/bin/java}"
fi

find_android_device
echo "Using Android device $device_serial."

pnpm build

if curl --silent --fail --output /dev/null "http://127.0.0.1:$pocketbase_port/api/health"; then
  echo "Using PocketBase already running on port $pocketbase_port."
else
  bash scripts/run-pocketbase.sh &
  pocketbase_pid=$!
  wait_for_url "PocketBase" "http://127.0.0.1:$pocketbase_port/api/health" "$pocketbase_pid"
fi

if curl --silent --fail --output /dev/null "http://127.0.0.1:$vite_port"; then
  echo "Using Vite already running on port $vite_port."
else
  VITE_POCKETBASE_URL="http://localhost:$pocketbase_port" \
    pnpm exec vite --host 0.0.0.0 --port "$vite_port" --strictPort &
  vite_pid=$!
  wait_for_url "Vite" "http://127.0.0.1:$vite_port" "$vite_pid"
fi

adb -s "$device_serial" reverse "tcp:$vite_port" "tcp:$vite_port"
adb -s "$device_serial" reverse "tcp:$pocketbase_port" "tcp:$pocketbase_port"

echo "Launching REP with live reload. Press Ctrl+C to stop."
set +e
pnpm exec cap run android \
  --target "$device_serial" \
  --live-reload \
  --host localhost \
  --port "$vite_port"
capacitor_status=$?
set -e

if [[ "$stop_requested" == true || "$capacitor_status" -eq 130 ]]; then
  echo "Android live development stopped."
  exit 0
fi

exit "$capacitor_status"
