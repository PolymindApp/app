#!/usr/bin/env bash

set -euo pipefail

release_version="${1:-}"
release_remote="${RELEASE_REMOTE:-origin}"
release_branch="${RELEASE_BRANCH:-main}"
package_file="package.json"
gradle_file="android/app/build.gradle"

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
command -v perl >/dev/null 2>&1 || fail "Perl is required to update the Android version."

git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || fail "run this command from the repository."

repository_root="$(git rev-parse --show-toplevel)"
cd "$repository_root"

[[ -f "$package_file" && -f "$gradle_file" ]] \
  || fail "the app version files could not be found."

current_branch="$(git branch --show-current)"
[[ -n "$current_branch" ]] || fail "releases cannot be created from a detached HEAD."
[[ "$current_branch" == "$release_branch" ]] \
  || fail "switch to $release_branch before creating a release."

[[ -z "$(git status --porcelain)" ]] \
  || fail "commit or stash all changes before creating a release."

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

current_version_code="$(
  sed -n 's/^[[:space:]]*versionCode[[:space:]]\+\([0-9]\+\)[[:space:]]*$/\1/p' \
    "$gradle_file"
)"
[[ "$current_version_code" =~ ^[0-9]+$ ]] \
  || fail "the current Android versionCode could not be read."
next_version_code=$((current_version_code + 1))
((next_version_code <= 2100000000)) || fail "the Android versionCode limit was reached."

echo "Preparing $release_tag (Android versionCode $next_version_code)..."
pnpm pkg set "version=$release_version"

RELEASE_VERSION="$release_version" \
NEXT_VERSION_CODE="$next_version_code" \
  perl -0pi -e '
    s/(versionCode\s+)\d+/$1$ENV{NEXT_VERSION_CODE}/;
    s/(versionName\s+)"[^"]+"/$1"$ENV{RELEASE_VERSION}"/;
  ' "$gradle_file"

[[ "$(node -p "require('./$package_file').version")" == "$release_version" ]] \
  || fail "the package version was not updated."
grep -Eq "^[[:space:]]*versionCode[[:space:]]+$next_version_code[[:space:]]*$" "$gradle_file" \
  || fail "the Android versionCode was not updated."
grep -Eq "^[[:space:]]*versionName[[:space:]]+\"$release_version\"[[:space:]]*$" "$gradle_file" \
  || fail "the Android versionName was not updated."
git diff --check

git add -- "$package_file" "$gradle_file"
git commit -m "Release $release_tag"
git tag --annotate "$release_tag" --message "Release $release_tag"

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
