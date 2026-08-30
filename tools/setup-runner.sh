#!/usr/bin/env bash
#
# Register this machine as a repository-level self-hosted runner for the test
# workflows, and point it at a local copy of the CD rip.
#
# Why self-hosted at all: most of the automatic suites, the playthrough and the
# whole browser suite read the original game files. Those are a 7.4 GB CD set
# (Titanic) and a 645 MB one (Dust), gitignored and never in the repository, so
# no GitHub-hosted runner can ever run them. The remaining suites do run on
# GitHub's machines — that is the `portable` job in .github/workflows/tests.yml.
#
# This script is SELF-CONTAINED: it does not need a clone of the repository to
# be present, because the runner makes its own checkout under `_work/`. Copy
# just this file to the runner host and run it there.
#
# TWO rips, because each game package resolves `gamefiles/` inside its own root:
# Titanic's tree of six editions and the demo, and Dust's single disc — which used
# to be a `dust/` subdirectory of the first and is its own tree now.
#
# Usage:
#   tools/setup-runner.sh /srv/taoot/gamefiles --dust /srv/dust/gamefiles
#   … --no-service         # register only, run by hand
#   … --token TOKEN        # for a host with no `gh`
#
# Requires: curl, tar, node 22+, npm. Plus EITHER `gh` logged in with admin on
# the repository, OR a registration token passed with --token — mint one from a
# machine that does have `gh`:
#
#   gh api --method POST repos/dhobi/dreamrefactory/actions/runners/registration-token --jq .token
#
# It expires in an hour and is single-use.
#
# SECURITY, and read this before making the repository public: a self-hosted
# runner executes whatever the workflow tells it to, on this machine, with this
# user's permissions. GitHub's own guidance is "we recommend that you only use
# self-hosted runners with private repositories". The workflows here take two
# precautions — the rip-reading jobs refuse to run for a pull request whose head
# is a fork, and nothing grants them secrets — but the third precaution is a
# repository setting this script cannot make for you:
#
#   Settings -> Actions -> General -> "Approval for running fork pull request
#   workflows from contributors" -> **Require approval for all external
#   contributors**
#
# Set that the same day the repository goes public. See docs/reference/ci.md.

set -euo pipefail

REPO="dhobi/dreamrefactory"

# The pinned version lives in tools/runner/runner.env so the container build and
# this script cannot drift apart. These values are the fallback for the case this
# script was copied to a host on its own — keep them in step when bumping.
RUNNER_VERSION="2.336.0"
RUNNER_SHA256="04cf0be1aff4c3ec3554466c39124ca250e3effd8873bb7e8d68535aa9505d5d"
_pinned="$(cd "$(dirname "$0")" 2>/dev/null && pwd)/runner/runner.env"
if [ -f "$_pinned" ]; then
  # shellcheck source=tools/runner/runner.env
  . "$_pinned"
  echo "pinned from $(basename "$(dirname "$_pinned")")/runner.env: runner ${RUNNER_VERSION}"
fi
RUNNER_HOME="${DREAMREFACTORY_RUNNER_HOME:-${TAOOT_RUNNER_HOME:-$HOME/actions-runner-dreamrefactory}}"
# The workflows select the machine by this label, not by hostname.
LABELS="self-hosted,linux,x64,dreamrefactory-gamefiles"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- arguments --
GAMEFILES=""
DUST_GAMEFILES=""
INSTALL_SERVICE=1
TOKEN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-service) INSTALL_SERVICE=0 ;;
    --dust)       DUST_GAMEFILES="${2:-}"; shift; [ -n "$DUST_GAMEFILES" ] || die "--dust needs a value" ;;
    --dust=*)     DUST_GAMEFILES="${1#*=}" ;;
    --token)      TOKEN="${2:-}"; shift; [ -n "$TOKEN" ] || die "--token needs a value" ;;
    --token=*)    TOKEN="${1#*=}" ;;
    -h|--help)    sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)           die "unknown option: $1" ;;
    *)            [ -z "$GAMEFILES" ] || die "unexpected argument: $1"; GAMEFILES="$1" ;;
  esac
  shift
done

[ -n "$GAMEFILES" ] || die "give the path to Titanic's gamefiles directory:
  setup-runner.sh /srv/taoot/gamefiles --dust /srv/dust/gamefiles"
# Dust's rip is OPTIONAL, exactly as the workflow treats it: its suites skip the
# disc rather than failing without it. Saying so beats refusing to register.
if [ -z "$DUST_GAMEFILES" ]; then
  printf 'note: no --dust given, so Dust\047s disc-reading tests will skip.\n'
  printf '      Add it later with: --dust /srv/dust/gamefiles\n'
fi

GAMEFILES="$(cd "$GAMEFILES" && pwd)" || die "cannot resolve $GAMEFILES"
[ -d "$GAMEFILES" ] || die "$GAMEFILES is not a directory"
if [ -n "$DUST_GAMEFILES" ]; then
  DUST_GAMEFILES="$(cd "$DUST_GAMEFILES" && pwd)" || die "cannot resolve $DUST_GAMEFILES"
  [ -d "$DUST_GAMEFILES" ] || die "$DUST_GAMEFILES is not a directory"
fi

# The directory must be CALLED gamefiles, and this is a real constraint, not a
# convention. The path lands in the runner's environment as TAOOT_GAMEFILES,
# which `gamefilesRoot()` (taoot/tools/gamefiles.ts) already reads — so the harness
# enumerates the shipped saves at this literal path, and SHIPPED_SAVE in
# src/save-seed.ts matches them on a `gamefiles/` path segment. Point this at a
# directory called `taoot-gamefiles` and the regex sees `taoot-gamefiles/`,
# matches nothing, and one test fails on its own: "the dev-server manifest's
# shipped saves are all recognised for seeding". Caught here, so it never gets
# that far.
for _d in "$GAMEFILES" ${DUST_GAMEFILES:+"$DUST_GAMEFILES"}; do
  if [ "$(basename "$_d")" != "gamefiles" ]; then
    die "the rip's directory must be NAMED 'gamefiles' (got: $_d)
Move it one level down — /srv/taoot/gamefiles, not /srv/taoot-gamefiles:
  sudo mkdir -p /srv/taoot && sudo mv '$_d' /srv/taoot/gamefiles
Why: taoot/src/save-seed.ts matches shipped saves on a literal 'gamefiles/' segment."
  fi
done

# An edition is a language tree; without at least one, every rip-reading suite
# fails on its first read rather than skipping, so check now instead of at 02:00.
editions="$(find "$GAMEFILES" -maxdepth 1 -mindepth 1 -type d -printf '%f ' 2>/dev/null || true)"
[ -n "$editions" ] || die "$GAMEFILES has no edition subdirectories (expected e.g. en, de, demo)"
printf 'rip: %s\n  editions: %s\n' "$GAMEFILES" "$editions"

# Dust is one disc, so there is no edition axis to check — only that the disc is
# where it says it is.
if [ -n "$DUST_GAMEFILES" ]; then
  [ -d "$DUST_GAMEFILES/dustcd" ] || die "$DUST_GAMEFILES has no dustcd/ — that is the disc"
  printf 'dust: %s\n' "$DUST_GAMEFILES"
fi

# ------------------------------------------------------------- preflight -----
command -v curl >/dev/null || die "curl is not installed"
command -v tar  >/dev/null || die "tar is not installed"
command -v node >/dev/null || die "node is not installed"
command -v npm  >/dev/null || die "npm is not installed"

# `gh` is only needed to mint a token; --token covers the host that has no gh.
if [ -z "$TOKEN" ]; then
  command -v gh >/dev/null || die "no --token given and gh is not installed here.
Mint one on a machine that has gh:
  gh api --method POST repos/${REPO}/actions/runners/registration-token --jq .token
then re-run with:  --token TOKEN"
  gh auth status >/dev/null 2>&1 || die "gh is not logged in — run: gh auth login"
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge 22 ] || die "node 22+ required (found $(node --version)); the workflows assume it"

# A run needs room for its own checkout, node_modules and Playwright's browsers.
# The rip is not copied, so it is not counted here.
avail_mb="$(df -Pm "$(dirname "$RUNNER_HOME")" | awk 'NR==2 {print $4}')"
if [ "${avail_mb:-0}" -lt 5000 ]; then
  echo "warning: only ${avail_mb} MB free at $(dirname "$RUNNER_HOME"); a browser run wants ~5 GB" >&2
fi

if [ -e "$RUNNER_HOME/.runner" ]; then
  die "a runner is already configured in $RUNNER_HOME.
Remove it first:  (cd '$RUNNER_HOME' && sudo ./svc.sh uninstall; ./config.sh remove)"
fi

# --------------------------------------------------- download and verify -----
mkdir -p "$RUNNER_HOME"
cd "$RUNNER_HOME"
tarball="actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"

if [ ! -f "$tarball" ]; then
  echo "downloading runner ${RUNNER_VERSION}..."
  curl -fSL -o "$tarball" \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${tarball}"
fi

echo "${RUNNER_SHA256}  ${tarball}" | sha256sum -c - \
  || die "checksum mismatch on $tarball — delete it and retry"

tar xzf "$tarball"

# ------------------------------------------------------------- register ------
# Single-use, expires in an hour — so it is fetched here rather than pasted in,
# unless the host has no `gh` and one was handed over with --token.
if [ -n "$TOKEN" ]; then
  token="$TOKEN"
  echo "using the registration token given on the command line"
else
  echo "requesting a registration token..."
  token="$(gh api --method POST "repos/${REPO}/actions/runners/registration-token" --jq .token)"
fi
[ -n "$token" ] || die "could not get a registration token (need admin on ${REPO})"

./config.sh \
  --unattended \
  --url "https://github.com/${REPO}" \
  --token "$token" \
  --name "$(hostname)-dreamrefactory" \
  --labels "$LABELS" \
  --work "_work" \
  --replace

# ------------------------------------------------------------ environment ----
# The runner exports every line of this file into each job. This is how the
# workflows find the rip without it ever being in the repository.
set_env() {
  if grep -q "^$1=" .env 2>/dev/null; then
    sed -i "s|^$1=.*|$1=$2|" .env
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
  printf 'wrote %s=%s to %s/.env\n' "$1" "$2" "$RUNNER_HOME"
}
set_env TAOOT_GAMEFILES "$GAMEFILES"
[ -n "$DUST_GAMEFILES" ] && set_env DUST_GAMEFILES "$DUST_GAMEFILES"

# ------------------------------------------------------------- playwright ----
# A warm-up, not a requirement: browser.yml runs `playwright install` itself, so
# the only thing this buys is that the first nightly run does not spend its time
# downloading a browser and apt packages.
#
# Only from inside a checkout, and only if its dependencies are installed —
# that is what pins the version to the repository's own Playwright. Bare
# `npx --yes playwright` would fetch whatever is newest, which is not the same
# browser the suite will drive, so this skips rather than install the wrong one.
repo_root="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd || true)"
if [ -n "$repo_root" ] && [ -x "$repo_root/node_modules/.bin/playwright" ]; then
  echo "warming Playwright's Chromium from $repo_root ..."
  (cd "$repo_root" && ./node_modules/.bin/playwright install --with-deps chromium) \
    || echo "warning: warm-up failed — browser.yml will install it per run instead" >&2
else
  echo "skipping the Playwright warm-up: no installed checkout next to this script."
  echo "  Harmless — browser.yml installs Chromium on its first run (adds a few"
  echo "  minutes once). To warm it up now: clone the repo, npm ci, then"
  echo "  npx playwright install --with-deps chromium"
fi

# --------------------------------------------------------------- service -----
if [ "$INSTALL_SERVICE" -eq 1 ]; then
  echo "installing the runner as a service (needs sudo)..."
  sudo ./svc.sh install "$USER"
  sudo ./svc.sh start
  sudo ./svc.sh status || true
else
  echo
  echo "registered but not installed as a service. Run it in the foreground with:"
  echo "  (cd '$RUNNER_HOME' && ./run.sh)"
fi

cat <<EOF

Done. Confirm GitHub sees it:
  gh api repos/${REPO}/actions/runners --jq '.runners[] | {name, status, labels: [.labels[].name]}'

Then start a run:
  gh workflow run tests.yml

Still to do by hand, before this repository goes public:
  Settings -> Actions -> General -> Approval for running fork pull request
  workflows from contributors -> "Require approval for all external contributors"
EOF
