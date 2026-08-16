#!/usr/bin/env bash
set -euo pipefail

source_db="${BACKONTRACK_TEST_SOURCE_DB:-private/data.db}"
test_port="${BACKONTRACK_TEST_PORT:-$((18100 + RANDOM % 800))}"
smtp_port="$((test_port + 3000))"
test_secret="backontrack-api-integration-secret-at-least-32-characters"
test_root="${TMPDIR:-/tmp}"
test_dir="$(mktemp -d "$test_root/backontrack-api-test.XXXXXX")"
test_db="$test_dir/data.db"
test_log="$test_dir/server.log"
smtp_log="$test_dir/smtp.log"
smtp_mailbox="$test_dir/mailbox.txt"
server_pid=""
smtp_pid=""

cleanup() {
  cleanup_status=$?
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$smtp_pid" ]]; then
    kill "$smtp_pid" >/dev/null 2>&1 || true
    wait "$smtp_pid" >/dev/null 2>&1 || true
  fi
  if [[ "$cleanup_status" -ne 0 && -f "$test_log" ]]; then
    sed -n '1,240p' "$test_log" >&2
  fi
  case "$test_dir" in
    "$test_root"/backontrack-api-test.*) rm -rf -- "$test_dir" ;;
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
php server/tests/fixtures/smtp-server.php "$smtp_port" "$smtp_mailbox" >"$smtp_log" 2>&1 &
smtp_pid=$!

for _attempt in {1..50}; do
  php -r '
    $socket = @fsockopen("127.0.0.1", (int) $argv[1], $errorCode, $errorMessage, .1);
    if ($socket === false) exit(1);
    fclose($socket);
  ' "$smtp_port" && break
  kill -0 "$smtp_pid" >/dev/null 2>&1 || {
    sed -n '1,200p' "$smtp_log" >&2
    exit 1
  }
  sleep .1
done

BACKONTRACK_DB_PATH="$test_db" \
BACKONTRACK_API_SECRET="$test_secret" \
BACKONTRACK_ALLOWED_ORIGINS="http://localhost:5183" \
BACKONTRACK_APP_URL="http://127.0.0.1:$test_port" \
BACKONTRACK_MAIL_HOST="127.0.0.1" \
BACKONTRACK_MAIL_PORT="$smtp_port" \
BACKONTRACK_MAIL_USERNAME="" \
BACKONTRACK_MAIL_PASSWORD="" \
BACKONTRACK_MAIL_ENCRYPTION="none" \
BACKONTRACK_MAIL_FROM_ADDRESS="backontrack@example.test" \
BACKONTRACK_MAIL_FROM_NAME="BackOnTrack" \
BACKONTRACK_PASSKEY_RP_ID="backontrack.example.test" \
BACKONTRACK_PASSKEY_ANDROID_PACKAGE="app.backontrack.android" \
BACKONTRACK_PASSKEY_ANDROID_KEY_HASHES="q9nLBq6siknwb9S8EaFfsZ-C1d5y_mHhbfaYSRnGE0k" \
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

migration_count="$(sqlite3 "$test_db" 'SELECT COUNT(*) FROM backontrack_schema_migrations;')"
[[ "$migration_count" == 44 ]] || {
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

mail_token() {
  local purpose="$1"
  php -r '
    $mail = file_get_contents($argv[1]);
    $purpose = preg_quote($argv[2], "~");
    preg_match_all("~/{$purpose}\\?token(?:=3D|=)([a-f0-9]{64})~", $mail, $matches);
    echo $matches[1] === [] ? "" : end($matches[1]);
  ' "$smtp_mailbox" "$purpose"
}

confirm_latest_email() {
  local verification_token
  verification_token="$(mail_token verify-email)"
  [[ "$verification_token" =~ ^[a-f0-9]{64}$ ]] || {
    echo "A registration confirmation email was not delivered." >&2
    exit 1
  }
  curl --silent --show-error --fail \
    -H "Content-Type: application/json" \
    --data "{\"token\":\"$verification_token\"}" \
    "$api_url/auth/email-verification" >/dev/null
}

json_field() {
  local field="$1"
  php -r '$data=json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR); echo $data[$argv[1]];' "$field"
}

alice_email="alice-$suffix@example.test"
bob_email="bob-$suffix@example.test"
register "Alice API" "$alice_email" >/dev/null
unverified_login_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Content-Type: application/json" \
  --data "{\"email\":\"$alice_email\",\"password\":\"$password\"}" \
  "$api_url/auth/login")"
[[ "$unverified_login_status" == 403 ]] || {
  echo "An unverified account was allowed to sign in." >&2
  exit 1
}
alice_verification_token="$(mail_token verify-email)"
[[ "$alice_verification_token" =~ ^[a-f0-9]{64}$ ]] || {
  echo "Registration did not send an email confirmation link." >&2
  exit 1
}
decoded_mailbox="$(php -r 'echo quoted_printable_decode(file_get_contents($argv[1]));' "$smtp_mailbox")"
grep -q 'bgcolor="#C7F464"' <<<"$decoded_mailbox" \
  && grep -q 'background-color:#C7F464' <<<"$decoded_mailbox" \
  && grep -q 'border:12px solid #C7F464' <<<"$decoded_mailbox" \
  && grep -q 'color:#191c19' <<<"$decoded_mailbox" || {
  echo "The account email did not use the BackOnTrack action button colors." >&2
  exit 1
}
raw_verification_tokens="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM backontrack_auth_tokens WHERE token_hash = '$alice_verification_token';")"
[[ "$raw_verification_tokens" == 0 ]] || {
  echo "The raw email verification token was stored in the database." >&2
  exit 1
}
curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  --data "{\"token\":\"$alice_verification_token\"}" \
  "$api_url/auth/email-verification" >/dev/null
reused_verification_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Content-Type: application/json" \
  --data "{\"token\":\"$alice_verification_token\"}" \
  "$api_url/auth/email-verification")"
[[ "$reused_verification_status" == 422 ]] || {
  echo "A used email verification token was accepted again." >&2
  exit 1
}
alice_login="$(login "$alice_email")"
alice_token="$(json_field token <<<"$alice_login")"
alice_id="$(php -r '$data=json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR); echo $data["record"]["id"];' <<<"$alice_login")"

forgot_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  --data "{\"email\":\"$alice_email\"}" \
  "$api_url/auth/password/forgot")"
reset_token="$(mail_token reset-password)"
[[ "$reset_token" =~ ^[a-f0-9]{64}$ ]] || {
  echo "The forgot-password request did not send a reset link." >&2
  exit 1
}
raw_reset_tokens="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM backontrack_auth_tokens WHERE token_hash = '$reset_token';")"
[[ "$raw_reset_tokens" == 0 ]] || {
  echo "The raw password reset token was stored in the database." >&2
  exit 1
}
old_password="$password"
password="new-correct-horse-battery"
curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  --data "{\"token\":\"$reset_token\",\"password\":\"$password\",\"passwordConfirm\":\"$password\"}" \
  "$api_url/auth/password/reset" >/dev/null
revoked_session_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Authorization: Bearer $alice_token" \
  "$api_url/auth/account")"
old_password_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Content-Type: application/json" \
  --data "{\"email\":\"$alice_email\",\"password\":\"$old_password\"}" \
  "$api_url/auth/login")"
reused_reset_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Content-Type: application/json" \
  --data "{\"token\":\"$reset_token\",\"password\":\"$password\",\"passwordConfirm\":\"$password\"}" \
  "$api_url/auth/password/reset")"
[[ "$revoked_session_status" == 401 && "$old_password_status" == 401 && "$reused_reset_status" == 422 ]] || {
  echo "Password reset did not revoke old credentials and consume its token." >&2
  exit 1
}
unknown_forgot_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  --data "{\"email\":\"unknown-$suffix@example.test\"}" \
  "$api_url/auth/password/forgot")"
[[ "$(json_field message <<<"$forgot_response")" == "$(json_field message <<<"$unknown_forgot_response")" ]] || {
  echo "The forgot-password endpoint disclosed whether an email exists." >&2
  exit 1
}
alice_login="$(login "$alice_email")"
alice_token="$(json_field token <<<"$alice_login")"

sync_bootstrap="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"clientId":"integration-client"}' \
  "$api_url/sync/bootstrap")"
php -r '
  $response = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  $hasUser = false;
  foreach ($response["resources"] ?? [] as $resource) {
      if (($resource["resource"] ?? "") === "users" && ($resource["deleted"] ?? true) === false) {
          $hasUser = true;
      }
  }
  if (!is_int($response["watermark"] ?? null) || !$hasUser || ($response["protocolVersion"] ?? null) !== 2) {
      fwrite(STDERR, "The offline bootstrap response was invalid.\n");
      exit(1);
  }
' <<<"$sync_bootstrap"

sync_tag_id="sync-tag-$suffix"
sync_create_body="$(php -r '
  echo json_encode([
      "clientId" => "integration-client",
      "cursor" => 0,
      "operations" => [[
          "operationId" => "sync-create-tag",
          "resource" => "tags",
          "recordId" => $argv[1],
          "kind" => "create",
          "payload" => ["name" => "Offline tag"],
          "fieldClocks" => ["name" => "9999999999999-000001-integration-client"],
          "dependsOn" => [],
      ]],
  ], JSON_THROW_ON_ERROR);
' "$sync_tag_id")"
sync_create_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$sync_create_body" \
  "$api_url/sync/exchange")"
php -r '
  $response = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  $ack = $response["acknowledgements"][0] ?? [];
  if (($ack["status"] ?? null) !== "applied" || ($ack["resource"]["data"]["name"] ?? null) !== "Offline tag") {
      fwrite(STDERR, "The offline exchange did not apply an optimistic create.\n");
      exit(1);
  }
' <<<"$sync_create_response"
sync_create_receipt_watermark="$(php -r '
  $response = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo $response["receiptWatermark"] ?? "";
' <<<"$sync_create_response")"
[[ "$sync_create_receipt_watermark" =~ ^[1-9][0-9]*$ ]] || {
  echo "The offline exchange did not return a receipt watermark." >&2
  exit 1
}
sync_duplicate_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$sync_create_body" \
  "$api_url/sync/exchange")"
php -r '
  $response = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  if (
      ($response["acknowledgements"][0]["status"] ?? null) !== "duplicate"
      || ($response["acknowledgements"][0]["resource"]["data"]["name"] ?? null) !== "Offline tag"
  ) {
      fwrite(STDERR, "The offline exchange was not idempotent.\n");
      exit(1);
  }
' <<<"$sync_duplicate_response"
compact_receipt_state="$(sqlite3 "$test_db" "
  SELECT (json_type(response, '$.resource') IS NULL) || ':' || length(response)
  FROM sync_operation_receipts
  WHERE operation_id = 'sync-create-tag';
")"
[[ "$compact_receipt_state" =~ ^1:([0-9]{1,2}|1[0-9]{2})$ ]] || {
  echo "The stored operation receipt was not compact: $compact_receipt_state" >&2
  exit 1
}
sync_confirm_body="$(php -r '
  echo json_encode([
      "clientId" => "integration-client",
      "cursor" => 0,
      "confirmedReceiptSequence" => (int) $argv[1],
      "operations" => [],
  ], JSON_THROW_ON_ERROR);
' "$sync_create_receipt_watermark")"
curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$sync_confirm_body" \
  "$api_url/sync/exchange" >/dev/null
[[ "$(sqlite3 "$test_db" "SELECT COUNT(*) FROM sync_operation_receipts WHERE operation_id = 'sync-create-tag';")" == 0 ]] || {
  echo "The confirmed operation receipt was not removed." >&2
  exit 1
}
sync_delete_body="$(php -r '
  echo json_encode([
      "clientId" => "integration-client",
      "cursor" => 0,
      "operations" => [[
          "operationId" => "sync-delete-tag",
          "resource" => "tags",
          "recordId" => $argv[1],
          "kind" => "delete",
          "payload" => (object) [],
          "fieldClocks" => ["*" => "9999999999999-000002-integration-client"],
          "dependsOn" => [],
      ]],
  ], JSON_THROW_ON_ERROR);
' "$sync_tag_id")"
sync_delete_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$sync_delete_body" \
  "$api_url/sync/exchange")"
php -r '
  $response = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  $ack = $response["acknowledgements"][0] ?? [];
  if (($ack["status"] ?? null) !== "applied" || ($ack["resource"]["deleted"] ?? false) !== true) {
      fwrite(STDERR, "The offline exchange did not apply a delete.\n");
      exit(1);
  }
' <<<"$sync_delete_response"

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

interval_sound_settings_response="$(curl --silent --show-error --fail \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"intervalTypeSounds":{"train":"cine-hit","work":"cash","rest":"harp","prepare":"go","meditation":"gong","confirmation":"confirm","custom":"magic"}}' \
  "$api_url/auth/settings")"
php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  $sounds = $data["settings"]["intervalTypeSounds"] ?? null;
  if (($sounds["work"] ?? null) !== "cash"
      || ($sounds["rest"] ?? null) !== "harp"
      || ($sounds["meditation"] ?? null) !== "gong"
      || ($sounds["custom"] ?? null) !== "magic") {
      fwrite(STDERR, "Interval type sounds were not persisted.\n");
      exit(1);
  }
' <<<"$interval_sound_settings_response"
invalid_interval_sound_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"intervalTypeSounds":{"train":"cine-hit","work":"bell","rest":"harp","prepare":"go","meditation":"gong","confirmation":"confirm","custom":"go"}}' \
  "$api_url/auth/settings")"
[[ "$invalid_interval_sound_status" == 422 ]] || {
  echo "Invalid interval type sounds were not rejected." >&2
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
  --data '{"mainMenuOrder":["journal","tracking","flashcards","tasks","intervals"]}' \
  "$api_url/auth/settings")"
menu_order="$(php -r '$data=json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR); echo implode(",", $data["settings"]["mainMenuOrder"] ?? []);' <<<"$menu_order_response")"
[[ "$menu_order" == "journal,tracking,flashcards,tasks,intervals" ]] || {
  echo "The main menu order was not persisted." >&2
  exit 1
}
invalid_menu_order_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"mainMenuOrder":["tasks","tasks","flashcards","tracking","journal"]}' \
  "$api_url/auth/settings")"
[[ "$invalid_menu_order_status" == 422 ]] || {
  echo "An invalid main menu order was not rejected." >&2
  exit 1
}

menu_visibility_response="$(curl --silent --show-error --fail \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"mainMenuHidden":["flashcards","journal"]}' \
  "$api_url/auth/settings")"
hidden_menu_items="$(php -r '$data=json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR); echo implode(",", $data["settings"]["mainMenuHidden"] ?? []);' <<<"$menu_visibility_response")"
[[ "$hidden_menu_items" == "flashcards,journal" ]] || {
  echo "The hidden main menu items were not persisted." >&2
  exit 1
}
invalid_hidden_menu_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"mainMenuHidden":["tasks","intervals","flashcards","tracking","journal"]}' \
  "$api_url/auth/settings")"
[[ "$invalid_hidden_menu_status" == 422 ]] || {
  echo "The API allowed every main menu item to be hidden." >&2
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
  if (($request["rp"]["id"] ?? null) !== "backontrack.example.test"
      || ($request["authenticatorSelection"]["residentKey"] ?? null) !== "required"
      || ($request["authenticatorSelection"]["userVerification"] ?? null) !== "required") {
      fwrite(STDERR, "Passkey registration options are invalid.\n");
      exit(1);
  }
' "$passkey_request_json"

stored_challenge_count="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM backontrack_passkey_challenges WHERE id = '$passkey_ceremony' AND purpose = 'register';")"
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
    "androidPackageName" => "app.backontrack.android",
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
  "SELECT COUNT(*) FROM backontrack_passkey_challenges WHERE id = '$passkey_ceremony';")"
[[ "$consumed_challenge_count" == 0 ]] || {
  echo "A used passkey challenge was not consumed." >&2
  exit 1
}

sqlite3 "$test_db" "
  INSERT INTO backontrack_passkeys (
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
  "SELECT COUNT(*) FROM backontrack_passkeys WHERE user_id = '$alice_id';")"
remaining_registration_challenges="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM backontrack_passkey_challenges WHERE id = '$pending_passkey_ceremony';")"
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
task_schedule_mode="$(json_field schedule_mode <<<"$task_response")"
task_scheduled_time="$(json_field scheduled_time <<<"$task_response")"
[[ "$task_owner" == "$alice_id" ]] || {
  echo "The API accepted a forged owner." >&2
  exit 1
}
[[ -z "$task_notes_enabled" && -z "$task_note_suggestions_enabled" ]] || {
  echo "New tasks did not default to disabled entry note options." >&2
  exit 1
}
[[ "$task_schedule_mode" == "all_day" && -z "$task_scheduled_time" ]] || {
  echo "New tasks did not default to all-day scheduling." >&2
  exit 1
}

timed_task_response="$(curl --silent --show-error --fail \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"schedule_mode":"time_based","scheduled_time":"08:35"}' \
  "$api_url/collections/tasks/records/$task_id")"
timed_task_mode="$(json_field schedule_mode <<<"$timed_task_response")"
timed_task_time="$(json_field scheduled_time <<<"$timed_task_response")"
[[ "$timed_task_mode" == "time_based" && "$timed_task_time" == "08:35" ]] || {
  echo "A valid time-based task schedule was not persisted." >&2
  exit 1
}

invalid_schedule_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"schedule_mode":"time_based","scheduled_time":""}' \
  "$api_url/collections/tasks/records/$task_id")"
[[ "$invalid_schedule_status" == 422 ]] || {
  echo "A time-based task without a time was accepted." >&2
  exit 1
}

health_entry_id="health-entry-$suffix"
health_source_session="health-connect:2026-07-29"
health_create_body="$(php -r '
  $payload = [
      "task" => $argv[2], "occurrence" => "", "program_step" => "",
      "entry_date" => "2026-07-29", "value" => 1200, "kind" => "quantity",
      "unit" => "steps", "note" => "", "source_type" => "",
      "source_session" => $argv[3],
  ];
  echo json_encode([
      "clientId" => "integration-client", "cursor" => 0,
      "operations" => [[
          "operationId" => "health-create-" . $argv[1],
          "resource" => "entries", "recordId" => $argv[1], "kind" => "create",
          "payload" => $payload,
          "fieldClocks" => array_fill_keys(
              array_keys($payload),
              "9999999999999-000010-integration-client",
          ),
          "dependsOn" => [],
      ]],
  ], JSON_THROW_ON_ERROR);
' "$health_entry_id" "$task_id" "$health_source_session")"
curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$health_create_body" \
  "$api_url/sync/exchange" >/dev/null

health_patch_body() {
  local operation_id="$1"
  local value="$2"
  local clock="$3"
  php -r '
    $payload = [
        "occurrence" => "", "entry_date" => "2026-07-29", "value" => (int) $argv[3],
        "kind" => "quantity", "unit" => "steps", "note" => "", "source_type" => "",
        "source_session" => $argv[5],
    ];
    echo json_encode([
        "clientId" => "integration-client", "cursor" => 0,
        "operations" => [[
            "operationId" => $argv[1], "resource" => "entries",
            "recordId" => $argv[2], "kind" => "patch", "payload" => $payload,
            "fieldClocks" => array_fill_keys(array_keys($payload), $argv[4]),
            "dependsOn" => [],
        ]],
    ], JSON_THROW_ON_ERROR);
  ' "$operation_id" "$health_entry_id" "$value" "$clock" "$health_source_session"
}

health_first_patch="$(health_patch_body \
  "health-patch-first-$suffix" 4800 "9999999999999-000011-integration-client")"
health_latest_patch="$(health_patch_body \
  "health-patch-latest-$suffix" 8200 "9999999999999-000012-integration-client")"
for health_patch in "$health_first_patch" "$health_latest_patch" "$health_latest_patch"; do
  health_patch_response="$(curl --silent --show-error --fail \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $alice_token" \
    --data "$health_patch" \
    "$api_url/sync/exchange")"
done
health_patch_value="$(php -r '
  $response = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo $response["acknowledgements"][0]["resource"]["data"]["value"] ?? "";
' <<<"$health_patch_response")"
health_entry_state="$(sqlite3 "$test_db" "
  SELECT (SELECT COUNT(*) FROM entries WHERE id = '$health_entry_id') || ':'
      || (SELECT CAST(value AS INTEGER) FROM entries WHERE id = '$health_entry_id') || ':'
      || (SELECT revision FROM sync_record_versions
          WHERE account_id = '$alice_id' AND resource = 'entries' AND record_id = '$health_entry_id') || ':'
      || (SELECT COUNT(*) FROM sync_change_log
          WHERE account_id = '$alice_id' AND resource = 'entries' AND record_id = '$health_entry_id') || ':'
      || (SELECT COUNT(*) FROM sync_operation_receipts
          WHERE operation_id IN (
              'health-create-$health_entry_id',
              'health-patch-first-$suffix',
              'health-patch-latest-$suffix'
          ));
")"
[[ "$health_patch_value" == 8200 && "$health_entry_state" == "1:8200:3:1:0" ]] || {
  echo "Health Connect sync retained intermediate daily values or history: $health_entry_state" >&2
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

sync_task_order_body="$(php -r '
  echo json_encode([
      "clientId" => "integration-client",
      "cursor" => 0,
      "operations" => [[
          "operationId" => "sync-task-order-" . $argv[1],
          "resource" => "tasks",
          "recordId" => $argv[1],
          "kind" => "patch",
          "payload" => ["sort_order" => 2],
          "fieldClocks" => ["sort_order" => "9999999999999-000003-integration-client"],
          "dependsOn" => [],
      ]],
  ], JSON_THROW_ON_ERROR);
' "$task_id")"
sync_task_order_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$sync_task_order_body" \
  "$api_url/sync/exchange")"
php -r '
  $response = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  $ack = $response["acknowledgements"][0] ?? [];
  if (($ack["status"] ?? null) !== "applied" || ($ack["resource"]["data"]["sort_order"] ?? null) !== 2) {
      fwrite(STDERR, "Sync could not patch one task field when stored JSON fields were unchanged.\n");
      exit(1);
  }
' <<<"$sync_task_order_response"

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

zero_entry_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"task\":\"$task_id\",\"entry_date\":\"2026-08-02\",\"value\":0,\"kind\":\"quantity\",\"unit\":\"reps\",\"note\":\"\"}" \
  "$api_url/collections/entries/records")"
[[ "$zero_entry_status" == 422 ]] || {
  echo "The API accepted a task entry with a value of zero." >&2
  exit 1
}

entry_id="$(json_field id <<<"$entry_response")"
zero_entry_update_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --request PATCH \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"value":0}' \
  "$api_url/collections/entries/records/$entry_id")"
[[ "$zero_entry_update_status" == 422 ]] || {
  echo "The API allowed a task entry to be changed to a value of zero." >&2
  exit 1
}

session_entry_source="sync-session-$suffix"
session_entry_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"task\":\"$task_id\",\"occurrence\":\"\",\"program_step\":\"\",\"entry_date\":\"2026-08-02\",\"value\":1,\"kind\":\"duration\",\"unit\":\"seconds\",\"note\":\"\",\"source_type\":\"interval\",\"source_session\":\"$session_entry_source\"}" \
  "$api_url/collections/entries/records")"
session_entry_id="$(json_field id <<<"$session_entry_response")"
sync_duplicate_entry_body="$(php -r '
  echo json_encode([
      "clientId" => "integration-client",
      "cursor" => 0,
      "operations" => [[
          "operationId" => "sync-duplicate-session-entry",
          "resource" => "entries",
          "recordId" => "local-session-entry-" . $argv[1],
          "kind" => "create",
          "payload" => [
              "task" => $argv[2],
              "occurrence" => "",
              "program_step" => "",
              "entry_date" => "2026-08-02",
              "value" => 1,
              "kind" => "duration",
              "unit" => "seconds",
              "note" => "",
              "source_type" => "interval",
              "source_session" => $argv[3],
          ],
          "fieldClocks" => ["*" => "9999999999999-000003-integration-client"],
          "dependsOn" => [],
      ]],
  ], JSON_THROW_ON_ERROR);
' "$suffix" "$task_id" "$session_entry_source")"
sync_duplicate_entry_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$sync_duplicate_entry_body" \
  "$api_url/sync/exchange")"
php -r '
  $response = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  $ack = $response["acknowledgements"][0] ?? [];
  if (($ack["status"] ?? null) !== "merged"
      || ($ack["replacementId"] ?? null) !== $argv[1]
      || ($ack["resource"]["id"] ?? null) !== $argv[1]
      || ($ack["resource"]["data"]["source_session"] ?? null) !== $argv[2]) {
      fwrite(STDERR, "Offline sync did not reconcile a duplicate session-derived entry.\n");
      exit(1);
  }
' "$session_entry_id" "$session_entry_source" <<<"$sync_duplicate_entry_response"

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
    "started_at" => "2026-08-01T03:30:00Z", "task_date" => "2026-08-01", "planned_seconds" => 1,
    "elapsed_seconds" => 0, "runtime_state" => [
      "stepIndex" => 0, "remainingMs" => 1000,
      "stepStartedAt" => "2026-08-01T03:30:00Z", "accumulatedMs" => 0,
      "updatedAt" => "2026-08-01T03:30:00Z",
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
[[ "$attributed_session_date" == "2026-08-01" ]] || {
  echo "The attributed interval did not preserve its selected task date." >&2
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

interval_insight_response="$(curl --silent --show-error --fail \
  -G -H "Authorization: Bearer $alice_token" \
  --data-urlencode "filter=template = \"$interval_template_id\" && status = \"completed\" && task_date >= \"2026-07-26\" && task_date <= \"2026-08-01\"" \
  --data-urlencode 'sort=task_date' \
  "$api_url/collections/interval_sessions/records")"
interval_insight_count="$(json_field totalItems <<<"$interval_insight_response")"
[[ "$interval_insight_count" == 1 ]] || {
  echo "Interval sessions could not be loaded by task date for tracking insights." >&2
  exit 1
}

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
  "SELECT COUNT(*) FROM occurrences WHERE task = '$interval_task_one_id' AND scheduled_date = '2026-08-01' AND status = 'completed';")"
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

curl --silent --show-error --fail \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"session_count_mode":"linked","session_goal_type":"duration","session_target_seconds":1200}' \
  "$api_url/collections/tasks/records/$interval_task_two_id" >/dev/null
duration_session_payload="$(php -r '
  $payload = json_decode($argv[1], true, 512, JSON_THROW_ON_ERROR);
  $payload["task_date"] = "2026-08-02";
  $payload["started_at"] = $argv[2];
  $payload["runtime_state"]["stepStartedAt"] = $argv[2];
  $payload["runtime_state"]["updatedAt"] = $argv[2];
  echo json_encode($payload, JSON_THROW_ON_ERROR);
' "$standalone_session_payload" "2026-08-02T14:00:00Z")"
duration_session_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$duration_session_payload" \
  "$api_url/collections/interval_sessions/records")"
duration_session_id="$(json_field id <<<"$duration_session_response")"
curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"runtime_state":{"stepIndex":0,"remainingMs":300,"accumulatedMs":700000,"updatedAt":"2026-08-02T14:11:40Z"},"elapsed_seconds":700,"ended_at":"2026-08-02T14:11:40Z"}' \
  "$api_url/interval-sessions/$duration_session_id/end" >/dev/null

duration_session_payload="$(php -r '
  $payload = json_decode($argv[1], true, 512, JSON_THROW_ON_ERROR);
  $payload["started_at"] = $argv[2];
  $payload["runtime_state"]["stepStartedAt"] = $argv[2];
  $payload["runtime_state"]["updatedAt"] = $argv[2];
  echo json_encode($payload, JSON_THROW_ON_ERROR);
' "$duration_session_payload" "2026-08-02T15:00:00Z")"
duration_session_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$duration_session_payload" \
  "$api_url/collections/interval_sessions/records")"
duration_session_id="$(json_field id <<<"$duration_session_response")"
duration_completion_payload='{"runtime_state":{"stepIndex":1,"remainingMs":0,"accumulatedMs":600000,"updatedAt":"2026-08-02T15:10:00Z"},"elapsed_seconds":600,"ended_at":"2026-08-02T15:10:00Z"}'
curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$duration_completion_payload" \
  "$api_url/interval-sessions/$duration_session_id/complete" >/dev/null
curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$duration_completion_payload" \
  "$api_url/interval-sessions/$duration_session_id/complete" >/dev/null

duration_task_summary="$(sqlite3 "$test_db" \
  "SELECT (SELECT COALESCE(SUM(value), 0) FROM entries
             WHERE task = '$interval_task_two_id' AND entry_date = '2026-08-02') || ':' ||
          (SELECT COUNT(*) FROM entries
             WHERE task = '$interval_task_two_id' AND entry_date = '2026-08-02') || ':' ||
          (SELECT status FROM occurrences
             WHERE task = '$interval_task_two_id' AND scheduled_date = '2026-08-02');")"
[[ "$duration_task_summary" == "1300:2:completed" ]] || {
  echo "Standalone interval duration was not accumulated exactly once toward its linked task." >&2
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
  --data '{"name":"Mood","description":"Daily mood","role":"outcome","kind":"rating","category":"mood","unit":"/ 10","scale_min":1,"scale_max":10,"favorable_direction":"higher","daily_aggregation":"average","active":true,"sort_order":0,"color":"#D4A5FF","icon":"mdi-emoticon-outline"}' \
  "$api_url/collections/tracking_trackers/records")"
tracker_id="$(json_field id <<<"$tracker_response")"

second_tracker_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"name":"Energy","description":"Daily energy","role":"outcome","kind":"rating","category":"mood","unit":"/ 10","scale_min":1,"scale_max":10,"favorable_direction":"higher","daily_aggregation":"average","active":true,"sort_order":1,"color":"#C7F464","icon":"mdi-lightning-bolt-outline"}' \
  "$api_url/collections/tracking_trackers/records")"
second_tracker_id="$(json_field id <<<"$second_tracker_response")"

duration_tracker_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"name":"Focus time","description":"Time spent in focused work","role":"factor","kind":"duration","category":"activity","unit":"minutes","scale_min":0,"scale_max":0,"favorable_direction":"neutral","daily_aggregation":"sum","active":true,"sort_order":2,"color":"#66D9C8","icon":"mdi-timer-outline"}' \
  "$api_url/collections/tracking_trackers/records")"
duration_tracker_id="$(json_field id <<<"$duration_tracker_response")"

tracking_task_payload="$(php -r '
  echo json_encode([
    "name" => "Log wellbeing", "description" => "Complete the daily check-in",
    "type" => "tracking", "tags" => [], "mandatory" => true,
    "review_when_missed" => false, "active" => true,
    "start_date" => "2026-07-29", "end_date" => "",
    "recurrence_type" => "daily", "weekdays" => [], "interval_weeks" => 1,
    "target_value" => 1, "target_operator" => "gte", "unit" => "",
    "custom_unit" => "", "goal_period" => "occurrence", "quick_amounts" => [],
    "cycle_length" => 0, "program_repeat" => true, "program_strict" => false,
    "entry_notes_enabled" => false, "entry_note_suggestions_enabled" => false,
    "sort_order" => 9, "color" => "#FF9EAE", "interval_template" => "",
    "flashcard_review_set" => "", "tracking_trackers" => [$argv[1], $argv[2]],
    "reminder_enabled" => true, "reminder_times" => ["09:15", "20:30"],
  ], JSON_THROW_ON_ERROR);
' "$tracker_id" "$duration_tracker_id")"
tracking_task_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$tracking_task_payload" \
  "$api_url/collections/tasks/records")"
tracking_task_id="$(json_field id <<<"$tracking_task_response")"
php -r '
  $task = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  if (($task["type"] ?? "") !== "tracking"
      || ($task["tracking_trackers"] ?? []) !== [$argv[1], $argv[2]]
      || !($task["reminder_enabled"] ?? false)
      || ($task["reminder_times"] ?? []) !== ["09:15", "20:30"]) {
      fwrite(STDERR, "A tracking task did not retain its trackers and reminders.\n");
      exit(1);
  }
' "$tracker_id" "$duration_tracker_id" <<<"$tracking_task_response"

empty_tracking_task_payload="$(php -r '
  $task = json_decode($argv[1], true, 512, JSON_THROW_ON_ERROR);
  $task["name"] = "Invalid empty tracking task";
  $task["tracking_trackers"] = [];
  echo json_encode($task, JSON_THROW_ON_ERROR);
' "$tracking_task_payload")"
empty_tracking_task_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$empty_tracking_task_payload" \
  "$api_url/collections/tasks/records")"
[[ "$empty_tracking_task_status" == 422 ]] || {
  echo "The API accepted a tracking task without trackers." >&2
  exit 1
}

attached_tracker_delete_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X DELETE -H "Authorization: Bearer $alice_token" \
  "$api_url/collections/tracking_trackers/records/$tracker_id")"
[[ "$attached_tracker_delete_status" == 409 ]] || {
  echo "The API deleted a tracker that is still attached to a task." >&2
  exit 1
}

journal_payload="$(php -r '
  echo json_encode([
    "title" => "After training", "body" => "I felt calmer after the final round.\nKeep the slower pace.",
    "occurred_at" => "2026-08-02T16:00:00Z", "local_date" => "2026-08-02",
    "timezone_offset" => 240, "color" => "#D4A5FF",
    "task" => $argv[1], "tracker" => [$argv[2], $argv[3]],
  ], JSON_THROW_ON_ERROR);
' "$task_id" "$tracker_id" "$second_tracker_id")"
journal_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$journal_payload" \
  "$api_url/collections/journal_entries/records")"
journal_id="$(json_field id <<<"$journal_response")"
journal_task_snapshot="$(json_field task_snapshot <<<"$journal_response")"
journal_color="$(json_field color <<<"$journal_response")"
journal_created_at="$(json_field created_at <<<"$journal_response")"
php -r '
  $entry = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  if (
      ($entry["tracker"] ?? []) !== [$argv[1], $argv[2]]
      || ($entry["tracker_snapshot"][$argv[1]] ?? "") !== "Mood"
      || ($entry["tracker_snapshot"][$argv[2]] ?? "") !== "Energy"
  ) {
      fwrite(STDERR, "A journal entry did not retain all tracker context snapshots.\n");
      exit(1);
  }
' "$tracker_id" "$second_tracker_id" <<<"$journal_response"
[[ "$journal_task_snapshot" == "Secure task" && "$journal_color" == "#D4A5FF" && "$journal_created_at" =~ T ]] || {
  echo "A journal entry did not retain its task and tracker context snapshots." >&2
  exit 1
}

journal_image_base64="$(php -r '
  if (!function_exists("imagecreatetruecolor")) {
      fwrite(STDERR, "The GD extension is required for journal image integration tests.\n");
      exit(1);
  }
  $image = imagecreatetruecolor(512, 512);
  $color = imagecolorallocate($image, 80, 120, 200);
  imagefill($image, 0, 0, $color);
  ob_start();
  imagejpeg($image, null, 86);
  $bytes = ob_get_clean();
  imagedestroy($image);
  echo base64_encode($bytes);
')"
sync_journal_image_body="$(php -r '
  echo json_encode([
      "clientId" => "integration-client",
      "cursor" => 0,
      "operations" => [[
          "operationId" => "sync-journal-image",
          "resource" => "journal_entries",
          "recordId" => $argv[1],
          "kind" => "patch",
          "payload" => [
              "image_url" => "data:image/jpeg;base64," . $argv[2],
              "image_file" => "",
          ],
          "fieldClocks" => [
              "image_url" => "9999999999999-000003-integration-client",
              "image_file" => "9999999999999-000003-integration-client",
          ],
          "dependsOn" => [],
      ]],
  ], JSON_THROW_ON_ERROR);
' "$journal_id" "$journal_image_base64")"
sync_journal_image_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$sync_journal_image_body" \
  "$api_url/sync/exchange")"
journal_image_file="$(php -r '
  $response = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  $ack = $response["acknowledgements"][0] ?? [];
  if (!in_array(($ack["status"] ?? null), ["applied", "merged"], true)) {
      fwrite(STDERR, "Offline sync did not attach the reflection image.\n");
      exit(1);
  }
  echo $ack["resource"]["data"]["image_file"] ?? "";
' <<<"$sync_journal_image_response")"
[[ "$journal_image_file" =~ ^[a-f0-9]{48}\.jpg$ ]] || {
  echo "Offline sync did not store a reflection image file." >&2
  exit 1
}
curl --silent --show-error --fail \
  --output "$test_dir/journal-image.jpg" \
  "$api_url/journal-images/$journal_image_file"
php -r '
  $details = getimagesize($argv[1]);
  if (!$details || $details[0] !== 512 || $details[1] !== 512) {
      fwrite(STDERR, "The synced reflection image dimensions are invalid.\n");
      exit(1);
  }
' "$test_dir/journal-image.jpg"

journal_image_remove_response="$(curl --silent --show-error --fail \
  -X DELETE -H "Authorization: Bearer $alice_token" \
  "$api_url/journal-entries/$journal_id/image")"
[[ -z "$(json_field image_file <<<"$journal_image_remove_response")" ]] || {
  echo "Removing a reflection image did not clear the record." >&2
  exit 1
}
removed_journal_image_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  "$api_url/journal-images/$journal_image_file")"
[[ "$removed_journal_image_status" == 404 ]] || {
  echo "A removed reflection image file is still available." >&2
  exit 1
}
journal_image_response="$(curl --silent --show-error --fail \
  -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"image\":\"data:image/jpeg;base64,$journal_image_base64\"}" \
  "$api_url/journal-entries/$journal_id/image")"
journal_image_file="$(json_field image_file <<<"$journal_image_response")"
[[ "$journal_image_file" =~ ^[a-f0-9]{48}\.jpg$ ]] || {
  echo "The reflection image endpoint did not store its upload." >&2
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
    "timezone_offset" => 240, "task" => "", "tracker" => [],
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
  --data '{"reminder_enabled":true,"reminder_times":["25:00"]}' \
  "$api_url/collections/tasks/records/$tracking_task_id")"
[[ "$invalid_reminder_status" == 422 ]] || {
  echo "An invalid task reminder time was accepted." >&2
  exit 1
}

duplicate_reminder_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"reminder_enabled":true,"reminder_times":["20:30","20:30"]}' \
  "$api_url/collections/tasks/records/$tracking_task_id")"
[[ "$duplicate_reminder_status" == 422 ]] || {
  echo "Duplicate task reminder times were accepted." >&2
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
    "front" => "What is 2 + 2?", "back" => "4",
    "note" => "Basic addition", "image_url" => "https://images.example.test/math.jpg",
    "tags" => [$argv[1]],
  ], JSON_THROW_ON_ERROR);
' "$flashcard_tag_id")"
flashcard_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$flashcard_payload" \
  "$api_url/collections/flashcards/records")"
flashcard_id="$(json_field id <<<"$flashcard_response")"
flashcard_created_at="$(json_field created_at <<<"$flashcard_response")"
flashcard_image_url="$(json_field image_url <<<"$flashcard_response")"
[[ "$flashcard_created_at" =~ T && "$flashcard_image_url" == "https://images.example.test/math.jpg" ]] || {
  echo "A new flashcard did not receive server-owned timestamps." >&2
  exit 1
}

flashcard_audio_payload="$(php -r '
  $bytes = "\x1A\x45\xDF\xA3" . str_repeat("\0", 124);
  echo json_encode([
    "audio" => "data:audio/webm;base64," . base64_encode($bytes),
  ], JSON_THROW_ON_ERROR);
')"
flashcard_audio_response="$(curl --silent --show-error --fail \
  -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$flashcard_audio_payload" \
  "$api_url/flashcards/$flashcard_id/audio/front")"
flashcard_audio_file="$(json_field front_audio_file <<<"$flashcard_audio_response")"
flashcard_audio_url="$(json_field front_audio_url <<<"$flashcard_audio_response")"
[[ "$flashcard_audio_file" =~ ^[a-f0-9]{48}\.webm$ && -z "$flashcard_audio_url" ]] || {
  echo "Uploading front-face audio did not persist the recording." >&2
  exit 1
}
flashcard_audio_headers="$test_dir/flashcard-audio-headers.txt"
curl --silent --show-error --fail \
  --dump-header "$flashcard_audio_headers" \
  --output "$test_dir/flashcard-audio.webm" \
  "$api_url/flashcard-audio/$flashcard_audio_file"
grep -qi '^Content-Type: audio/webm' "$flashcard_audio_headers" || {
  echo "The uploaded flashcard recording was not served as WebM audio." >&2
  exit 1
}
[[ "$(wc -c < "$test_dir/flashcard-audio.webm")" == 128 ]] || {
  echo "The served flashcard recording did not match the uploaded audio." >&2
  exit 1
}

invalid_flashcard_image_url_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"image_url":"javascript:alert(1)"}' \
  "$api_url/collections/flashcards/records/$flashcard_id")"
[[ "$invalid_flashcard_image_url_status" == 422 ]] || {
  echo "The flashcard API accepted an unsafe image URL." >&2
  exit 1
}

flashcard_image_response="$(curl --silent --show-error --fail \
  -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"image\":\"data:image/jpeg;base64,$avatar_base64\"}" \
  "$api_url/flashcards/$flashcard_id/image")"
flashcard_image_file="$(json_field image_file <<<"$flashcard_image_response")"
flashcard_image_url="$(json_field image_url <<<"$flashcard_image_response")"
[[ "$flashcard_image_file" =~ ^[a-f0-9]{48}\.jpg$ && -z "$flashcard_image_url" ]] || {
  echo "Uploading a flashcard image did not replace its external URL." >&2
  exit 1
}

flashcard_image_headers="$test_dir/flashcard-image-headers.txt"
curl --silent --show-error --fail \
  --dump-header "$flashcard_image_headers" \
  --output "$test_dir/flashcard.jpg" \
  "$api_url/flashcard-images/$flashcard_image_file"
grep -qi '^Content-Type: image/jpeg' "$flashcard_image_headers" || {
  echo "The uploaded flashcard image was not served as a JPEG." >&2
  exit 1
}
php -r '
  $details = getimagesize($argv[1]);
  if (!$details || $details[0] > 256 || $details[1] !== $details[0]) {
      fwrite(STDERR, "The stored flashcard image dimensions are invalid.\n");
      exit(1);
  }
' "$test_dir/flashcard.jpg"


flashcard_import_payload='{"rows":[{"front":"Imported chisel","back":"formón","note":"Carving tool","tags":["algebra","Imported"]},{"front":"Imported plane","back":"cepillo","note":"","tags":[]}]}'
flashcard_import_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$flashcard_import_payload" \
  "$api_url/flashcards/import")"
flashcard_import_summary="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo count($data["cards"]) . ":" . count($data["tags"]) . ":"
    . $data["cards"][0]["tags"][0] . ":" . count($data["cards"][1]["tags"])
    . ":" . $data["cards"][0]["note"];
' <<<"$flashcard_import_response")"
[[ "$flashcard_import_summary" == "2:1:$flashcard_tag_id:0:Carving tool" ]] || {
  echo "Bulk flashcard import did not reuse tags or preserve optional tags." >&2
  exit 1
}
flashcard_import_invalid_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"rows":[{"front":"Should not persist","back":"valid","tags":[]},{"front":"Invalid","back":"","tags":[]}]}' \
  "$api_url/flashcards/import")"
flashcard_import_partial_count="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM flashcards WHERE owner = '$alice_id' AND front = 'Should not persist';")"
[[ "$flashcard_import_invalid_status" == 422 && "$flashcard_import_partial_count" == 0 ]] || {
  echo "An invalid bulk flashcard import persisted partial data." >&2
  exit 1
}
flashcard_import_first_id="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo $data["cards"][0]["id"];
' <<<"$flashcard_import_response")"
flashcard_import_second_id="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo $data["cards"][1]["id"];
' <<<"$flashcard_import_response")"
flashcard_import_tag_id="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo $data["tags"][0]["id"];
' <<<"$flashcard_import_response")"

flashcard_bulk_swap_front_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"action\":\"swap_front_back\",\"card_ids\":[\"$flashcard_import_first_id\"]}" \
  "$api_url/flashcards/bulk")"
flashcard_bulk_swap_front_summary="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo $data["cards"][0]["front"] . ":" . $data["cards"][0]["back"]
    . ":" . $data["cards"][0]["note"];
' <<<"$flashcard_bulk_swap_front_response")"
[[ "$flashcard_bulk_swap_front_summary" == "formón:Imported chisel:Carving tool" ]] || {
  echo "Bulk flashcard front and back swapping did not preserve the card fields." >&2
  exit 1
}

flashcard_bulk_swap_note_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"action\":\"swap_note_back\",\"card_ids\":[\"$flashcard_import_first_id\"]}" \
  "$api_url/flashcards/bulk")"
flashcard_bulk_swap_note_summary="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo $data["cards"][0]["front"] . ":" . $data["cards"][0]["back"]
    . ":" . $data["cards"][0]["note"];
' <<<"$flashcard_bulk_swap_note_response")"
[[ "$flashcard_bulk_swap_note_summary" == "formón:Carving tool:Imported chisel" ]] || {
  echo "Bulk flashcard note and back swapping did not preserve the card fields." >&2
  exit 1
}

flashcard_bulk_empty_note_swap_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"action\":\"swap_note_back\",\"card_ids\":[\"$flashcard_import_second_id\"]}" \
  "$api_url/flashcards/bulk")"
[[ "$flashcard_bulk_empty_note_swap_status" == 422 ]] || {
  echo "Bulk flashcard note and back swapping accepted an empty note as the required back." >&2
  exit 1
}

flashcard_bulk_add_payload="$(php -r '
  echo json_encode([
    "action" => "add_tags",
    "card_ids" => [$argv[1], $argv[2]],
    "tag_ids" => [$argv[3]],
  ], JSON_THROW_ON_ERROR);
' "$flashcard_import_first_id" "$flashcard_import_second_id" "$flashcard_tag_id")"
flashcard_bulk_add_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$flashcard_bulk_add_payload" \
  "$api_url/flashcards/bulk")"
flashcard_bulk_add_summary="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo count($data["cards"][0]["tags"]) . ":" . count($data["cards"][1]["tags"])
    . ":" . $data["cards"][1]["tags"][0];
' <<<"$flashcard_bulk_add_response")"
[[ "$flashcard_bulk_add_summary" == "2:1:$flashcard_tag_id" ]] || {
  echo "Bulk flashcard tag addition did not preserve and merge tags." >&2
  exit 1
}

flashcard_bulk_set_payload="$(php -r '
  echo json_encode([
    "action" => "set_tags",
    "card_ids" => [$argv[1], $argv[2]],
    "tag_ids" => [$argv[3]],
  ], JSON_THROW_ON_ERROR);
' "$flashcard_import_first_id" "$flashcard_import_second_id" "$flashcard_import_tag_id")"
flashcard_bulk_set_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$flashcard_bulk_set_payload" \
  "$api_url/flashcards/bulk")"
flashcard_bulk_set_summary="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo count($data["cards"][0]["tags"]) . ":" . $data["cards"][0]["tags"][0]
    . ":" . count($data["cards"][1]["tags"]) . ":" . $data["cards"][1]["tags"][0];
' <<<"$flashcard_bulk_set_response")"
[[ "$flashcard_bulk_set_summary" == "1:$flashcard_import_tag_id:1:$flashcard_import_tag_id" ]] || {
  echo "Bulk flashcard tag replacement did not apply the exact tag set." >&2
  exit 1
}

flashcard_bulk_remove_payload="$(php -r '
  echo json_encode([
    "action" => "remove_tags",
    "card_ids" => [$argv[1]],
    "tag_ids" => [$argv[2]],
  ], JSON_THROW_ON_ERROR);
' "$flashcard_import_first_id" "$flashcard_import_tag_id")"
flashcard_bulk_remove_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$flashcard_bulk_remove_payload" \
  "$api_url/flashcards/bulk")"
[[ "$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo count($data["cards"][0]["tags"]);
' <<<"$flashcard_bulk_remove_response")" == 0 ]] || {
  echo "Bulk flashcard tag removal did not remove the selected tag." >&2
  exit 1
}

flashcard_bulk_clear_payload="$(php -r '
  echo json_encode([
    "action" => "clear_tags", "card_ids" => [$argv[1]], "tag_ids" => [],
  ], JSON_THROW_ON_ERROR);
' "$flashcard_import_second_id")"
flashcard_bulk_clear_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$flashcard_bulk_clear_payload" \
  "$api_url/flashcards/bulk")"
[[ "$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo count($data["cards"][0]["tags"]);
' <<<"$flashcard_bulk_clear_response")" == 0 ]] || {
  echo "Bulk flashcard tag clearing did not remove every tag." >&2
  exit 1
}

flashcard_bulk_delete_payload="$(php -r '
  echo json_encode([
    "action" => "delete", "card_ids" => [$argv[1], $argv[2]], "tag_ids" => [],
  ], JSON_THROW_ON_ERROR);
' "$flashcard_import_first_id" "$flashcard_import_second_id")"
flashcard_bulk_delete_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$flashcard_bulk_delete_payload" \
  "$api_url/flashcards/bulk")"
flashcard_bulk_delete_count="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo count($data["deleted_ids"]);
' <<<"$flashcard_bulk_delete_response")"
flashcard_bulk_remaining_count="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM flashcards WHERE id IN ('$flashcard_import_first_id', '$flashcard_import_second_id');")"
[[ "$flashcard_bulk_delete_count" == 2 && "$flashcard_bulk_remaining_count" == 0 ]] || {
  echo "Bulk flashcard deletion did not remove every selected card." >&2
  exit 1
}

curl --silent --show-error --fail \
  -X DELETE -H "Authorization: Bearer $alice_token" \
  "$api_url/collections/flashcard_tags/records/$flashcard_import_tag_id" >/dev/null

navigation_tag_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"name":"Navigation"}' \
  "$api_url/collections/flashcard_tags/records")"
navigation_tag_id="$(json_field id <<<"$navigation_tag_response")"
navigation_card_one_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"front\":\"Navigation one\",\"back\":\"First back\",\"tags\":[\"$navigation_tag_id\"]}" \
  "$api_url/collections/flashcards/records")"
navigation_card_one_id="$(json_field id <<<"$navigation_card_one_response")"
navigation_card_two_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"front\":\"Navigation two\",\"back\":\"Second back\",\"tags\":[\"$navigation_tag_id\"]}" \
  "$api_url/collections/flashcards/records")"
navigation_card_two_id="$(json_field id <<<"$navigation_card_two_response")"
navigation_card_three_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"front\":\"Navigation three\",\"back\":\"Third back\",\"tags\":[\"$navigation_tag_id\"]}" \
  "$api_url/collections/flashcards/records")"
navigation_card_three_id="$(json_field id <<<"$navigation_card_three_response")"
navigation_review_set_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"name\":\"Navigation test\",\"tags\":[\"$navigation_tag_id\"],\"mode\":\"manual\",\"max_cards\":2,\"front_seconds\":5,\"back_seconds\":5,\"sort_mode\":\"recently_added\",\"sort_order\":99}" \
  "$api_url/collections/flashcard_review_sets/records")"
navigation_review_set_id="$(json_field id <<<"$navigation_review_set_response")"
navigation_session_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"task":"","program_step":"","task_date":""}' \
  "$api_url/flashcard-review-sets/$navigation_review_set_id/sessions")"
navigation_session_id="$(json_field id <<<"$navigation_session_response")"
navigation_session_total="$(json_field total_cards <<<"$navigation_session_response")"
[[ "$navigation_session_total" == 2 ]] || {
  echo "A Review set session did not enforce its maximum card count." >&2
  exit 1
}
navigation_initial_front="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo $data["queue_state"][0]["id"];
' <<<"$navigation_session_response")"
navigation_next_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"action":"next","elapsed_seconds":0}' \
  "$api_url/flashcard-review-sessions/$navigation_session_id/actions")"
navigation_next_front="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo $data["session"]["queue_state"][0]["id"];
' <<<"$navigation_next_response")"
navigation_previous_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"action":"previous","elapsed_seconds":0}' \
  "$api_url/flashcard-review-sessions/$navigation_session_id/actions")"
navigation_restored_front="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo $data["session"]["queue_state"][0]["id"] . ":"
    . $data["session"]["viewed_count"] . ":"
    . $data["session"]["success_count"] . ":"
    . $data["session"]["error_count"];
' <<<"$navigation_previous_response")"
[[ "$navigation_next_front" != "$navigation_initial_front" \
  && "$navigation_restored_front" == "$navigation_initial_front:0:0:0" ]] || {
  echo "Whole-card Review set navigation did not rotate the queue without grading it." >&2
  exit 1
}
navigation_eject_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"action":"eject","elapsed_seconds":0}' \
  "$api_url/flashcard-review-sessions/$navigation_session_id/actions")"
navigation_eject_summary="$(php -r '
  $session = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR)["session"];
  echo count($session["queue_state"]) . ":" . $session["ejected_count"];
' <<<"$navigation_eject_response")"
navigation_eject_event_count="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM flashcard_review_events WHERE session = '$navigation_session_id' AND outcome = 'ejected';")"
[[ "$navigation_eject_summary" == "1:1" && "$navigation_eject_event_count" == "1" ]] || {
  echo "Ejecting a Review set card did not update its queue, counter, and review event." >&2
  exit 1
}
navigation_undo_eject_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"action":"undo_eject","elapsed_seconds":0}' \
  "$api_url/flashcard-review-sessions/$navigation_session_id/actions")"
navigation_undo_eject_summary="$(php -r '
  $session = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR)["session"];
  echo $session["queue_state"][0]["id"] . ":"
    . count($session["queue_state"]) . ":" . $session["ejected_count"];
' <<<"$navigation_undo_eject_response")"
navigation_eject_event_count="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM flashcard_review_events WHERE session = '$navigation_session_id' AND outcome = 'ejected';")"
[[ "$navigation_undo_eject_summary" == "$navigation_initial_front:2:0" \
  && "$navigation_eject_event_count" == "0" ]] || {
  echo "Undoing the last Review set eject did not restore the card and remove its event." >&2
  exit 1
}
curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"action":"success","elapsed_seconds":3}' \
  "$api_url/flashcard-review-sessions/$navigation_session_id/actions" >/dev/null
navigation_restart_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"action":"restart","elapsed_seconds":3}' \
  "$api_url/flashcard-review-sessions/$navigation_session_id/actions")"
navigation_restart_summary="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  $session = $data["session"];
  echo $session["status"] . ":"
    . count($session["queue_state"]) . ":"
    . $session["elapsed_seconds"] . ":"
    . $session["viewed_count"] . ":"
    . $session["success_count"] . ":"
    . $session["error_count"] . ":"
    . $session["ejected_count"];
' <<<"$navigation_restart_response")"
[[ "$navigation_restart_summary" == "running:2:0:0:0:0:0" ]] || {
  echo "Restarting a Review set session did not reset its queue, timer, and counters." >&2
  exit 1
}
curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"action":"end","elapsed_seconds":0}' \
  "$api_url/flashcard-review-sessions/$navigation_session_id/actions" >/dev/null
curl --silent --show-error --fail \
  -X DELETE -H "Authorization: Bearer $alice_token" \
  "$api_url/collections/flashcard_review_sets/records/$navigation_review_set_id" >/dev/null
for navigation_card_id in "$navigation_card_one_id" "$navigation_card_two_id" "$navigation_card_three_id"; do
  curl --silent --show-error --fail \
    -X DELETE -H "Authorization: Bearer $alice_token" \
    "$api_url/collections/flashcards/records/$navigation_card_id" >/dev/null
done
curl --silent --show-error --fail \
  -X DELETE -H "Authorization: Bearer $alice_token" \
  "$api_url/collections/flashcard_tags/records/$navigation_tag_id" >/dev/null

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
manual_session_summary="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo $data["total_cards"] . ":" . $data["queue_state"][0]["note"] . ":"
    . $data["queue_state"][0]["image"] . ":"
    . $data["queue_state"][0]["frontAudio"];
' <<<"$manual_session_response")"
[[ "$manual_session_summary" == "1:Basic addition:/flashcard-images/$flashcard_image_file:/flashcard-audio/$flashcard_audio_file" ]] || {
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
    "card_sides" => "back",
    "indefinite" => true,
    "front_seconds" => 3, "back_seconds" => 4,
    "back_speech_repeat_count" => 3,
    "note_before_back" => true,
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
passive_review_set_response="$(curl --silent --show-error --fail \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"sort_direction":"desc"}' \
  "$api_url/collections/flashcard_review_sets/records/$passive_review_set_id")"
[[ "$(json_field sort_direction <<<"$passive_review_set_response")" == "desc" ]] || {
  echo "A Review set did not persist its sort direction." >&2
  exit 1
}
passive_session_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"task":"","program_step":"","task_date":""}' \
  "$api_url/flashcard-review-sets/$passive_review_set_id/sessions")"
passive_session_id="$(json_field id <<<"$passive_session_response")"
passive_session_speech="$(php -r '
  $data=json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo ((int) $data["speech_enabled_snapshot"]) . ":" . $data["front_language_snapshot"] . ":" . $data["back_language_snapshot"] . ":" . ((int) $data["indefinite_snapshot"]) . ":" . $data["back_speech_repeat_count_snapshot"] . ":" . ((int) $data["note_before_back_snapshot"]) . ":" . $data["card_sides_snapshot"] . ":" . $data["max_cards_snapshot"] . ":" . $data["sort_direction_snapshot"];
' <<<"$passive_session_response")"
[[ "$passive_session_speech" == "1:en-US:fr-CA:1:3:1:back:20:desc" ]] || {
  echo "A Review set did not snapshot its speech synthesis and looping settings." >&2
  exit 1
}
passive_session_settings_response="$(curl --silent --show-error --fail \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"mode":"passive","card_sides":"front","indefinite":true,"max_cards":1,"front_seconds":4,"back_seconds":6,"back_speech_repeat_count":2,"note_before_back":false,"speech_enabled":true,"front_language":"en-US","back_language":"fr-CA","sort_mode":"difficult","sort_direction":"desc"}' \
  "$api_url/flashcard-review-sessions/$passive_session_id/settings")"
passive_session_settings_summary="$(php -r '
  $data=json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo $data["mode_snapshot"] . ":" . $data["card_sides_snapshot"] . ":"
    . ((int) $data["indefinite_snapshot"]) . ":" . $data["max_cards_snapshot"] . ":"
    . $data["front_seconds_snapshot"] . ":" . $data["back_seconds_snapshot"] . ":"
    . $data["back_speech_repeat_count_snapshot"] . ":"
    . ((int) $data["note_before_back_snapshot"]) . ":" . $data["sort_snapshot"] . ":"
    . $data["sort_direction_snapshot"];
' <<<"$passive_session_settings_response")"
[[ "$passive_session_settings_summary" == "passive:front:1:1:4:6:2:0:difficult:desc" ]] || {
  echo "An active Review set session did not apply its adjusted settings." >&2
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
passive_view_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"action":"view","elapsed_seconds":8,"view_count":7}' \
  "$api_url/flashcard-review-sessions/$passive_session_id/actions")"
passive_loop_summary="$(php -r '
  $data=json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR)["session"];
  echo $data["status"] . ":" . count($data["queue_state"]) . ":" . $data["viewed_count"];
' <<<"$passive_view_response")"
[[ "$passive_loop_summary" == "running:1:7" ]] || {
  echo "An indefinite Passive review did not reconcile multiple views atomically." >&2
  exit 1
}
curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"action":"end","elapsed_seconds":8}' \
  "$api_url/flashcard-review-sessions/$passive_session_id/actions" >/dev/null

curl --silent --show-error --fail \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"flashcard_review_set\":\"$passive_review_set_id\"}" \
  "$api_url/collections/interval_templates/records/$interval_template_id" >/dev/null
interval_flashcard_session_payload="$(php -r '
  $payload = json_decode($argv[1], true, 512, JSON_THROW_ON_ERROR);
  $payload["task"] = "";
  $payload["started_at"] = "2026-08-04T14:00:00Z";
  $payload["runtime_state"]["stepStartedAt"] = "2026-08-04T14:00:00Z";
  $payload["runtime_state"]["updatedAt"] = "2026-08-04T14:00:00Z";
  echo json_encode($payload, JSON_THROW_ON_ERROR);
' "$session_payload")"
interval_flashcard_session_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$interval_flashcard_session_payload" \
  "$api_url/collections/interval_sessions/records")"
interval_flashcard_session_id="$(json_field id <<<"$interval_flashcard_session_response")"
interval_flashcard_snapshot="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  $snapshot = $data["flashcard_snapshot"];
  echo $snapshot["reviewSet"] . ":" . $snapshot["frontSeconds"] . ":"
    . $snapshot["backSeconds"] . ":" . ((int) $snapshot["speechEnabled"])
    . ":" . $snapshot["backSpeechRepeatCount"] . ":" . $snapshot["cardSides"]
    . ":" . ((int) $snapshot["noteBeforeBack"])
    . ":" . count($snapshot["cards"]) . ":" . $snapshot["cards"][0]["image"]
    . ":" . $snapshot["cards"][0]["frontAudio"];
' <<<"$interval_flashcard_session_response")"
[[ "$interval_flashcard_snapshot" == "$passive_review_set_id:3:4:1:3:back:1:1:/flashcard-images/$flashcard_image_file:/flashcard-audio/$flashcard_audio_file" ]] || {
  echo "An interval did not snapshot its attached Passive Review set." >&2
  exit 1
}
interval_flashcard_snapshot_update_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"flashcard_snapshot":{}}' \
  "$api_url/collections/interval_sessions/records/$interval_flashcard_session_id")"
[[ "$interval_flashcard_snapshot_update_status" == 422 ]] || {
  echo "An interval session accepted a client-authored Review set snapshot." >&2
  exit 1
}
interval_flashcard_context_payload="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  $data["flashcard_snapshot"]["frontSeconds"] = 7;
  echo json_encode(["flashcard_snapshot" => $data["flashcard_snapshot"]], JSON_THROW_ON_ERROR);
' <<<"$interval_flashcard_session_response")"
interval_flashcard_context_response="$(curl --silent --show-error --fail \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$interval_flashcard_context_payload" \
  "$api_url/interval-sessions/$interval_flashcard_session_id/flashcards")"
[[ "$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo $data["flashcard_snapshot"]["frontSeconds"];
' <<<"$interval_flashcard_context_response")" == 7 ]] || {
  echo "An active interval did not persist its managed flashcard context." >&2
  exit 1
}
curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"runtime_state":{"stepIndex":1,"remainingMs":0,"accumulatedMs":1000,"updatedAt":"2026-08-04T14:00:01Z"},"elapsed_seconds":1,"ended_at":"2026-08-04T14:00:01Z"}' \
  "$api_url/interval-sessions/$interval_flashcard_session_id/complete" >/dev/null

attached_interval_review_set_delete_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X DELETE -H "Authorization: Bearer $alice_token" \
  "$api_url/collections/flashcard_review_sets/records/$passive_review_set_id")"
[[ "$attached_interval_review_set_delete_status" == 409 ]] || {
  echo "The API deleted a Review set that is still attached to an interval." >&2
  exit 1
}

curl --silent --show-error --fail \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"flashcard_review_set\":\"$manual_review_set_id\"}" \
  "$api_url/collections/interval_templates/records/$interval_template_id" >/dev/null
manual_interval_payload="$(php -r '
  $payload = json_decode($argv[1], true, 512, JSON_THROW_ON_ERROR);
  $payload["started_at"] = "2026-08-04T15:00:00Z";
  $payload["runtime_state"]["stepStartedAt"] = "2026-08-04T15:00:00Z";
  $payload["runtime_state"]["updatedAt"] = "2026-08-04T15:00:00Z";
  echo json_encode($payload, JSON_THROW_ON_ERROR);
' "$interval_flashcard_session_payload")"
manual_interval_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$manual_interval_payload" \
  "$api_url/collections/interval_sessions/records")"
manual_interval_session_id="$(json_field id <<<"$manual_interval_response")"
manual_interval_timing="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo $data["flashcard_snapshot"]["frontSeconds"] . ":"
    . $data["flashcard_snapshot"]["backSeconds"] . ":"
    . $data["flashcard_snapshot"]["backSpeechRepeatCount"] . ":"
    . $data["flashcard_snapshot"]["cardSides"];
' <<<"$manual_interval_response")"
[[ "$manual_interval_timing" == "5:5:1:both" ]] || {
  echo "An interval did not apply the five-second fallback to a Manual Review set." >&2
  exit 1
}
curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"runtime_state":{"stepIndex":1,"remainingMs":0,"accumulatedMs":1000,"updatedAt":"2026-08-04T15:00:01Z"},"elapsed_seconds":1,"ended_at":"2026-08-04T15:00:01Z"}' \
  "$api_url/interval-sessions/$manual_interval_session_id/complete" >/dev/null

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

hybrid_duration_task_payload="$(php -r '
  $payload = json_decode($argv[1], true, 512, JSON_THROW_ON_ERROR);
  $payload["name"] = "Review time across runners";
  $payload["sort_order"] = 12;
  $payload["session_count_mode"] = "linked";
  $payload["session_goal_type"] = "duration";
  $payload["session_target_seconds"] = 2;
  echo json_encode($payload, JSON_THROW_ON_ERROR);
' "$flashcard_task_payload")"
hybrid_duration_task_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$hybrid_duration_task_payload" \
  "$api_url/collections/tasks/records")"
hybrid_duration_task_id="$(json_field id <<<"$hybrid_duration_task_response")"
hybrid_interval_payload="$(php -r '
  $payload = json_decode($argv[1], true, 512, JSON_THROW_ON_ERROR);
  $payload["task"] = "";
  $payload["program_step"] = "";
  $payload["task_date"] = $argv[2];
  $payload["started_at"] = $argv[2] . "T14:00:00Z";
  $payload["definition_snapshot"]["children"][0]["durationSeconds"] = 7;
  $payload["planned_seconds"] = 7;
  $payload["runtime_state"]["remainingMs"] = 7000;
  $payload["runtime_state"]["accumulatedMs"] = 0;
  $payload["runtime_state"]["stepStartedAt"] = $payload["started_at"];
  $payload["runtime_state"]["updatedAt"] = $payload["started_at"];
  echo json_encode($payload, JSON_THROW_ON_ERROR);
' "$manual_interval_payload" "$flashcard_today")"
hybrid_interval_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$hybrid_interval_payload" \
  "$api_url/collections/interval_sessions/records")"
hybrid_interval_session_id="$(json_field id <<<"$hybrid_interval_response")"
hybrid_interval_completion="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"runtime_state\":{\"stepIndex\":1,\"remainingMs\":0,\"accumulatedMs\":7000,\"flashcardReviewAccumulatedMs\":1000,\"updatedAt\":\"${flashcard_today}T14:00:07Z\"},\"elapsed_seconds\":7,\"ended_at\":\"${flashcard_today}T14:00:07Z\"}" \
  "$api_url/interval-sessions/$hybrid_interval_session_id/complete")"
hybrid_interval_entry="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  foreach ($data["entries"] ?? [] as $entry) {
      if (($entry["task"] ?? "") === $argv[1]) {
          echo $entry["value"] . ":" . $entry["source_type"] . ":" . $entry["source_session"];
      }
  }
' "$hybrid_duration_task_id" <<<"$hybrid_interval_completion")"
[[ "$hybrid_interval_entry" == "1:flashcards:$hybrid_interval_session_id" ]] || {
  echo "An interval with an attached Review set did not credit its Review-enabled time." >&2
  exit 1
}
curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"runtime_state\":{\"stepIndex\":1,\"remainingMs\":0,\"accumulatedMs\":7000,\"flashcardReviewAccumulatedMs\":1000,\"updatedAt\":\"${flashcard_today}T14:00:07Z\"},\"elapsed_seconds\":7,\"ended_at\":\"${flashcard_today}T14:00:07Z\"}" \
  "$api_url/interval-sessions/$hybrid_interval_session_id/complete" >/dev/null

linked_review_session_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"task":"","program_step":"","task_date":""}' \
  "$api_url/flashcard-review-sets/$manual_review_set_id/sessions")"
linked_review_session_id="$(json_field id <<<"$linked_review_session_response")"
curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"action":"end","elapsed_seconds":1}' \
  "$api_url/flashcard-review-sessions/$linked_review_session_id/actions" >/dev/null
sqlite3 "$test_db" \
  "DELETE FROM entries WHERE task = '$hybrid_duration_task_id' AND source_session = '$hybrid_interval_session_id';"
hybrid_reconciliation_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"since\":\"$flashcard_today\"}" \
  "$api_url/task-session-progress/reconcile")"
hybrid_reconciled_entry="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  foreach ($data["entries"] ?? [] as $entry) {
      if (($entry["task"] ?? "") === $argv[1]
          && ($entry["source_session"] ?? "") === $argv[2]) {
          echo $entry["value"];
      }
  }
' "$hybrid_duration_task_id" "$hybrid_interval_session_id" <<<"$hybrid_reconciliation_response")"
[[ "$hybrid_reconciled_entry" == 1 ]] || {
  echo "Recent hybrid Review-set progress was not repaired during reconciliation." >&2
  exit 1
}
hybrid_duration_summary="$(sqlite3 "$test_db" \
  "SELECT (SELECT COALESCE(SUM(value), 0) FROM entries
             WHERE task = '$hybrid_duration_task_id' AND entry_date = '$flashcard_today') || ':' ||
          (SELECT COUNT(*) FROM entries
             WHERE task = '$hybrid_duration_task_id' AND entry_date = '$flashcard_today') || ':' ||
          (SELECT status FROM occurrences
             WHERE task = '$hybrid_duration_task_id' AND scheduled_date = '$flashcard_today');")"
[[ "$hybrid_duration_summary" == "2:2:completed" ]] || {
  echo "Interval and standalone Review-set time did not accumulate exactly once toward one duration objective." >&2
  exit 1
}

looping_flashcard_task_payload="$(php -r '
  $payload = json_decode($argv[1], true, 512, JSON_THROW_ON_ERROR);
  $payload["name"] = "Looping review task";
  $payload["flashcard_review_set"] = $argv[2];
  $payload["sort_order"] = 11;
  echo json_encode($payload, JSON_THROW_ON_ERROR);
' "$flashcard_task_payload" "$passive_review_set_id")"
looping_flashcard_task_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$looping_flashcard_task_payload" \
  "$api_url/collections/tasks/records")"
looping_flashcard_task_id="$(json_field id <<<"$looping_flashcard_task_response")"
looping_flashcard_session_payload="$(php -r '
  echo json_encode(["task" => $argv[1], "program_step" => "", "task_date" => $argv[2]], JSON_THROW_ON_ERROR);
' "$looping_flashcard_task_id" "$flashcard_today")"
looping_flashcard_session_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$looping_flashcard_session_payload" \
  "$api_url/flashcard-review-sets/$passive_review_set_id/sessions")"
looping_flashcard_session_id="$(json_field id <<<"$looping_flashcard_session_response")"
looping_flashcard_view_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"action":"view","elapsed_seconds":8}' \
  "$api_url/flashcard-review-sessions/$looping_flashcard_session_id/actions")"
looping_flashcard_view_summary="$(php -r '
  $session = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR)["session"];
  echo $session["status"] . ":" . $session["viewed_count"] . ":"
    . count($session["queue_state"]) . ":" . $session["total_cards"];
' <<<"$looping_flashcard_view_response")"
[[ "$looping_flashcard_view_summary" == "running:1:1:1" ]] || {
  echo "An attached looping review corrupted its queue or cycle progress." >&2
  exit 1
}
looping_flashcard_end_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"action":"end","elapsed_seconds":8}' \
  "$api_url/flashcard-review-sessions/$looping_flashcard_session_id/actions")"
looping_flashcard_end_status="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo $data["session"]["status"] . ":" . ($data["occurrence"]["status"] ?? "");
' <<<"$looping_flashcard_end_response")"
[[ "$looping_flashcard_end_status" == "completed:completed" ]] || {
  echo "Stopping a reviewed indefinite session did not complete its attached task." >&2
  exit 1
}

flashcard_counts="$(sqlite3 "$test_db" \
  "SELECT success_count || ':' || error_count || ':' || passive_views FROM flashcards WHERE id = '$flashcard_id';")"
flashcard_event_count="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM flashcard_review_events WHERE card = '$flashcard_id';")"
flashcard_ejected_event_count="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM flashcard_review_events WHERE card = '$flashcard_id' AND outcome = 'ejected';")"
[[ "$flashcard_counts" == "1:0:8" && "$flashcard_event_count" == 10 && "$flashcard_ejected_event_count" == 1 ]] || {
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

curl --silent --show-error --fail \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"flashcard_review_set":""}' \
  "$api_url/collections/interval_templates/records/$interval_template_id" >/dev/null

register "Bob API" "$bob_email" >/dev/null
confirm_latest_email
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

future_email="future-$suffix@example.test"
pending_share_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"email\":\"$future_email\",\"role\":\"readonly\"}" \
  "$api_url/flashcard-review-sets/$manual_review_set_id/shares")"
pending_share_id="$(json_field id <<<"$pending_share_response")"
pending_share_shape="$(php -r '
  $share = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  $keys = array_keys($share);
  sort($keys);
  echo implode(",", $keys) . ":" . ($share["email"] ?? "") . ":" . ($share["role"] ?? "");
' <<<"$pending_share_response")"
expected_share_keys="created_at,email,id,review_set,role,updated_at"
[[ "$pending_share_shape" == "$expected_share_keys:$future_email:readonly" ]] || {
  echo "A pending Review set invitation exposed account-registration information." >&2
  exit 1
}

pending_share_list_response="$(curl --silent --show-error --fail \
  -H "Authorization: Bearer $alice_token" \
  "$api_url/flashcard-review-sets/$manual_review_set_id/shares")"
pending_share_list_shape="$(php -r '
  $shares = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  foreach ($shares as $share) {
      if (($share["email"] ?? "") !== $argv[1]) continue;
      $keys = array_keys($share);
      sort($keys);
      echo implode(",", $keys);
  }
' "$future_email" <<<"$pending_share_list_response")"
[[ "$pending_share_list_shape" == "$expected_share_keys" ]] || {
  echo "The owner share list exposed whether a pending email is registered." >&2
  exit 1
}

register "Future API" "$future_email" >/dev/null
confirm_latest_email
future_login="$(login "$future_email")"
future_token="$(json_field token <<<"$future_login")"
future_id="$(php -r '$data=json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR); echo $data["record"]["id"];' <<<"$future_login")"
future_review_sets_response="$(curl --silent --show-error --fail \
  -H "Authorization: Bearer $future_token" \
  "$api_url/flashcard-review-sets")"
future_access_role="$(php -r '
  $sets = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  foreach ($sets as $set) {
      if (($set["id"] ?? "") === $argv[1]) echo $set["access_role"] ?? "";
  }
' "$manual_review_set_id" <<<"$future_review_sets_response")"
claimed_pending_share="$(sqlite3 "$test_db" \
  "SELECT (SELECT COUNT(*) FROM flashcard_review_set_shares
             WHERE id = '$pending_share_id' AND recipient = '$future_id') || ':' ||
          (SELECT COUNT(*) FROM flashcard_review_set_preferences
             WHERE review_set = '$manual_review_set_id' AND account = '$future_id');")"
[[ "$future_access_role" == readonly && "$claimed_pending_share" == "1:1" ]] || {
  echo "A pending Review set invitation was not claimed after registration." >&2
  exit 1
}

pending_share_delete_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X DELETE -H "Authorization: Bearer $alice_token" \
  "$api_url/flashcard-review-set-shares/$pending_share_id")"
future_revoked_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Authorization: Bearer $future_token" \
  "$api_url/flashcard-review-sets/$manual_review_set_id/cards")"
[[ "$pending_share_delete_status" == 204 && "$future_revoked_status" == 404 ]] || {
  echo "A claimed pending invitation could not be revoked normally." >&2
  exit 1
}

bob_pre_share_bootstrap="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $bob_token" \
  --data '{"clientId":"bob-shared-set-client"}' \
  "$api_url/sync/bootstrap")"
bob_pre_share_cursor="$(json_field watermark <<<"$bob_pre_share_bootstrap")"

share_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "{\"email\":\"$bob_email\",\"role\":\"readonly\"}" \
  "$api_url/flashcard-review-sets/$manual_review_set_id/shares")"
share_id="$(json_field id <<<"$share_response")"
share_summary="$(php -r '
  $share = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo $share["role"] . ":" . $share["email"];
' <<<"$share_response")"
registered_share_keys="$(php -r '
  $share = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  $keys = array_keys($share);
  sort($keys);
  echo implode(",", $keys);
' <<<"$share_response")"
[[ "$share_summary" == "readonly:$bob_email" && "$registered_share_keys" == "$expected_share_keys" ]] || {
  echo "Registered and pending Review set invitations did not return the same private shape." >&2
  exit 1
}

bob_share_sync_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $bob_token" \
  --data "{\"clientId\":\"bob-shared-set-client\",\"cursor\":$bob_pre_share_cursor,\"operations\":[]}" \
  "$api_url/sync/exchange")"
php -r '
  $response = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  $hasSet = false;
  $hasCard = false;
  foreach ($response["changes"] ?? [] as $change) {
      $hasSet = $hasSet || (
          ($change["resource"] ?? "") === "accessible_flashcard_review_sets"
          && ($change["id"] ?? "") === $argv[1]
          && ($change["deleted"] ?? true) === false
      );
      $hasCard = $hasCard || (
          ($change["resource"] ?? "") === "review_set_cards"
          && ($change["id"] ?? "") === $argv[1] . ":" . $argv[2]
          && ($change["deleted"] ?? true) === false
      );
  }
  if (!$hasSet || !$hasCard) {
      fwrite(STDERR, "Incremental sync did not deliver an existing shared Review set and its cards.\n");
      exit(1);
  }
' "$manual_review_set_id" "$flashcard_id" <<<"$bob_share_sync_response"

bob_review_sets_response="$(curl --silent --show-error --fail \
  -H "Authorization: Bearer $bob_token" \
  "$api_url/flashcard-review-sets")"
bob_shared_set_summary="$(php -r '
  $sets = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  foreach ($sets as $set) {
      if (($set["id"] ?? "") === $argv[1]) {
          echo implode(":", [
              $set["access_role"] ?? "", $set["owner_name"] ?? "",
              $set["matching_card_count"] ?? 0, count($set["tag_details"] ?? []),
          ]);
      }
  }
' "$manual_review_set_id" <<<"$bob_review_sets_response")"
[[ "$bob_shared_set_summary" == "readonly:Alice Updated:1:1" ]] || {
  echo "The shared Review set was not listed with live owner metadata." >&2
  exit 1
}

readonly_card_create_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $bob_token" \
  --data '{"front":"Readonly edit","back":"Blocked"}' \
  "$api_url/flashcard-review-sets/$manual_review_set_id/cards")"
[[ "$readonly_card_create_status" == 403 ]] || {
  echo "Read-only Review set access allowed a card edit." >&2
  exit 1
}

bob_preference_response="$(curl --silent --show-error --fail \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $bob_token" \
  --data '{"mode":"manual","card_sides":"front","indefinite":false,"max_cards":7,"front_seconds":9,"back_seconds":11,"back_speech_repeat_count":2,"note_before_back":true,"speech_enabled":false,"front_language":"","back_language":"","sort_mode":"least_recent","sort_direction":"desc"}' \
  "$api_url/flashcard-review-sets/$manual_review_set_id/preferences")"
bob_preference_summary="$(php -r '
  $set = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo $set["card_sides"] . ":" . $set["max_cards"] . ":"
    . ((int) $set["note_before_back"]) . ":" . $set["sort_mode"] . ":" . $set["sort_direction"];
' <<<"$bob_preference_response")"
alice_limit="$(sqlite3 "$test_db" \
  "SELECT max_cards FROM flashcard_review_set_preferences WHERE review_set = '$manual_review_set_id' AND account = '$alice_id';")"
bob_id="$(sqlite3 "$test_db" "SELECT id FROM users WHERE email = '$bob_email';")"
bob_limit="$(sqlite3 "$test_db" \
  "SELECT max_cards FROM flashcard_review_set_preferences WHERE review_set = '$manual_review_set_id' AND account = '$bob_id';")"
[[ "$bob_preference_summary" == "front:7:1:least_recent:desc" && "$alice_limit" != "$bob_limit" && "$bob_limit" == 7 ]] || {
  echo "Recipient Review set preferences were not stored independently." >&2
  exit 1
}

editor_share_response="$(curl --silent --show-error --fail \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data '{"role":"editor"}' \
  "$api_url/flashcard-review-set-shares/$share_id")"
editor_share_shape="$(php -r '
  $share = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  $keys = array_keys($share);
  sort($keys);
  echo implode(",", $keys) . ":" . ($share["role"] ?? "");
' <<<"$editor_share_response")"
[[ "$editor_share_shape" == "$expected_share_keys:editor" ]] || {
  echo "The Review set share role update exposed account-registration information." >&2
  exit 1
}

editor_card_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $bob_token" \
  --data '{"front":"Shared editor card","back":"Created by Bob","note":"Owner data","image_url":""}' \
  "$api_url/flashcard-review-sets/$manual_review_set_id/cards")"
editor_card_id="$(json_field id <<<"$editor_card_response")"
editor_card_owner_and_tags="$(sqlite3 "$test_db" \
  "SELECT owner || ':' || json_array_length(tags) || ':' || json_extract(tags, '\$[0]') FROM flashcards WHERE id = '$editor_card_id';")"
[[ "$editor_card_owner_and_tags" == "$alice_id:1:$flashcard_tag_id" ]] || {
  echo "An editor-created card was not stored with the owner and locked set tags." >&2
  exit 1
}

editor_import_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $bob_token" \
  --data '{"rows":[{"front":"Imported shared one","back":"First","note":"","tags":["ignored"]},{"front":"Imported shared two","back":"Second","note":"Note","tags":[]}]}' \
  "$api_url/flashcard-review-sets/$manual_review_set_id/cards/import")"
editor_import_ids="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo implode(",", array_column($data["cards"], "id"));
' <<<"$editor_import_response")"
IFS=',' read -r editor_import_first_id editor_import_second_id <<<"$editor_import_ids"
editor_import_summary="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) || ':' || MIN(owner) || ':' || MIN(json_array_length(tags)) || ':' || MIN(json_extract(tags, '\$[0]')) FROM flashcards WHERE id IN ('$editor_import_first_id', '$editor_import_second_id');")"
[[ "$editor_import_summary" == "2:$alice_id:1:$flashcard_tag_id" ]] || {
  echo "A Review set editor import did not use the owner and locked set tags." >&2
  exit 1
}

editor_bulk_delete_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $bob_token" \
  --data "{\"action\":\"delete\",\"card_ids\":[\"$editor_import_first_id\",\"$editor_import_second_id\"]}" \
  "$api_url/flashcard-review-sets/$manual_review_set_id/cards/bulk")"
editor_bulk_delete_count="$(php -r '
  $data = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo count($data["deleted_ids"] ?? []);
' <<<"$editor_bulk_delete_response")"
[[ "$editor_bulk_delete_count" == 2 \
  && "$(sqlite3 "$test_db" "SELECT COUNT(*) FROM flashcards WHERE id IN ('$editor_import_first_id', '$editor_import_second_id');")" == 0 ]] || {
  echo "A Review set editor could not bulk delete matching cards." >&2
  exit 1
}

editor_tag_change_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $bob_token" \
  --data '{"tags":[]}' \
  "$api_url/flashcard-review-sets/$manual_review_set_id/cards/$editor_card_id")"
[[ "$editor_tag_change_status" == 422 ]] || {
  echo "A Review set editor was allowed to change locked card tags." >&2
  exit 1
}
curl --silent --show-error --fail \
  -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer $bob_token" \
  --data '{"front":"Shared editor card updated"}' \
  "$api_url/flashcard-review-sets/$manual_review_set_id/cards/$editor_card_id" >/dev/null
[[ "$(sqlite3 "$test_db" "SELECT front FROM flashcards WHERE id = '$editor_card_id';")" == "Shared editor card updated" ]] || {
  echo "A Review set editor could not update owner card content." >&2
  exit 1
}
editor_card_delete_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X DELETE -H "Authorization: Bearer $bob_token" \
  "$api_url/flashcard-review-sets/$manual_review_set_id/cards/$editor_card_id")"
[[ "$editor_card_delete_status" == 204 \
  && "$(sqlite3 "$test_db" "SELECT COUNT(*) FROM flashcards WHERE id = '$editor_card_id';")" == 0 ]] || {
  echo "A Review set editor could not permanently delete an owner card." >&2
  exit 1
}

bob_shared_session_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $bob_token" \
  --data '{"task":"","program_step":"","task_date":""}' \
  "$api_url/flashcard-review-sets/$manual_review_set_id/sessions")"
bob_shared_session_id="$(json_field id <<<"$bob_shared_session_response")"
curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $bob_token" \
  --data '{"action":"error","elapsed_seconds":3}' \
  "$api_url/flashcard-review-sessions/$bob_shared_session_id/actions" >/dev/null
bob_stat_error_count="$(sqlite3 "$test_db" \
  "SELECT error_count FROM flashcard_review_card_stats WHERE reviewer = '$bob_id' AND card = '$flashcard_id';")"
owner_legacy_error_count="$(sqlite3 "$test_db" "SELECT error_count FROM flashcards WHERE id = '$flashcard_id';")"
[[ "$bob_stat_error_count" == 1 && "$owner_legacy_error_count" == 0 ]] || {
  echo "Shared Review set progress was not isolated per reviewer." >&2
  exit 1
}

copied_set_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $bob_token" \
  -X POST \
  "$api_url/flashcard-review-sets/$manual_review_set_id/copies")"
copied_set_id="$(json_field id <<<"$copied_set_response")"
copied_set_summary="$(php -r '
  $set = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  echo $set["access_role"] . ":" . $set["matching_card_count"] . ":" . $set["max_cards"];
' <<<"$copied_set_response")"
bob_live_share_count="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM flashcard_review_set_shares WHERE id = '$share_id' AND recipient = '$bob_id';")"
[[ "$copied_set_summary" == "owner:1:7" && "$bob_live_share_count" == 1 ]] || {
  echo "Copying a shared Review set did not create an independent snapshot while keeping the live share." >&2
  exit 1
}

bob_shared_task_payload="$(php -r '
  echo json_encode([
    "name" => "Bob shared review", "description" => "", "type" => "flashcards",
    "tags" => [], "mandatory" => true, "review_when_missed" => false,
    "active" => true, "start_date" => $argv[2], "end_date" => "",
    "recurrence_type" => "daily", "weekdays" => [], "interval_weeks" => 1,
    "target_value" => 1, "target_operator" => "gte", "unit" => "",
    "custom_unit" => "", "goal_period" => "occurrence", "quick_amounts" => [],
    "cycle_length" => 0, "program_repeat" => true, "program_strict" => false,
    "entry_notes_enabled" => false, "entry_note_suggestions_enabled" => false,
    "sort_order" => 1, "color" => "#C7F464", "interval_template" => "",
    "flashcard_review_set" => $argv[1], "tracking_trackers" => [],
  ], JSON_THROW_ON_ERROR);
' "$manual_review_set_id" "$flashcard_today")"
bob_shared_task_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $bob_token" \
  --data "$bob_shared_task_payload" \
  "$api_url/collections/tasks/records")"
bob_shared_task_id="$(json_field id <<<"$bob_shared_task_response")"

bob_program_payload="$(php -r '
  $task = json_decode($argv[1], true, 512, JSON_THROW_ON_ERROR);
  $task["name"] = "Bob shared program";
  $task["type"] = "program";
  $task["cycle_length"] = 1;
  $task["flashcard_review_set"] = "";
  echo json_encode($task, JSON_THROW_ON_ERROR);
' "$bob_shared_task_payload")"
bob_program_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $bob_token" \
  --data "$bob_program_payload" \
  "$api_url/collections/tasks/records")"
bob_program_id="$(json_field id <<<"$bob_program_response")"
bob_program_step_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $bob_token" \
  --data "{\"task\":\"$bob_program_id\",\"name\":\"Shared cards\",\"description\":\"\",\"sort_order\":0,\"cycle_days\":[1],\"completion_type\":\"flashcards\",\"target_value\":1,\"target_operator\":\"gte\",\"unit\":\"\",\"custom_unit\":\"\",\"quick_amounts\":[],\"active\":true,\"interval_template\":\"\",\"flashcard_review_set\":\"$manual_review_set_id\"}" \
  "$api_url/collections/program_steps/records")"
bob_program_step_id="$(json_field id <<<"$bob_program_step_response")"

bob_interval_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $bob_token" \
  --data "{\"name\":\"Bob shared interval\",\"description\":\"\",\"color\":\"#66D9C8\",\"definition\":{\"version\":1,\"children\":[{\"id\":\"step-1\",\"type\":\"step\",\"name\":\"Work\",\"kind\":\"work\",\"durationSeconds\":1}]},\"sound_enabled\":true,\"vibration_enabled\":true,\"sound\":\"beep\",\"sort_order\":0,\"flashcard_review_set\":\"$manual_review_set_id\"}" \
  "$api_url/collections/interval_templates/records")"
bob_interval_id="$(json_field id <<<"$bob_interval_response")"

share_delete_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X DELETE -H "Authorization: Bearer $alice_token" \
  "$api_url/flashcard-review-set-shares/$share_id")"
detached_shared_integrations="$(sqlite3 "$test_db" \
  "SELECT (SELECT flashcard_review_set FROM tasks WHERE id = '$bob_shared_task_id') || ':' || (SELECT flashcard_review_set FROM program_steps WHERE id = '$bob_program_step_id') || ':' || (SELECT flashcard_review_set FROM interval_templates WHERE id = '$bob_interval_id');")"
revoked_original_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Authorization: Bearer $bob_token" \
  "$api_url/flashcard-review-sets/$manual_review_set_id/cards")"
copied_set_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Authorization: Bearer $bob_token" \
  "$api_url/flashcard-review-sets/$copied_set_id/cards")"
preserved_shared_history="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM flashcard_review_sessions WHERE id = '$bob_shared_session_id' AND owner = '$bob_id' AND source_owner = '$alice_id';")"
[[ "$share_delete_status" == 204 && "$detached_shared_integrations" == "::" \
  && "$revoked_original_status" == 404 && "$copied_set_status" == 200 \
  && "$preserved_shared_history" == 1 ]] || {
  echo "Revoking a Review set did not detach integrations while preserving history and copies." >&2
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
[[ "$flashcard_delete_status" == 204 && "$flashcard_history_snapshot" == 11 ]] || {
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

looping_flashcard_task_delete_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X DELETE -H "Authorization: Bearer $alice_token" \
  "$api_url/collections/tasks/records/$looping_flashcard_task_id")"
detached_looping_session_count="$(sqlite3 "$test_db" \
  "SELECT COUNT(*) FROM flashcard_review_sessions WHERE id = '$looping_flashcard_session_id' AND task = '' AND program_step = '';")"
[[ "$looping_flashcard_task_delete_status" == 204 && "$detached_looping_session_count" == 1 ]] || {
  echo "Deleting a looping flashcard task did not preserve and detach its session history." >&2
  exit 1
}

hybrid_duration_task_delete_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X DELETE -H "Authorization: Bearer $alice_token" \
  "$api_url/collections/tasks/records/$hybrid_duration_task_id")"
[[ "$hybrid_duration_task_delete_status" == 204 ]] || {
  echo "Deleting the hybrid Review-set duration task failed." >&2
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

tracking_task_delete_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X DELETE -H "Authorization: Bearer $alice_token" \
  "$api_url/collections/tasks/records/$tracking_task_id")"
[[ "$tracking_task_delete_status" == 204 ]] || {
  echo "Deleting a tracking task failed." >&2
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
journal_after_tracker_delete="$(curl --silent --show-error --fail \
  -H "Authorization: Bearer $alice_token" \
  "$api_url/collections/journal_entries/records/$journal_id")"
php -r '
  $entry = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
  if (
      ($entry["tracker"] ?? []) !== [$argv[2]]
      || ($entry["tracker_snapshot"][$argv[1]] ?? "") !== "Mood"
      || ($entry["tracker_snapshot"][$argv[2]] ?? "") !== "Energy"
  ) {
      fwrite(STDERR, "Tracker deletion did not safely detach one journal context.\n");
      exit(1);
  }
' "$tracker_id" "$second_tracker_id" <<<"$journal_after_tracker_delete"

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
deleted_journal_image_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  "$api_url/journal-images/$journal_image_file")"
[[ "$deleted_journal_image_status" == 404 ]] || {
  echo "Deleting a reflection did not remove its image file." >&2
  exit 1
}

sync_compaction_cursor="$(sqlite3 "$test_db" \
  "SELECT COALESCE(MAX(sequence), 0) FROM sync_change_log WHERE account_id = '$alice_id';")"
sqlite3 "$test_db" "
  UPDATE sync_clients
  SET acknowledged_cursor = $sync_compaction_cursor,
      last_seen_at = '2026-08-16T18:00:00.000Z'
  WHERE account_id = '$alice_id';
"
sync_compaction_body="$(php -r '
  echo json_encode([
      "clientId" => "integration-client",
      "cursor" => (int) $argv[1],
      "confirmedReceiptSequence" => 0,
      "operations" => [],
  ], JSON_THROW_ON_ERROR);
' "$sync_compaction_cursor")"
curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$sync_compaction_body" \
  "$api_url/sync/exchange" >/dev/null
sync_compaction_state="$(sqlite3 "$test_db" "
  SELECT (SELECT COUNT(*) FROM sync_change_log WHERE account_id = '$alice_id') || ':' ||
         (SELECT minimum_cursor FROM sync_retention_watermarks WHERE account_id = '$alice_id');
")"
[[ "$sync_compaction_state" == "0:$sync_compaction_cursor" ]] || {
  echo "Acknowledged sync changes were not compacted: $sync_compaction_state" >&2
  exit 1
}
stale_sync_body="$(php -r '
  echo json_encode([
      "clientId" => "integration-client",
      "cursor" => max(0, (int) $argv[1] - 1),
      "confirmedReceiptSequence" => 0,
      "operations" => [],
  ], JSON_THROW_ON_ERROR);
' "$sync_compaction_cursor")"
stale_sync_response="$(curl --silent --show-error --fail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $alice_token" \
  --data "$stale_sync_body" \
  "$api_url/sync/exchange")"
[[ "$(json_field resetRequired <<<"$stale_sync_response")" == 1 ]] || {
  echo "A client behind compacted sync history was not reset." >&2
  exit 1
}

echo "PHP API integration and isolation checks passed."
