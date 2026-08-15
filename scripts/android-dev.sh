#!/usr/bin/env bash

set -euo pipefail

vite_port=5183
api_port=8090
vite_pid=""
api_pid=""
device_serial=""
stop_requested=false
wireless_address="${ANDROID_WIRELESS_ADDRESS:-}"
pair_address="${ANDROID_PAIR_ADDRESS:-}"
pair_code="${ANDROID_PAIR_CODE:-}"

usage() {
  cat <<'EOF'
Usage: pnpm android:dev -- [options]

Options:
  --wireless HOST:PORT  Connect explicitly instead of using mDNS discovery.
  --pair HOST:PORT      Pair the phone before connecting.
  --pair-code CODE      Wireless debugging pairing code (prompted if omitted).
  --help                Show this help.

Environment equivalents:
  ANDROID_WIRELESS_ADDRESS, ANDROID_PAIR_ADDRESS, ANDROID_PAIR_CODE
  ANDROID_SERIAL can still select any connected USB or wireless device.
EOF
}

while (( $# )); do
  case "$1" in
    --wireless|--connect)
      [[ $# -ge 2 ]] || { echo "$1 requires HOST:PORT." >&2; exit 2; }
      wireless_address="$2"
      shift 2
      ;;
    --pair)
      [[ $# -ge 2 ]] || { echo "$1 requires HOST:PORT." >&2; exit 2; }
      pair_address="$2"
      shift 2
      ;;
    --pair-code)
      [[ $# -ge 2 ]] || { echo "$1 requires a pairing code." >&2; exit 2; }
      pair_code="$2"
      shift 2
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
done

cleanup() {
  if [[ -n "$device_serial" ]]; then
    adb -s "$device_serial" reverse --remove "tcp:$vite_port" >/dev/null 2>&1 || true
    adb -s "$device_serial" reverse --remove "tcp:$api_port" >/dev/null 2>&1 || true
  fi

  if [[ -n "$vite_pid" ]]; then
    kill "$vite_pid" >/dev/null 2>&1 || true
    wait "$vite_pid" >/dev/null 2>&1 || true
  fi

  if [[ -n "$api_pid" ]]; then
    kill "$api_pid" >/dev/null 2>&1 || true
    wait "$api_pid" >/dev/null 2>&1 || true
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

avahi_android_services() {
  local service_type="$1"

  if ! command -v python3 >/dev/null 2>&1 ||
    ! python3 -c 'import dbus; from dbus.mainloop.glib import DBusGMainLoop; from gi.repository import GLib' >/dev/null 2>&1; then
    return
  fi

  python3 - "$service_type" 2>/dev/null <<'PY'
import sys

import dbus
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

service_type = sys.argv[1]
DBusGMainLoop(set_as_default=True)
bus = dbus.SystemBus()
server = dbus.Interface(
    bus.get_object("org.freedesktop.Avahi", "/"),
    "org.freedesktop.Avahi.Server",
)
loop = GLib.MainLoop()
found = set()


def on_service(interface, protocol, name, discovered_type, domain, flags):
    try:
        resolved = server.ResolveService(
            interface,
            protocol,
            name,
            discovered_type,
            domain,
            -1,
            0,
        )
        address = str(resolved[7])
        port = int(resolved[8])
        found.add((str(name), str(discovered_type), f"{address}:{port}"))
    except dbus.DBusException:
        pass


browser_path = server.ServiceBrowserNew(-1, -1, service_type, "local", 0)
browser = dbus.Interface(
    bus.get_object("org.freedesktop.Avahi", browser_path),
    "org.freedesktop.Avahi.ServiceBrowser",
)
browser.connect_to_signal("ItemNew", on_service)
GLib.timeout_add(1200, lambda: (loop.quit(), False)[1])
loop.run()

for name, discovered_type, address in sorted(found):
    print(name, discovered_type, address)
PY
}

mdns_services() {
  local service_type="$1"

  {
    adb mdns services 2>/dev/null || true
    ADB_MDNS_OPENSCREEN=1 adb mdns services 2>/dev/null || true
    avahi_android_services "$service_type" || true
  } | awk '!seen[$0]++'
}

discover_mdns_addresses() {
  local service_type="$1"

  mdns_services "$service_type" |
    awk -v service_type="$service_type" '
      index($0, service_type) && $NF ~ /:[0-9]+$/ { print $NF }
    ' |
    sort -u
}

find_android_device() {
  adb start-server >/dev/null

  if [[ -n "$pair_address" ]]; then
    if [[ -z "$pair_code" ]]; then
      if [[ ! -t 0 ]]; then
        echo "ANDROID_PAIR_CODE or --pair-code is required without an interactive terminal." >&2
        exit 1
      fi
      read -r -p "Enter the wireless debugging pairing code: " pair_code
    fi
    echo "Pairing with Android device at $pair_address…"
    adb pair "$pair_address" "$pair_code"
  fi

  if [[ -z "$wireless_address" && "${ANDROID_SERIAL:-}" == *:* ]]; then
    wireless_address="$ANDROID_SERIAL"
  fi
  if [[ -n "$wireless_address" ]]; then
    echo "Connecting to Android device at $wireless_address…"
    adb connect "$wireless_address"
  fi

  local requested_serial="${ANDROID_SERIAL:-$wireless_address}"
  while true; do
    mapfile -t ready_devices < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')

    if [[ -n "$requested_serial" ]]; then
      for candidate in "${ready_devices[@]}"; do
        if [[ "$candidate" == "$requested_serial" ]]; then
          device_serial="$candidate"
          return
        fi
      done
      echo "Waiting for Android device $requested_serial to be available…"
    elif (( ${#ready_devices[@]} == 1 )); then
      device_serial="${ready_devices[0]}"
      return
    elif (( ${#ready_devices[@]} > 1 )); then
      echo "More than one Android device is connected. Run with ANDROID_SERIAL=<device-id> pnpm android:dev." >&2
      adb devices -l >&2
      exit 1
    elif adb devices | awk 'NR > 1 && $2 == "unauthorized" { found = 1 } END { exit !found }'; then
      echo "Unlock the phone and accept the debugging authorization prompt…"
    else
      mapfile -t discovered_wireless_devices < <(
        discover_mdns_addresses "_adb-tls-connect._tcp"
      )
      if (( ${#discovered_wireless_devices[@]} == 1 )); then
        requested_serial="${discovered_wireless_devices[0]}"
        echo "Discovered paired wireless Android device at $requested_serial."
        adb connect "$requested_serial"
        continue
      fi
      if (( ${#discovered_wireless_devices[@]} > 1 )); then
        echo "More than one paired wireless Android device was discovered:" >&2
        printf '  %s\n' "${discovered_wireless_devices[@]}" >&2
        echo "Select one with pnpm android:dev -- --wireless HOST:PORT." >&2
        exit 1
      fi

      mapfile -t discovered_pairing_devices < <(
        discover_mdns_addresses "_adb-tls-pairing._tcp"
      )
      if (( ${#discovered_pairing_devices[@]} == 1 )); then
        if [[ ! -t 0 ]]; then
          echo "A wireless pairing device was found at ${discovered_pairing_devices[0]}, but a pairing code is required." >&2
          exit 1
        fi
        read -r -p "Discovered Android wireless pairing. Enter the six-digit code: " discovered_pair_code
        adb pair "${discovered_pairing_devices[0]}" "$discovered_pair_code"
        continue
      fi
      if (( ${#discovered_pairing_devices[@]} > 1 )); then
        echo "More than one Android wireless pairing service was discovered:" >&2
        printf '  %s\n' "${discovered_pairing_devices[@]}" >&2
        echo "Select one with pnpm android:dev -- --pair HOST:PORT." >&2
        exit 1
      fi
      echo "Waiting for an Android phone with USB or wireless debugging enabled…"
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
if [[ "$device_serial" == *:* ]]; then
  echo "Using wireless Android device $device_serial."
else
  echo "Using USB Android device $device_serial."
fi

pnpm build

if curl --silent --fail --output /dev/null "http://127.0.0.1:$api_port/health"; then
  echo "Using the PHP API already running on port $api_port."
else
  bash scripts/run-php-api.sh &
  api_pid=$!
  wait_for_url "PHP API" "http://127.0.0.1:$api_port/health" "$api_pid"
fi

if curl --silent --fail --output /dev/null "http://127.0.0.1:$vite_port"; then
  echo "Using Vite already running on port $vite_port."
else
  VITE_API_URL="http://localhost:$api_port" \
    pnpm exec vite --host 0.0.0.0 --port "$vite_port" --strictPort &
  vite_pid=$!
  wait_for_url "Vite" "http://127.0.0.1:$vite_port" "$vite_pid"
fi

adb -s "$device_serial" reverse "tcp:$vite_port" "tcp:$vite_port"
adb -s "$device_serial" reverse "tcp:$api_port" "tcp:$api_port"

echo "Launching BackOnTrack with live reload. Press Ctrl+C to stop."
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
