#!/usr/bin/env bash
set -euo pipefail

source_db="${MOM_TEST_SOURCE_DB:-private/data.db}"
test_port="${MOM_TEST_PORT:-$((18100 + RANDOM % 800))}"
test_secret="mom-api-integration-secret-at-least-32-characters"
test_root="${TMPDIR:-/tmp}"
test_dir="$(mktemp -d "$test_root/mom-api-test.XXXXXX")"
test_db="$test_dir/data.db"
test_log="$test_dir/server.log"
server_pid=""

cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
  fi
  case "$test_dir" in
    "$test_root"/mom-api-test.*) rm -rf -- "$test_dir" ;;
  esac
}
trap cleanup EXIT

for command in php sqlite3 curl; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "$command is required for the API integration test." >&2
    exit 1
  }
done

[[ -f "$source_db" ]] || {
  echo "Source database not found: $source_db" >&2
  exit 1
}

sqlite3 "$source_db" ".backup $test_db"
MOM_DB_PATH="$test_db" \
MOM_API_SECRET="$test_secret" \
MOM_ALLOWED_ORIGINS="http://localhost:5173" \
MOM_PASSKEY_RP_ID="mom.example.test" \
MOM_PASSKEY_ANDROID_PACKAGE="dev.coulombe.mom" \
MOM_PASSKEY_ANDROID_KEY_HASHES="q9nLBq6siknwb9S8EaFfsZ-C1d5y_mHhbfaYSRnGE0k" \
  php -S "127.0.0.1:$test_port" -t server/public server/router.php >"$test_log" 2>&1 &
server_pid=$!

for _attempt in {1..50}; do
  curl --silent --fail "http://127.0.0.1:$test_port/health" >/dev/null && break
  kill -0 "$server_pid" >/dev/null 2>&1 || {
    sed -n '1,200p' "$test_log" >&2
    exit 1
  }
  sleep .1
done

api_url="http://127.0.0.1:$test_port"
suffix="$(php -r 'echo bin2hex(random_bytes(5));')"
password="correct-horse-battery"

migration_count="$(sqlite3 "$test_db" 'SELECT COUNT(*) FROM mom_schema_migrations;')"
[[ "$migration_count" == 14 ]] || {
  echo "The API did not apply the complete database migration sequence." >&2
  exit 1
}

same_origin_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Origin: http://127.0.0.1:$test_port" \
  "$api_url/health")"
[[ "$same_origin_status" == 200 ]] || {
  echo "Same-origin API access was rejected." >&2
  exit 1
}

foreign_origin_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Origin: https://untrusted.example" \
  "$api_url/health")"
[[ "$foreign_origin_status" == 403 ]] || {
  echo "An untrusted cross-origin request was not rejected." >&2
  exit 1
}

register() {
  local name="$1"
  local email="$2"
  curl --silent --show-error --fail \
    -H "Content-Type: application/json" \
    --data "{\"name\":\"$name\",\"email\":\"$email\",\"password\":\"$password\",\"passwordConfirm\":\"$password\",\"timezone\":\"America/Toronto\"}" \
    "$api_url/auth/register"
}

login() {
  local email="$1"
  curl --silent --show-error --fail \
    -H "Content-Type: application/json" \
    --data "{\"email\":\"$email\",\"password\":\"$password\"}" \
    "$api_url/auth/login"
}

json_field() {
  local field="$1"
  php -r '$data=json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR); echo $data[$argv[1]];' "$field"
}

alice_email="alice-$suffix@example.test"
bob_email="bob-$suffix@example.test"
register "Alice API" "$alice_email" >/dev/null
alice_login="$(login "$alice_email")"
alice_token="$(json_field token <<<"$alice_login")"
alice_id="$(php -r '$data=json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR); echo $data["record"]["id"];' <<<"$alice_login")"

account_response="$(curl --silent --show-error --fail \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"name":"Alice Updated"}' \
  "$api_url/auth/account")"
account_name="$(json_field name <<<"$account_response")"
account_email="$(json_field email <<<"$account_response")"
[[ "$account_name" == "Alice Updated" && "$account_email" == "$alice_email" ]] || {
  echo "The account profile was not updated correctly." >&2
  exit 1
}

avatar_base64="$(php -r '
  if (!function_exists("imagecreatetruecolor")) {
      fwrite(STDERR, "The GD extension is required for avatar integration tests.\n");
      exit(1);
  }
  $image = imagecreatetruecolor(256, 256);
  $color = imagecolorallocate($image, 120, 80, 200);
  imagefill($image, 0, 0, $color);
  ob_start();
  imagejpeg($image, null, 86);
  $bytes = ob_get_clean();
  imagedestroy($image);
  echo base64_encode($bytes);
')"
avatar_response="$(curl --silent --show-error --fail \
  -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"image\":\"data:image/jpeg;base64,$avatar_base64\"}" \
  "$api_url/auth/avatar")"
avatar_path="$(json_field avatar <<<"$avatar_response")"
[[ "$avatar_path" =~ ^/avatars/[a-f0-9]{48}\.jpg$ ]] || {
  echo "The avatar endpoint did not return a unique media URL." >&2
  exit 1
}
avatar_headers="$test_dir/avatar-headers.txt"
curl --silent --show-error --fail \
  --dump-header "$avatar_headers" \
  --output "$test_dir/avatar.jpg" \
  "$api_url$avatar_path"
grep -qi '^Content-Type: image/jpeg' "$avatar_headers" || {
  echo "The avatar was not served as a JPEG." >&2
  exit 1
}
php -r '
  $size = getimagesize($argv[1]);
  if (!is_array($size) || $size[0] !== 256 || $size[1] !== 256) {
      fwrite(STDERR, "The stored avatar dimensions are invalid.\n");
      exit(1);
  }
' "$test_dir/avatar.jpg"

replacement_response="$(curl --silent --show-error --fail \
  -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"image\":\"data:image/jpeg;base64,$avatar_base64\"}" \
  "$api_url/auth/avatar")"
replacement_path="$(json_field avatar <<<"$replacement_response")"
[[ "$replacement_path" =~ ^/avatars/[a-f0-9]{48}\.jpg$ && "$replacement_path" != "$avatar_path" ]] || {
  echo "Replacing an avatar did not generate a new media URL." >&2
  exit 1
}
replaced_avatar_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  "$api_url$avatar_path")"
[[ "$replaced_avatar_status" == 404 ]] || {
  echo "The replaced avatar URL is still available." >&2
  exit 1
}
avatar_path="$replacement_path"

invalid_avatar_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"image":"data:image/jpeg;base64,bm90LWEtanBlZw=="}' \
  "$api_url/auth/avatar")"
[[ "$invalid_avatar_status" == 422 ]] || {
  echo "The avatar endpoint accepted invalid image bytes." >&2
  exit 1
}

removed_avatar_response="$(curl --silent --show-error --fail \
  -X DELETE -H "Authorization: Bearer $alice_token" \
  "$api_url/auth/avatar")"
removed_avatar="$(json_field avatar <<<"$removed_avatar_response")"
[[ -z "$removed_avatar" ]] || {
  echo "The avatar was not removed from the account." >&2
  exit 1
}
removed_avatar_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  "$api_url$avatar_path")"
[[ "$removed_avatar_status" == 404 ]] || {
  echo "A removed avatar URL is still available." >&2
  exit 1
}

invalid_account_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"name":"   "}' \
  "$api_url/auth/account")"
[[ "$invalid_account_status" == 422 ]] || {
  echo "An empty account name was accepted." >&2
  exit 1
}

quick_settings_response="$(curl --silent --show-error --fail \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"quickInterval":{"warmupSeconds":0,"workSeconds":30,"restSeconds":15,"rounds":4,"cooldownSeconds":0,"restAfterLastRound":true,"includeRest":true,"cues":{"soundEnabled":true,"vibrationEnabled":false}}}' \
  "$api_url/auth/settings")"
php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  $quick = $data["settings"]["quickInterval"] ?? null;
  if (($quick["rounds"] ?? null) !== 4
      || ($quick["workSeconds"] ?? null) !== 30
      || ($quick["cues"]["vibrationEnabled"] ?? null) !== false) {
      fwrite(STDERR, "Quick interval settings were not returned after saving.\n");
      exit(1);
  }
' <<<"$quick_settings_response"
saved_settings_response="$(curl --silent --show-error --fail \
  -H "Authorization: Bearer $alice_token" \
  "$api_url/auth/settings")"
php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  if (($data["settings"]["quickInterval"]["rounds"] ?? null) !== 4) {
      fwrite(STDERR, "Quick interval settings were not persisted.\n");
      exit(1);
  }
' <<<"$saved_settings_response"
invalid_settings_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"quickInterval":{"rounds":99}}' \
  "$api_url/auth/settings")"
[[ "$invalid_settings_status" == 422 ]] || {
  echo "Invalid quick interval settings were not rejected." >&2
  exit 1
}

step_source_response="$(curl --silent --show-error --fail \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"stepSource":"health_connect"}' \
  "$api_url/auth/settings")"
step_source="$(php -r '$data=json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR); echo $data["settings"]["stepSource"] ?? "";' <<<"$step_source_response")"
[[ "$step_source" == "health_connect" ]] || {
  echo "The Health Connect step source was not persisted."
  exit 1
}
invalid_step_source_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"stepSource":"phone"}' \
  "$api_url/auth/settings")"
[[ "$invalid_step_source_status" == 422 ]] || {
  echo "An unsupported step source was not rejected." >&2
  exit 1
}

menu_order_response="$(curl --silent --show-error --fail \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"mainMenuOrder":["journal","tracking","tasks","intervals"]}' \
  "$api_url/auth/settings")"
menu_order="$(php -r '$data=json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR); echo implode(",", $data["settings"]["mainMenuOrder"] ?? []);' <<<"$menu_order_response")"
[[ "$menu_order" == "journal,tracking,tasks,intervals" ]] || {
  echo "The main menu order was not persisted." >&2
  exit 1
}
invalid_menu_order_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"mainMenuOrder":["tasks","tasks","tracking","journal"]}' \
  "$api_url/auth/settings")"
[[ "$invalid_menu_order_status" == 422 ]] || {
  echo "An invalid main menu order was not rejected." >&2
  exit 1
}

passkey_status="$(curl --silent --show-error --fail \
  -H "Authorization: Bearer $alice_token" \
  "$api_url/auth/passkeys/status")"
passkey_registered="$(json_field registered <<<"$passkey_status")"
[[ "$passkey_registered" == "" ]] || {
  echo "A new account was incorrectly reported as having a passkey." >&2
  exit 1
}

passkey_options="$(curl --silent --show-error --fail \
  -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{}' \
  "$api_url/auth/passkeys/register/options")"
passkey_ceremony="$(json_field ceremonyId <<<"$passkey_options")"
passkey_request_json="$(json_field requestJson <<<"$passkey_options")"
php -r '
  $request = json_decode($argv[1], true, 512, JSON_THROW_ON_ERROR);
  if (($request["rp"]["id"] ?? null) !== "mom.example.test"
      || ($request["authenticatorSelection"]["residentKey"] ?? null) !== "required"
      || ($request["authenticatorSelection"]["userVerification"] ?? null) !== "required") {
      fwrite(STDERR, "Passkey registration options are invalid.\n");
      exit(1);
  }
' "$passkey_request_json"

stored_challenge_count="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM mom_passkey_challenges WHERE id = '$passkey_ceremony' AND purpose = 'register';")"
[[ "$stored_challenge_count" == 1 ]] || {
  echo "The passkey registration challenge was not stored." >&2
  exit 1
}

passkey_challenge="$(php -r '
  $request = json_decode($argv[1], true, 512, JSON_THROW_ON_ERROR);
  echo $request["challenge"];
' "$passkey_request_json")"
fake_client_data="$(php -r '
  $data = json_encode([
    "type" => "webauthn.create",
    "challenge" => $argv[1],
    "origin" => "android:apk-key-hash:q9nLBq6siknwb9S8EaFfsZ-C1d5y_mHhbfaYSRnGE0k",
    "androidPackageName" => "dev.coulombe.mom",
    "crossOrigin" => false,
  ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
  echo rtrim(strtr(base64_encode($data), "+/", "-_"), "=");
' "$passkey_challenge")"
invalid_passkey_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"ceremonyId\":\"$passkey_ceremony\",\"credential\":{\"id\":\"AQ\",\"rawId\":\"AQ\",\"type\":\"public-key\",\"response\":{\"clientDataJSON\":\"$fake_client_data\",\"attestationObject\":\"AA\",\"transports\":[\"internal\"]}}}" \
  "$api_url/auth/passkeys/register/verify")"
[[ "$invalid_passkey_status" == 422 ]] || {
  echo "An invalid passkey attestation was not rejected." >&2
  exit 1
}
consumed_challenge_count="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM mom_passkey_challenges WHERE id = '$passkey_ceremony';")"
[[ "$consumed_challenge_count" == 0 ]] || {
  echo "A used passkey challenge was not consumed." >&2
  exit 1
}

sqlite3 "$test_db" "
  INSERT INTO mom_passkeys (
    credential_id, user_id, user_handle, public_key, signature_counter,
    transports, backup_eligible, backed_up, created, last_used
  ) VALUES (
    'test-credential', '$alice_id', 'test-user-handle', 'test-public-key', 0,
    '[]', 0, 0, '2026-07-29T00:00:00Z', ''
  );
"
passkey_status="$(curl --silent --show-error --fail \
  -H "Authorization: Bearer $alice_token" \
  "$api_url/auth/passkeys/status")"
passkey_registered="$(json_field registered <<<"$passkey_status")"
[[ "$passkey_registered" == "1" ]] || {
  echo "An existing passkey was not reported for its account." >&2
  exit 1
}

pending_passkey_options="$(curl --silent --show-error --fail \
  -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{}' \
  "$api_url/auth/passkeys/register/options")"
pending_passkey_ceremony="$(json_field ceremonyId <<<"$pending_passkey_options")"
disconnect_response="$(curl --silent --show-error --fail \
  -X DELETE \
  -H "Authorization: Bearer $alice_token" \
  "$api_url/auth/passkeys")"
disconnected_registered="$(json_field registered <<<"$disconnect_response")"
disconnected_removed="$(json_field removed <<<"$disconnect_response")"
[[ "$disconnected_registered" == "" && "$disconnected_removed" == "1" ]] || {
  echo "Disconnecting biometrics returned an invalid response." >&2
  exit 1
}
remaining_passkeys="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM mom_passkeys WHERE user_id = '$alice_id';")"
remaining_registration_challenges="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM mom_passkey_challenges WHERE id = '$pending_passkey_ceremony';")"
[[ "$remaining_passkeys" == 0 && "$remaining_registration_challenges" == 0 ]] || {
  echo "Disconnecting biometrics did not revoke all account credentials and pending setup requests." >&2
  exit 1
}

task_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"owner":"forged","name":"Secure task","description":"","type":"check","mandatory":true,"review_when_missed":false,"active":true,"start_date":"2026-07-29","end_date":"","recurrence_type":"daily","weekdays":[],"interval_weeks":1,"target_value":1,"target_operator":"gte","unit":"","custom_unit":"","goal_period":"occurrence","quick_amounts":[1],"cycle_length":0,"program_repeat":true,"program_strict":false,"sort_order":0,"color":"#C7F464"}' \
  "$api_url/collections/tasks/records")"
task_id="$(json_field id <<<"$task_response")"
task_owner="$(json_field owner <<<"$task_response")"
task_notes_enabled="$(json_field entry_notes_enabled <<<"$task_response")"
task_note_suggestions_enabled="$(json_field entry_note_suggestions_enabled <<<"$task_response")"
[[ "$task_owner" == "$alice_id" ]] || {
  echo "The API accepted a forged owner." >&2
  exit 1
}
[[ -z "$task_notes_enabled" && -z "$task_note_suggestions_enabled" ]] || {
  echo "New tasks did not default to disabled entry note options." >&2
  exit 1
}

task_note_settings_response="$(curl --silent --show-error --fail \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"entry_notes_enabled":true,"entry_note_suggestions_enabled":true}' \
  "$api_url/collections/tasks/records/$task_id")"
task_notes_enabled="$(json_field entry_notes_enabled <<<"$task_note_settings_response")"
task_note_suggestions_enabled="$(json_field entry_note_suggestions_enabled <<<"$task_note_settings_response")"
[[ "$task_notes_enabled" == 1 && "$task_note_suggestions_enabled" == 1 ]] || {
  echo "Task entry note settings were not persisted." >&2
  exit 1
}

entry_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"task\":\"$task_id\",\"occurrence\":\"\",\"program_step\":\"\",\"entry_date\":\"2026-08-02\",\"value\":12,\"kind\":\"quantity\",\"unit\":\"reps\",\"note\":\"Track run\"}" \
  "$api_url/collections/entries/records")"
entry_note="$(json_field note <<<"$entry_response")"
entry_created_at="$(json_field created_at <<<"$entry_response")"
[[ "$entry_note" == "Track run" && "$entry_created_at" =~ ^2026-[0-9]{2}-[0-9]{2}T ]] || {
  echo "A task entry did not persist its note and creation timestamp." >&2
  exit 1
}

long_entry_note="$(php -r 'echo str_repeat("x", 256);')"
long_entry_note_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"task\":\"$task_id\",\"entry_date\":\"2026-08-02\",\"value\":12,\"kind\":\"quantity\",\"unit\":\"reps\",\"note\":\"$long_entry_note\"}" \
  "$api_url/collections/entries/records")"
[[ "$long_entry_note_status" == 422 ]] || {
  echo "The API accepted a task entry note longer than 255 characters." >&2
  exit 1
}

multiline_entry_payload="$(php -r '
  echo json_encode([
    "task" => $argv[1], "entry_date" => "2026-08-02", "value" => 12,
    "kind" => "quantity", "unit" => "reps", "note" => "Track\nrun",
  ], JSON_THROW_ON_ERROR);
' "$task_id")"
multiline_entry_note_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$multiline_entry_payload" \
  "$api_url/collections/entries/records")"
[[ "$multiline_entry_note_status" == 422 ]] || {
  echo "The API accepted a multiline task entry note." >&2
  exit 1
}

interval_template_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"name":"Attached interval","description":"","color":"#66D9C8","definition":{"version":1,"children":[{"id":"step-1","type":"step","name":"Work","kind":"work","durationSeconds":1}]},"sound_enabled":true,"vibration_enabled":true,"sound":"beep","sort_order":0}' \
  "$api_url/collections/interval_templates/records")"
interval_template_id="$(json_field id <<<"$interval_template_response")"

interval_task_payload="$(php -r '
  echo json_encode([
    "name" => $argv[1], "description" => "", "type" => "interval",
    "mandatory" => true, "review_when_missed" => false, "active" => true,
    "start_date" => "2026-07-01", "end_date" => "", "recurrence_type" => "daily",
    "weekdays" => [], "interval_weeks" => 1, "target_value" => 1,
    "target_operator" => "gte", "unit" => "", "custom_unit" => "",
    "goal_period" => "occurrence", "quick_amounts" => [], "cycle_length" => 0,
    "program_repeat" => true, "program_strict" => false, "sort_order" => (int) $argv[2],
    "color" => "#66D9C8", "interval_template" => $argv[3],
  ], JSON_THROW_ON_ERROR);
' "Interval task one" 1 "$interval_template_id")"
interval_task_one_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$interval_task_payload" \
  "$api_url/collections/tasks/records")"
interval_task_one_id="$(json_field id <<<"$interval_task_one_response")"

interval_task_payload="$(php -r '
  echo json_encode([
    "name" => $argv[1], "description" => "", "type" => "interval",
    "mandatory" => true, "review_when_missed" => false, "active" => true,
    "start_date" => "2026-07-01", "end_date" => "", "recurrence_type" => "daily",
    "weekdays" => [], "interval_weeks" => 1, "target_value" => 1,
    "target_operator" => "gte", "unit" => "", "custom_unit" => "",
    "goal_period" => "occurrence", "quick_amounts" => [], "cycle_length" => 0,
    "program_repeat" => true, "program_strict" => false, "sort_order" => (int) $argv[2],
    "color" => "#66D9C8", "interval_template" => $argv[3],
  ], JSON_THROW_ON_ERROR);
' "Interval task two" 2 "$interval_template_id")"
interval_task_two_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$interval_task_payload" \
  "$api_url/collections/tasks/records")"
interval_task_two_id="$(json_field id <<<"$interval_task_two_response")"

session_payload="$(php -r '
  echo json_encode([
    "template" => $argv[1], "task" => $argv[2], "source" => "template",
    "status" => "running", "snapshot_name" => "Attached interval",
    "definition_snapshot" => ["version" => 1, "children" => [[
      "id" => "step-1", "type" => "step", "name" => "Work",
      "kind" => "work", "durationSeconds" => 1,
    ]]],
    "cue_snapshot" => ["soundEnabled" => true, "vibrationEnabled" => true],
    "started_at" => "2026-07-31T14:00:00Z", "planned_seconds" => 1,
    "elapsed_seconds" => 0, "runtime_state" => [
      "stepIndex" => 0, "remainingMs" => 1000,
      "stepStartedAt" => "2026-07-31T14:00:00Z", "accumulatedMs" => 0,
      "updatedAt" => "2026-07-31T14:00:00Z",
    ],
  ], JSON_THROW_ON_ERROR);
' "$interval_template_id" "$interval_task_one_id")"
attributed_session_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$session_payload" \
  "$api_url/collections/interval_sessions/records")"
attributed_session_id="$(json_field id <<<"$attributed_session_response")"
attributed_session_date="$(json_field task_date <<<"$attributed_session_response")"
[[ "$attributed_session_date" == "2026-07-31" ]] || {
  echo "The attributed interval did not use its Toronto start date." >&2
  exit 1
}

active_conflict_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$session_payload" \
  "$api_url/collections/interval_sessions/records")"
[[ "$active_conflict_status" == 409 ]] || {
  echo "The API allowed two active interval sessions." >&2
  exit 1
}

generic_complete_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"status":"completed"}' \
  "$api_url/collections/interval_sessions/records/$attributed_session_id")"
[[ "$generic_complete_status" == 422 ]] || {
  echo "A generic session update bypassed atomic interval completion." >&2
  exit 1
}

completion_payload='{"runtime_state":{"stepIndex":1,"remainingMs":0,"accumulatedMs":1000,"updatedAt":"2026-08-01T04:01:00Z"},"elapsed_seconds":1,"ended_at":"2026-08-01T04:01:00Z"}'
curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$completion_payload" \
  "$api_url/interval-sessions/$attributed_session_id/complete" >/dev/null
curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$completion_payload" \
  "$api_url/interval-sessions/$attributed_session_id/complete" >/dev/null

interval_note_response="$(curl --silent --show-error --fail \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"note":"Strong finish after a difficult middle round."}' \
  "$api_url/collections/interval_sessions/records/$attributed_session_id")"
interval_note="$(json_field note <<<"$interval_note_response")"
[[ "$interval_note" == "Strong finish after a difficult middle round." ]] || {
  echo "A completed interval note was not persisted." >&2
  exit 1
}

first_task_completion_count="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM occurrences WHERE task = '$interval_task_one_id' AND scheduled_date = '2026-07-31' AND status = 'completed';")"
second_task_completion_count="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM occurrences WHERE task = '$interval_task_two_id';")"
[[ "$first_task_completion_count" == 1 && "$second_task_completion_count" == 0 ]] || {
  echo "An attributed interval did not complete exactly one selected task." >&2
  exit 1
}

program_task_payload="$(php -r '
  echo json_encode([
    "name" => "Interval program", "description" => "", "type" => "program",
    "mandatory" => true, "review_when_missed" => false, "active" => true,
    "start_date" => "2026-07-29", "end_date" => "", "recurrence_type" => "daily",
    "weekdays" => [], "interval_weeks" => 1, "target_value" => 1,
    "target_operator" => "gte", "unit" => "", "custom_unit" => "",
    "goal_period" => "occurrence", "quick_amounts" => [], "cycle_length" => 3,
    "program_repeat" => true, "program_strict" => false, "sort_order" => 3,
    "color" => "#C7F464", "interval_template" => "",
  ], JSON_THROW_ON_ERROR);
')"
program_task_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$program_task_payload" \
  "$api_url/collections/tasks/records")"
program_task_id="$(json_field id <<<"$program_task_response")"

program_step_payload="$(php -r '
  echo json_encode([
    "task" => $argv[1], "name" => "Conditioning", "description" => "",
    "sort_order" => 0, "cycle_days" => [1], "completion_type" => "interval",
    "target_value" => 1, "target_operator" => "gte", "unit" => "",
    "custom_unit" => "", "quick_amounts" => [], "active" => true,
    "interval_template" => $argv[2],
  ], JSON_THROW_ON_ERROR);
' "$program_task_id" "$interval_template_id")"
program_step_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$program_step_payload" \
  "$api_url/collections/program_steps/records")"
program_step_id="$(json_field id <<<"$program_step_response")"

program_session_payload="$(php -r '
  $payload = json_decode($argv[1], true, 512, JSON_THROW_ON_ERROR);
  $payload["task"] = $argv[2];
  $payload["program_step"] = $argv[3];
  $payload["started_at"] = "2026-08-01T15:00:00Z";
  $payload["runtime_state"]["stepStartedAt"] = "2026-08-01T15:00:00Z";
  $payload["runtime_state"]["updatedAt"] = "2026-08-01T15:00:00Z";
  echo json_encode($payload, JSON_THROW_ON_ERROR);
' "$session_payload" "$program_task_id" "$program_step_id")"
program_session_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$program_session_payload" \
  "$api_url/collections/interval_sessions/records")"
program_session_id="$(json_field id <<<"$program_session_response")"
program_completion_payload='{"runtime_state":{"stepIndex":1,"remainingMs":0,"accumulatedMs":1000,"updatedAt":"2026-08-01T15:00:01Z"},"elapsed_seconds":1,"ended_at":"2026-08-01T15:00:01Z"}'
curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$program_completion_payload" \
  "$api_url/interval-sessions/$program_session_id/complete" >/dev/null

program_step_completion_count="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM occurrences WHERE task = '$program_task_id' AND program_step = '$program_step_id' AND scheduled_date = '2026-08-01' AND status = 'completed';")"
[[ "$program_step_completion_count" == 1 ]] || {
  echo "An attached interval did not complete its selected program step." >&2
  exit 1
}

standalone_session_payload="$(php -r '
  $payload = json_decode($argv[1], true, 512, JSON_THROW_ON_ERROR);
  $payload["task"] = "";
  $payload["started_at"] = "2026-08-01T14:00:00Z";
  $payload["runtime_state"]["stepStartedAt"] = "2026-08-01T14:00:00Z";
  $payload["runtime_state"]["updatedAt"] = "2026-08-01T14:00:00Z";
  echo json_encode($payload, JSON_THROW_ON_ERROR);
' "$session_payload")"
standalone_session_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$standalone_session_payload" \
  "$api_url/collections/interval_sessions/records")"
standalone_session_id="$(json_field id <<<"$standalone_session_response")"
standalone_completion_payload='{"runtime_state":{"stepIndex":1,"remainingMs":0,"accumulatedMs":1000,"updatedAt":"2026-08-01T14:00:01Z"},"elapsed_seconds":1,"ended_at":"2026-08-01T14:00:01Z"}'
standalone_completion_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$standalone_completion_payload" \
  "$api_url/interval-sessions/$standalone_session_id/complete")"
standalone_occurrence_is_null="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo $data["occurrence"] === null ? "yes" : "no";
' <<<"$standalone_completion_response")"
[[ "$standalone_occurrence_is_null" == yes ]] || {
  echo "A standalone interval unexpectedly completed a task." >&2
  exit 1
}

template_delete_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X DELETE -H "Authorization: Bearer $alice_token" \
  "$api_url/collections/interval_templates/records/$interval_template_id")"
[[ "$template_delete_status" == 409 ]] || {
  echo "The API deleted an interval that is still attached to tasks." >&2
  exit 1
}

injection_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -G -H "Authorization: Bearer $alice_token" \
  --data-urlencode 'filter=status = "running" OR 1=1' \
  "$api_url/collections/interval_sessions/records")"
[[ "$injection_status" == 422 ]] || {
  echo "An unsafe filter was not rejected." >&2
  exit 1
}

tracker_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"name":"Mood","description":"Daily mood","role":"outcome","kind":"rating","category":"mood","unit":"/ 10","scale_min":1,"scale_max":10,"favorable_direction":"higher","daily_aggregation":"average","active":true,"sort_order":0,"color":"#D4A5FF","icon":"mdi-emoticon-outline","reminder_enabled":true,"reminder_time":"20:30","reminder_show_name":false}' \
  "$api_url/collections/tracking_trackers/records")"
tracker_id="$(json_field id <<<"$tracker_response")"

journal_payload="$(php -r '
  echo json_encode([
    "title" => "After training", "body" => "I felt calmer after the final round.\nKeep the slower pace.",
    "occurred_at" => "2026-08-02T16:00:00Z", "local_date" => "2026-08-02",
    "timezone_offset" => 240, "task" => $argv[1], "tracker" => $argv[2],
  ], JSON_THROW_ON_ERROR);
' "$task_id" "$tracker_id")"
journal_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$journal_payload" \
  "$api_url/collections/journal_entries/records")"
journal_id="$(json_field id <<<"$journal_response")"
journal_task_snapshot="$(json_field task_snapshot <<<"$journal_response")"
journal_tracker_snapshot="$(json_field tracker_snapshot <<<"$journal_response")"
journal_created_at="$(json_field created_at <<<"$journal_response")"
[[ "$journal_task_snapshot" == "Secure task" && "$journal_tracker_snapshot" == "Mood" && "$journal_created_at" =~ T ]] || {
  echo "A journal entry did not retain its task and tracker context snapshots." >&2
  exit 1
}

journal_update_response="$(curl --silent --show-error --fail \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"title":"Training reflection"}' \
  "$api_url/collections/journal_entries/records/$journal_id")"
journal_updated_title="$(json_field title <<<"$journal_update_response")"
journal_updated_body="$(json_field body <<<"$journal_update_response")"
[[ "$journal_updated_title" == "Training reflection" && "$journal_updated_body" == *"Keep the slower pace."* ]] || {
  echo "Updating a journal entry did not preserve its unchanged reflection fields." >&2
  exit 1
}

journal_list_count="$(curl --silent --show-error --fail -G \
  -H "Authorization: Bearer $alice_token" \
  --data-urlencode 'filter=local_date >= "2026-08-01" && local_date <= "2026-08-03"' \
  "$api_url/collections/journal_entries/records" \
  | php -r '$data=json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR); echo $data["totalItems"];')"
[[ "$journal_list_count" == 1 ]] || {
  echo "Journal week filtering did not return the expected entry." >&2
  exit 1
}

long_journal_body="$(php -r 'echo str_repeat("x", 20001);')"
long_journal_payload="$(php -r '
  echo json_encode([
    "title" => "Too long", "body" => $argv[1],
    "occurred_at" => "2026-08-02T16:00:00Z", "local_date" => "2026-08-02",
    "timezone_offset" => 240, "task" => "", "tracker" => "",
  ], JSON_THROW_ON_ERROR);
' "$long_journal_body")"
long_journal_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$long_journal_payload" \
  "$api_url/collections/journal_entries/records")"
[[ "$long_journal_status" == 422 ]] || {
  echo "The API accepted a journal reflection longer than 20000 characters." >&2
  exit 1
}

tracking_entry_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"tracker\":\"$tracker_id\",\"occurred_at\":\"2026-07-31T20:00:00Z\",\"local_date\":\"2026-07-31\",\"timezone_offset\":240,\"value\":8,\"note\":\"Calm evening\"}" \
  "$api_url/collections/tracking_entries/records")"
tracking_entry_id="$(json_field id <<<"$tracking_entry_response")"

locked_tracker_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"scale_max":5}' \
  "$api_url/collections/tracking_trackers/records/$tracker_id")"
[[ "$locked_tracker_status" == 409 ]] || {
  echo "A tracker measurement definition changed after its first entry." >&2
  exit 1
}

invalid_reminder_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"reminder_time":"25:00"}' \
  "$api_url/collections/tracking_trackers/records/$tracker_id")"
[[ "$invalid_reminder_status" == 422 ]] || {
  echo "An invalid tracker reminder time was accepted." >&2
  exit 1
}

flashcard_tag_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"name":"Algebra"}' \
  "$api_url/collections/flashcard_tags/records")"
flashcard_tag_id="$(json_field id <<<"$flashcard_tag_response")"
duplicate_flashcard_tag_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"name":"algebra"}' \
  "$api_url/collections/flashcard_tags/records")"
[[ "$duplicate_flashcard_tag_status" == 409 ]] || {
  echo "Flashcard tag names were not enforced case-insensitively." >&2
  exit 1
}

flashcard_payload="$(php -r '
  echo json_encode([
    "front" => "What is 2 + 2?", "back" => "4", "tags" => [$argv[1]],
  ], JSON_THROW_ON_ERROR);
' "$flashcard_tag_id")"
flashcard_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$flashcard_payload" \
  "$api_url/collections/flashcards/records")"
flashcard_id="$(json_field id <<<"$flashcard_response")"
flashcard_created_at="$(json_field created_at <<<"$flashcard_response")"
[[ "$flashcard_created_at" =~ T ]] || {
  echo "A new flashcard did not receive server-owned timestamps." >&2
  exit 1
}

manual_review_set_payload="$(php -r '
  echo json_encode([
    "name" => "Daily algebra", "tags" => [$argv[1]], "mode" => "manual",
    "front_seconds" => 5, "back_seconds" => 5,
    "sort_mode" => "difficult", "sort_order" => 0,
  ], JSON_THROW_ON_ERROR);
' "$flashcard_tag_id")"
manual_review_set_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$manual_review_set_payload" \
  "$api_url/collections/flashcard_review_sets/records")"
manual_review_set_id="$(json_field id <<<"$manual_review_set_response")"

manual_session_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"task":"","program_step":"","task_date":""}' \
  "$api_url/flashcard-review-sets/$manual_review_set_id/sessions")"
manual_session_id="$(json_field id <<<"$manual_session_response")"
manual_session_total="$(json_field total_cards <<<"$manual_session_response")"
[[ "$manual_session_total" == 1 ]] || {
  echo "A Review set did not snapshot its matching card queue." >&2
  exit 1
}

manual_complete_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"action":"success","elapsed_seconds":7}' \
  "$api_url/flashcard-review-sessions/$manual_session_id/actions")"
manual_complete_status="$(php -r '$data=json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR); echo $data["session"]["status"];' <<<"$manual_complete_response")"
[[ "$manual_complete_status" == completed ]] || {
  echo "A graded flashcard did not complete its one-card review." >&2
  exit 1
}

passive_review_set_payload="$(php -r '
  echo json_encode([
    "name" => "Passive algebra", "tags" => [$argv[1]], "mode" => "passive",
    "front_seconds" => 3, "back_seconds" => 4,
    "speech_enabled" => true, "front_language" => "en-US", "back_language" => "fr-CA",
    "sort_mode" => "recently_added", "sort_order" => 1,
  ], JSON_THROW_ON_ERROR);
' "$flashcard_tag_id")"
passive_review_set_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$passive_review_set_payload" \
  "$api_url/collections/flashcard_review_sets/records")"
passive_review_set_id="$(json_field id <<<"$passive_review_set_response")"
passive_session_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"task":"","program_step":"","task_date":""}' \
  "$api_url/flashcard-review-sets/$passive_review_set_id/sessions")"
passive_session_id="$(json_field id <<<"$passive_session_response")"
passive_session_speech="$(php -r '
  $data=json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo ((int) $data["speech_enabled_snapshot"]) . ":" . $data["front_language_snapshot"] . ":" . $data["back_language_snapshot"];
' <<<"$passive_session_response")"
[[ "$passive_session_speech" == "1:en-US:fr-CA" ]] || {
  echo "A Review set did not snapshot its speech synthesis settings." >&2
  exit 1
}
passive_grade_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"action":"success","elapsed_seconds":2}' \
  "$api_url/flashcard-review-sessions/$passive_session_id/actions")"
[[ "$passive_grade_status" == 422 ]] || {
  echo "A Passive review accepted a graded result." >&2
  exit 1
}
invalid_speech_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"front_language":""}' \
  "$api_url/collections/flashcard_review_sets/records/$passive_review_set_id")"
[[ "$invalid_speech_status" == 422 ]] || {
  echo "An enabled Review set accepted an incomplete speech language configuration." >&2
  exit 1
}
curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"action":"view","elapsed_seconds":8}' \
  "$api_url/flashcard-review-sessions/$passive_session_id/actions" >/dev/null

flashcard_today="$(TZ=America/Toronto date +%F)"
flashcard_task_payload="$(php -r '
  echo json_encode([
    "name" => "Review algebra", "description" => "", "type" => "flashcards",
    "tags" => [], "mandatory" => true, "review_when_missed" => false,
    "active" => true, "start_date" => $argv[2], "end_date" => "",
    "recurrence_type" => "daily", "weekdays" => [], "interval_weeks" => 1,
    "target_value" => 1, "target_operator" => "gte", "unit" => "",
    "custom_unit" => "", "goal_period" => "occurrence", "quick_amounts" => [],
    "cycle_length" => 0, "program_repeat" => true, "program_strict" => false,
    "entry_notes_enabled" => false, "entry_note_suggestions_enabled" => false,
    "sort_order" => 10, "color" => "#C7F464", "interval_template" => "",
    "flashcard_review_set" => $argv[1],
  ], JSON_THROW_ON_ERROR);
' "$manual_review_set_id" "$flashcard_today")"
flashcard_task_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$flashcard_task_payload" \
  "$api_url/collections/tasks/records")"
flashcard_task_id="$(json_field id <<<"$flashcard_task_response")"
attached_flashcard_session_payload="$(php -r '
  echo json_encode(["task" => $argv[1], "program_step" => "", "task_date" => $argv[2]], JSON_THROW_ON_ERROR);
' "$flashcard_task_id" "$flashcard_today")"
attached_flashcard_session_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$attached_flashcard_session_payload" \
  "$api_url/flashcard-review-sets/$manual_review_set_id/sessions")"
attached_flashcard_session_id="$(json_field id <<<"$attached_flashcard_session_response")"
curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"action":"eject","elapsed_seconds":3}' \
  "$api_url/flashcard-review-sessions/$attached_flashcard_session_id/actions" >/dev/null
flashcard_occurrence_count="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM occurrences WHERE task = '$flashcard_task_id' AND scheduled_date = '$flashcard_today' AND status = 'completed';")"
[[ "$flashcard_occurrence_count" == 1 ]] || {
  echo "Exhausting an attached flashcard queue did not complete its task occurrence." >&2
  exit 1
}

flashcard_counts="$(sqlite3 "$test_db" \
  "SELECT success_count || ':' || error_count || ':' || passive_views FROM flashcards WHERE id = '$flashcard_id';")"
flashcard_event_count="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM flashcard_review_events WHERE card = '$flashcard_id';")"
[[ "$flashcard_counts" == "1:0:1" && "$flashcard_event_count" == 2 ]] || {
  echo "Flashcard aggregate and immutable event statistics drifted apart." >&2
  exit 1
}

attached_review_set_delete_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X DELETE -H "Authorization: Bearer $alice_token" \
  "$api_url/collections/flashcard_review_sets/records/$manual_review_set_id")"
[[ "$attached_review_set_delete_status" == 409 ]] || {
  echo "The API deleted a Review set that is still attached to a task." >&2
  exit 1
}

register "Bob API" "$bob_email" >/dev/null
bob_login="$(login "$bob_email")"
bob_token="$(json_field token <<<"$bob_login")"
cross_user_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $bob_token" \
  --data '{"name":"stolen"}' \
  "$api_url/collections/tasks/records/$task_id")"
[[ "$cross_user_status" == 404 ]] || {
  echo "Cross-user record isolation failed." >&2
  exit 1
}

cross_user_tracking_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $bob_token" \
  --data "{\"tracker\":\"$tracker_id\",\"occurred_at\":\"2026-07-31T21:00:00Z\",\"local_date\":\"2026-07-31\",\"timezone_offset\":240,\"value\":1,\"note\":\"\"}" \
  "$api_url/collections/tracking_entries/records")"
[[ "$cross_user_tracking_status" == 422 ]] || {
  echo "Cross-user tracker relation isolation failed." >&2
  exit 1
}

cross_user_journal_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $bob_token" \
  --data "$journal_payload" \
  "$api_url/collections/journal_entries/records")"
[[ "$cross_user_journal_status" == 422 ]] || {
  echo "Cross-user journal context isolation failed." >&2
  exit 1
}

cross_user_flashcard_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Authorization: Bearer $bob_token" \
  "$api_url/collections/flashcards/records/$flashcard_id")"
cross_user_review_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $bob_token" \
  --data '{"task":"","program_step":"","task_date":""}' \
  "$api_url/flashcard-review-sets/$manual_review_set_id/sessions")"
[[ "$cross_user_flashcard_status" == 404 && "$cross_user_review_status" == 404 ]] || {
  echo "Cross-user flashcard and Review set isolation failed." >&2
  exit 1
}

flashcard_tag_delete_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X DELETE -H "Authorization: Bearer $alice_token" \
  "$api_url/collections/flashcard_tags/records/$flashcard_tag_id")"
flashcard_tags_after_delete="$(sqlite3 "$test_db" \
  "SELECT json_array_length(tags) FROM flashcards WHERE id = '$flashcard_id';")"
review_set_tags_after_delete="$(sqlite3 "$test_db" \
  "SELECT SUM(json_array_length(tags)) FROM flashcard_review_sets WHERE id IN ('$manual_review_set_id', '$passive_review_set_id');")"
[[ "$flashcard_tag_delete_status" == 204 && "$flashcard_tags_after_delete" == 0 && "$review_set_tags_after_delete" == 0 ]] || {
  echo "Flashcard tag deletion did not detach cards and Review sets safely." >&2
  exit 1
}

flashcard_delete_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X DELETE -H "Authorization: Bearer $alice_token" \
  "$api_url/collections/flashcards/records/$flashcard_id")"
flashcard_history_snapshot="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM flashcard_review_events WHERE card = '' AND front_snapshot = 'What is 2 + 2?' AND back_snapshot = '4';")"
[[ "$flashcard_delete_status" == 204 && "$flashcard_history_snapshot" == 2 ]] || {
  echo "Deleting a flashcard did not preserve and detach its review history snapshots." >&2
  exit 1
}

flashcard_task_delete_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X DELETE -H "Authorization: Bearer $alice_token" \
  "$api_url/collections/tasks/records/$flashcard_task_id")"
detached_flashcard_session_count="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM flashcard_review_sessions WHERE id = '$attached_flashcard_session_id' AND task = '' AND program_step = '';")"
[[ "$flashcard_task_delete_status" == 204 && "$detached_flashcard_session_count" == 1 ]] || {
  echo "Deleting a flashcard task did not preserve and detach its session history." >&2
  exit 1
}

for review_set_id in "$manual_review_set_id" "$passive_review_set_id"; do
  review_set_delete_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
    -X DELETE -H "Authorization: Bearer $alice_token" \
    "$api_url/collections/flashcard_review_sets/records/$review_set_id")"
  [[ "$review_set_delete_status" == 204 ]] || {
    echo "Deleting an unattached Review set failed." >&2
    exit 1
  }
done
detached_review_set_sessions="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM flashcard_review_sessions WHERE id IN ('$manual_session_id', '$passive_session_id', '$attached_flashcard_session_id') AND review_set = '';")"
[[ "$detached_review_set_sessions" == 3 ]] || {
  echo "Review set deletion did not preserve and detach session history." >&2
  exit 1
}

tracker_delete_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X DELETE -H "Authorization: Bearer $alice_token" \
  "$api_url/collections/tracking_trackers/records/$tracker_id")"
remaining_tracking_entries="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM tracking_entries WHERE id = '$tracking_entry_id';")"
[[ "$tracker_delete_status" == 204 && "$remaining_tracking_entries" == 0 ]] || {
  echo "Permanent tracker deletion did not cascade to its entries." >&2
  exit 1
}
journal_after_tracker_delete="$(sqlite3 "$test_db" \
  "SELECT tracker || ':' || tracker_snapshot FROM journal_entries WHERE id = '$journal_id';")"
[[ "$journal_after_tracker_delete" == ":Mood" ]] || {
  echo "Tracker deletion did not safely detach its journal context." >&2
  exit 1
}

delete_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X DELETE -H "Authorization: Bearer $alice_token" \
  "$api_url/collections/tasks/records/$task_id")"
[[ "$delete_status" == 204 ]] || {
  echo "Task deletion failed." >&2
  exit 1
}
journal_after_task_delete="$(sqlite3 "$test_db" \
  "SELECT task || ':' || task_snapshot FROM journal_entries WHERE id = '$journal_id';")"
[[ "$journal_after_task_delete" == ":Secure task" ]] || {
  echo "Task deletion did not safely detach its journal context." >&2
  exit 1
}

journal_delete_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X DELETE -H "Authorization: Bearer $alice_token" \
  "$api_url/collections/journal_entries/records/$journal_id")"
[[ "$journal_delete_status" == 204 ]] || {
  echo "Journal entry deletion failed." >&2
  exit 1
}

echo "PHP API integration and isolation checks passed."
