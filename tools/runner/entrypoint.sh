#!/usr/bin/env bash
#
# Register, run exactly ONE job, de-register, exit.
#
# That is the `--ephemeral` posture, and it is the point of running the runner in
# a container at all: a job cannot leave anything behind for the next one — no
# files, no environment, no half-installed dependency, no process. The container
# exits when the job ends and the supervisor (compose's `restart: always`, or
# systemd) starts a fresh one, which registers itself again from scratch.
#
# Because each start needs a NEW registration token and those live one hour,
# an auto-restarting runner cannot be handed a token once at setup. It needs
# either:
#
#   GITHUB_PAT    a token that can mint registration tokens — a fine-grained PAT
#                 with "Administration: Read and write" on this repository, or a
#                 classic PAT with `repo`. Minted per start, never stored.
#   RUNNER_TOKEN  a single registration token, for one manual start with no PAT
#                 anywhere. The container will NOT survive a restart with this.
#
# Prefer the PAT for anything unattended, and keep it in a root-owned env file
# that the container reads — not in a shell history or a compose file.

set -euo pipefail

REPO="${TAOOT_REPO:-dhobi/taoot-web}"
API="${GITHUB_API_URL:-https://api.github.com}"
LABELS="${RUNNER_LABELS:-self-hosted,linux,x64,taoot-gamefiles}"
# A name per container instance. `--replace` means a restart reclaims its own
# entry instead of littering the runner list with dead ones.
NAME="${RUNNER_NAME:-taoot-$(hostname)}"

die() { printf 'entrypoint: %s\n' "$*" >&2; exit 1; }

cd /home/runner/runner

# ------------------------------------------------------------ preflight ------
# The mount is checked here rather than in the workflow so the failure names the
# real cause: a missing `-v` on `docker run`, not a broken test.
if [ ! -d "${TAOOT_GAMEFILES:-}" ]; then
  die "TAOOT_GAMEFILES (${TAOOT_GAMEFILES:-unset}) is not a directory inside the container.
Mount the rip read-only:  -v /your/gamefiles:${TAOOT_GAMEFILES:-/srv/taoot/gamefiles}:ro"
fi
if [ -z "$(ls -A "$TAOOT_GAMEFILES" 2>/dev/null)" ]; then
  die "$TAOOT_GAMEFILES is empty — the mount is there but the rip is not."
fi

# The directory has to be CALLED gamefiles. `gamefilesRoot()` in
# tools/gamefiles.ts reads this same variable, so the harness enumerates saves at
# this literal path, and SHIPPED_SAVE in src/save-seed.ts matches on a
# `gamefiles/` segment. Any other name costs exactly one test — checked here so
# it says so, instead of leaving a lone red assertion to interpret.
if [ "$(basename "$TAOOT_GAMEFILES")" != "gamefiles" ]; then
  die "TAOOT_GAMEFILES must END in a directory named 'gamefiles' (got: $TAOOT_GAMEFILES).
Mount one level deeper — /srv/taoot/gamefiles, not /srv/taoot-gamefiles.
Why: src/save-seed.ts matches shipped saves on a literal 'gamefiles/' path segment."
fi
printf 'entrypoint: rip mounted, editions: %s\n' "$(ls "$TAOOT_GAMEFILES" | tr '\n' ' ')"

# A read-only mount is the intent; say so if it is writable, because a job that
# can write to the rip can also corrupt the thing every suite compares against.
if [ -w "$TAOOT_GAMEFILES" ]; then
  echo "entrypoint: WARNING — $TAOOT_GAMEFILES is writable. Mount it with :ro" >&2
fi

# ----------------------------------------------------- one job, or many ------
# RUNNER_EPHEMERAL=1 (the default) takes one job and exits, so the container is
# replaced per job. Set it to 0 for a runner that stays up and takes job after
# job — which is what you want under a supervisor that shows container state,
# like Portainer, where a container exiting every few minutes reads as a crash
# loop rather than as the design.
#
# The cost of 0 is real but small: successive jobs share this container's
# filesystem. `actions/checkout` still cleans the workspace with `git clean
# -ffdx` at the start of every run, so what actually carries over is the npm
# cache and anything a job wrote outside the workspace.
#
# Decided BEFORE the token is fetched, so the mode is on the log even when
# authentication is what fails.
EPHEMERAL_ARGS=()
if [ "${RUNNER_EPHEMERAL:-1}" != "0" ]; then
  EPHEMERAL_ARGS+=(--ephemeral)
  echo "entrypoint: ephemeral — one job, then this container exits"
else
  echo "entrypoint: persistent — staying up for job after job (RUNNER_EPHEMERAL=0)"
fi

# ------------------------------------------------- a registration token ------
if [ -n "${GITHUB_PAT:-}" ]; then
  echo "entrypoint: minting a registration token..."
  resp="$(curl -fsS -X POST \
    -H "Authorization: Bearer ${GITHUB_PAT}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "${API}/repos/${REPO}/actions/runners/registration-token")" \
    || die "could not mint a token. The PAT needs Administration: Read and write on ${REPO}."
  token="$(printf '%s' "$resp" | jq -r .token)"
  [ -n "$token" ] && [ "$token" != "null" ] || die "no token in the API response: $resp"
elif [ -n "${RUNNER_TOKEN:-}" ]; then
  echo "entrypoint: using RUNNER_TOKEN (single use — this container will not survive a restart)"
  token="$RUNNER_TOKEN"
else
  die "set GITHUB_PAT (recommended) or RUNNER_TOKEN. See the comment at the top of this file."
fi

# --------------------------------------------------------------- register ----
# --disableupdate  no self-update. An unattended update mid-life would swap the
#                  binary under a run; the version is pinned in runner.env and
#                  bumped by rebuilding the image on purpose.
./config.sh \
  --unattended \
  --url "https://github.com/${REPO}" \
  --token "$token" \
  --name "$NAME" \
  --labels "$LABELS" \
  --work "_work" \
  "${EPHEMERAL_ARGS[@]}" \
  --disableupdate \
  --replace

# On SIGTERM (`docker stop`) the runner should take its registration with it,
# otherwise the repository accumulates offline entries. An ephemeral runner that
# already ran its job has removed itself and this simply finds nothing to do.
cleanup() {
  echo "entrypoint: stopping, removing the registration..."
  if [ -n "${GITHUB_PAT:-}" ]; then
    rm_token="$(curl -fsS -X POST \
      -H "Authorization: Bearer ${GITHUB_PAT}" \
      -H "Accept: application/vnd.github+json" \
      "${API}/repos/${REPO}/actions/runners/remove-token" 2>/dev/null | jq -r .token)" || true
    [ -n "${rm_token:-}" ] && [ "$rm_token" != "null" ] \
      && ./config.sh remove --token "$rm_token" >/dev/null 2>&1 || true
  fi
}
trap cleanup INT TERM

echo "entrypoint: waiting for one job (labels: ${LABELS})"
# `&` plus `wait` rather than `exec`, so the trap above can still fire.
./run.sh &
runner_pid=$!
wait "$runner_pid"
