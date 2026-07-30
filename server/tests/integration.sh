#!/usr/bin/env bash
set -euo pipefail

source_db="${MOM_TEST_SOURCE_DB:-private/data.db}"
test_port="${MOM_TEST_PORT:-$((18100 + RANDOM % 800))}"
test_secret="mom-api-integration-secret-at-least-32-characters"
test_dir="$(mktemp -d /tmp/mom-api-test.XXXXXX)"
test_db="$test_dir/data.db"
test_log="$test_dir/server.log"
server_pid=""

cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
  fi
  case "$test_dir" in
    /tmp/mom-api-test.*) rm -rf -- "$test_dir" ;;
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
[[ "$migration_count" == 3 ]] || {
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

task_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"owner":"forged","name":"Secure task","description":"","type":"check","mandatory":true,"review_when_missed":false,"active":true,"start_date":"2026-07-29","end_date":"","recurrence_type":"daily","weekdays":[],"interval_weeks":1,"target_value":1,"target_operator":"gte","unit":"","custom_unit":"","goal_period":"occurrence","quick_amounts":[1],"cycle_length":0,"program_repeat":true,"program_strict":false,"sort_order":0,"color":"#C7F464"}' \
  "$api_url/collections/tasks/records")"
task_id="$(json_field id <<<"$task_response")"
task_owner="$(json_field owner <<<"$task_response")"
[[ "$task_owner" == "$alice_id" ]] || {
  echo "The API accepted a forged owner." >&2
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

delete_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X DELETE -H "Authorization: Bearer $alice_token" \
  "$api_url/collections/tasks/records/$task_id")"
[[ "$delete_status" == 204 ]] || {
  echo "Task deletion failed." >&2
  exit 1
}

echo "PHP API integration and isolation checks passed."
