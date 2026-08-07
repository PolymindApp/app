#!/usr/bin/env bash

set -euo pipefail

release_version="${1:-}"
release_remote="${RELEASE_REMOTE:-origin}"
release_branch="${RELEASE_BRANCH:-main}"
package_file="package.json"
gradle_file="android/app/build.gradle"
ios_project_file="ios/App/App.xcodeproj/project.pbxproj"

fail() {
  echo "Release stopped: $1" >&2
  exit 1
}

if [[ -n "$release_version" && ! "$release_version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo "Usage: pnpm release:android [X.X.X]" >&2
  exit 2
fi

command -v git >/dev/null 2>&1 || fail "git is required."
command -v node >/dev/null 2>&1 || fail "Node.js is required."
command -v pnpm >/dev/null 2>&1 || fail "pnpm is required."
command -v perl >/dev/null 2>&1 || fail "Perl is required to update the native app versions."
command -v codex >/dev/null 2>&1 || fail "Codex CLI is required to generate the release notes."

git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || fail "run this command from the repository."

repository_root="$(git rev-parse --show-toplevel)"
cd "$repository_root"

[[ -f "$package_file" && -f "$gradle_file" && -f "$ios_project_file" ]] \
  || fail "the app version files could not be found."

current_branch="$(git branch --show-current)"
[[ -n "$current_branch" ]] || fail "releases cannot be created from a detached HEAD."
[[ "$current_branch" == "$release_branch" ]] \
  || fail "switch to $release_branch before creating a release."

[[ -z "$(git status --porcelain -- "$package_file" "$gradle_file" "$ios_project_file")" ]] \
  || fail "commit or stash changes to the app version files before creating a release."

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Unrelated working tree changes will be left out of the release."
fi

git remote get-url "$release_remote" >/dev/null 2>&1 \
  || fail "git remote '$release_remote' does not exist."

echo "Refreshing $release_remote/$release_branch and release tags..."
git fetch --quiet "$release_remote" "$release_branch" --tags

remote_head="$(git rev-parse "$release_remote/$release_branch")"
local_head="$(git rev-parse HEAD)"
[[ "$local_head" == "$remote_head" ]] \
  || fail "$release_branch must exactly match $release_remote/$release_branch before releasing."

current_version="$(node -p "require('./$package_file').version")"
if [[ ! "$current_version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  fail "the current package version '$current_version' is not X.X.X."
fi

IFS=. read -r current_major current_minor current_patch <<<"$current_version"
if [[ -z "$release_version" ]]; then
  release_version="$current_major.$current_minor.$((current_patch + 1))"
  echo "No version provided; using next patch version $release_version."
fi

IFS=. read -r release_major release_minor release_patch <<<"$release_version"
if ! ((
  release_major > current_major
  || (release_major == current_major && release_minor > current_minor)
  || (
    release_major == current_major
    && release_minor == current_minor
    && release_patch > current_patch
  )
)); then
  fail "$release_version must be newer than the current version $current_version."
fi

release_tag="v$release_version"
if git rev-parse --verify --quiet "refs/tags/$release_tag" >/dev/null; then
  fail "tag $release_tag already exists."
fi

version_code_matches="$(grep -Ec '^[[:space:]]*versionCode[[:space:]]+[0-9]+[[:space:]]*$' "$gradle_file")"
version_name_matches="$(grep -Ec '^[[:space:]]*versionName[[:space:]]+"[^"]+"[[:space:]]*$' "$gradle_file")"
[[ "$version_code_matches" -eq 1 && "$version_name_matches" -eq 1 ]] \
  || fail "expected one versionCode and one versionName in $gradle_file."

ios_version_code_matches="$(grep -Ec '^[[:space:]]*CURRENT_PROJECT_VERSION = [0-9]+;$' "$ios_project_file")"
ios_version_name_matches="$(grep -Ec '^[[:space:]]*MARKETING_VERSION = [^;]+;$' "$ios_project_file")"
[[ "$ios_version_code_matches" -eq 2 && "$ios_version_name_matches" -eq 2 ]] \
  || fail "expected two iOS build versions and two marketing versions in $ios_project_file."

current_version_code="$(
  sed -n 's/^[[:space:]]*versionCode[[:space:]]\+\([0-9]\+\)[[:space:]]*$/\1/p' \
    "$gradle_file"
)"
[[ "$current_version_code" =~ ^[0-9]+$ ]] \
  || fail "the current Android versionCode could not be read."

current_ios_version_code="$(
  sed -n 's/^[[:space:]]*CURRENT_PROJECT_VERSION = \([0-9]\+\);$/\1/p' \
    "$ios_project_file" \
    | sort -u
)"
[[ "$current_ios_version_code" == "$current_version_code" ]] \
  || fail "the iOS build version must match Android versionCode $current_version_code."

current_ios_version="$(
  sed -n 's/^[[:space:]]*MARKETING_VERSION = \([^;]\+\);$/\1/p' \
    "$ios_project_file" \
    | sort -u
)"
[[ "$current_ios_version" == "$current_version" ]] \
  || fail "the iOS marketing version must match package version $current_version."

next_version_code=$((current_version_code + 1))
((next_version_code <= 2100000000)) || fail "the shared native build-number limit was reached."

previous_release_tag=""
while IFS= read -r candidate_tag; do
  if [[ "$candidate_tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
    previous_release_tag="$candidate_tag"
    break
  fi
done < <(git tag --merged HEAD --list 'v*' --sort=-version:refname)

release_temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/mom-release.XXXXXX")"
release_notes_file="$release_temp_dir/release-notes.md"
tag_message_file="$release_temp_dir/tag-message.md"
cleanup_release_files() {
  rm -rf -- "$release_temp_dir"
}
trap cleanup_release_files EXIT

if [[ -n "$previous_release_tag" ]]; then
  release_range="$previous_release_tag..HEAD"
  diff_base="$previous_release_tag"
  range_description="$previous_release_tag through HEAD"
else
  release_range="HEAD"
  diff_base="$(git hash-object -t tree /dev/null)"
  range_description="the repository's first commit through HEAD"
fi

release_notes_prompt='Write only the Markdown body for an annotated Git release tag from the supplied Git history and diff.

Requirements:
- Cover every material user-facing, server, Android, deployment, and developer-workflow change in the supplied range.
- Group related changes under concise Markdown headings and use clear bullet points.
- Prioritize behavior and outcomes over filenames or implementation mechanics.
- Do not include a release title, version heading, preamble, conclusion, or fenced code block.
- Do not mention changes outside the supplied committed range or infer unsupported behavior.
- Omit release-only version bumps and generated artifacts.'

echo "Asking Codex to summarize changes from $range_description..."
if ! {
  printf 'Release range: %s\n\nCommit history:\n' "$range_description"
  git log \
    --reverse \
    --date=short \
    --format='commit %H%nDate: %ad%nSubject: %s%n%n%b%n---' \
    "$release_range"
  printf '\nChanged files:\n'
  git diff --stat "$diff_base" HEAD
  printf '\nFull diff:\n'
  git diff --no-color --no-ext-diff --find-renames "$diff_base" HEAD
} | codex exec \
  --sandbox read-only \
  --ephemeral \
  --color never \
  --output-last-message "$release_notes_file" \
  --cd "$release_temp_dir" \
  --skip-git-repo-check \
  "$release_notes_prompt" >/dev/null; then
  fail "Codex could not generate the release notes. No release files were changed."
fi

grep -q '[^[:space:]]' "$release_notes_file" \
  || fail "Codex returned an empty release note. No release files were changed."

{
  printf 'Release %s\n\n' "$release_tag"
  sed -e 's/\r$//' "$release_notes_file"
  printf '\n'
} > "$tag_message_file"

echo "Generated tag message:"
cat "$tag_message_file"

echo "Preparing $release_tag (native build $next_version_code)..."
pnpm pkg set "version=$release_version"

RELEASE_VERSION="$release_version" \
NEXT_VERSION_CODE="$next_version_code" \
  perl -0pi -e '
    s/(versionCode\s+)\d+/$1$ENV{NEXT_VERSION_CODE}/;
    s/(versionName\s+)"[^"]+"/$1"$ENV{RELEASE_VERSION}"/;
  ' "$gradle_file"

RELEASE_VERSION="$release_version" \
NEXT_VERSION_CODE="$next_version_code" \
  perl -0pi -e '
    s/(CURRENT_PROJECT_VERSION = )\d+;/$1$ENV{NEXT_VERSION_CODE};/g;
    s/(MARKETING_VERSION = )[^;]+;/$1$ENV{RELEASE_VERSION};/g;
  ' "$ios_project_file"

[[ "$(node -p "require('./$package_file').version")" == "$release_version" ]] \
  || fail "the package version was not updated."
grep -Eq "^[[:space:]]*versionCode[[:space:]]+$next_version_code[[:space:]]*$" "$gradle_file" \
  || fail "the Android versionCode was not updated."
grep -Eq "^[[:space:]]*versionName[[:space:]]+\"$release_version\"[[:space:]]*$" "$gradle_file" \
  || fail "the Android versionName was not updated."
[[ "$(grep -Ec "^[[:space:]]*CURRENT_PROJECT_VERSION = $next_version_code;$" "$ios_project_file")" -eq 2 ]] \
  || fail "the iOS build version was not updated."
[[ "$(grep -Ec "^[[:space:]]*MARKETING_VERSION = $release_version;$" "$ios_project_file")" -eq 2 ]] \
  || fail "the iOS marketing version was not updated."
git diff --check -- "$package_file" "$gradle_file" "$ios_project_file"

git add -- "$package_file" "$gradle_file" "$ios_project_file"
git commit --only -m "Release $release_tag" -- "$package_file" "$gradle_file" "$ios_project_file"
git tag --annotate "$release_tag" --file "$tag_message_file"

echo "Pushing $release_branch and $release_tag to $release_remote..."
if ! git push --atomic "$release_remote" \
  "HEAD:refs/heads/$release_branch" \
  "refs/tags/$release_tag"; then
  echo "The push failed. The release commit and tag remain local." >&2
  echo "After resolving the problem, push them with:" >&2
  echo "  git push --atomic $release_remote $release_branch $release_tag" >&2
  exit 1
fi

echo "Released $release_tag."
