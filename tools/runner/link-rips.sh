#!/usr/bin/env bash
# Link each game's rip into the workspace, as `<game>/gamefiles`, from the
# runner's environment (tools/runner/compose.yml, or a bare-metal runner's
# .env; docs/reference/ci.md). Titanic's is required; the others warn when
# missing, and the steps that need them fail on their own.
#
# Shared by the workflows that run on the self-hosted runner: tests.yml's full
# job and coverage.yml.
set -euo pipefail
# One rip per game package, because each game's build and suites
# resolve `gamefiles/` inside their own package.
#
# Where a variable comes from depends on the runner. The container
# (tools/runner/) sets every one in its Dockerfile and compose.yml, so
# there "not a directory" means the VOLUME is missing; a bare-metal
# runner (tools/setup-runner.sh) reads them from its .env.
#
# Titanic's is REQUIRED: most of the automatic suites and the whole
# playthrough read it, and without it this job has nothing to do.
#
# Dust's is OPTIONAL, because its suites already skip the disc rather
# than failing without it — `dust/tests/` passes 15 tests with no rip
# present at all. Demanding it here was stricter than the tests are, and
# it blocked a host that has never needed Dust's disc. Unset is a
# WARNING with the consequence named, not an error. That holds for
# the automatic suite only: every game's machine-suites step below
# FAILS without its rip when the change reaches that game.
if [ -z "${TAOOT_GAMEFILES:-}" ] || [ ! -d "${TAOOT_GAMEFILES:-}" ]; then
  echo "::error::TAOOT_GAMEFILES (${TAOOT_GAMEFILES:-unset}) is not a directory."
  echo "In the runner container that is a volume in tools/runner/compose.yml; on a bare-metal runner, its .env. See docs/reference/ci.md."
  exit 1
fi
ln -sfn "$TAOOT_GAMEFILES" taoot/gamefiles
echo "editions present: $(ls taoot/gamefiles | tr '\n' ' ')"

if [ -n "${DUST_GAMEFILES:-}" ] && [ -d "${DUST_GAMEFILES:-}" ]; then
  ln -sfn "$DUST_GAMEFILES" dust/gamefiles
  echo "dust present:     $(ls dust/gamefiles | tr '\n' ' ')"
else
  echo "::warning::DUST_GAMEFILES (${DUST_GAMEFILES:-unset}) is not a directory — Dust's disc-reading tests will skip, and its machine suites, which cannot run without the disc, will FAIL if this change reaches them. In the runner container that is a volume in tools/runner/compose.yml; on a bare-metal runner, its .env. See docs/reference/ci.md."
fi

# Skull Cracker's, OPTIONAL for the same reason as Dust's: its suites
# skip rather than fail without it. `engine/tests/skull-sound.ts`
# resolves `../../skullcracker/gamefiles/SKULL/DATA` and warns "no
# Skull Cracker sound banks ... skipping" when it is not there — which
# is what this job had been doing silently, on a host that has the
# disc, because only two of the four rips were ever linked here.
if [ -n "${SKULLCRACKER_GAMEFILES:-}" ] && [ -d "${SKULLCRACKER_GAMEFILES:-}" ]; then
  ln -sfn "$SKULLCRACKER_GAMEFILES" skullcracker/gamefiles
  echo "skullcracker:     $(ls skullcracker/gamefiles | tr '\n' ' ')"
else
  echo "::warning::SKULLCRACKER_GAMEFILES (${SKULLCRACKER_GAMEFILES:-unset}) is not a directory — Skull Cracker's disc-reading tests will skip, and its machine suites will FAIL if this change reaches them. In the runner container that is a volume in tools/runner/compose.yml; on a bare-metal runner, its .env. See docs/reference/ci.md."
fi

# RedJack's three discs, OPTIONAL like the two above:
# `engine/tests/df5-room.ts` reads `redjack/gamefiles` and skips its
# corpus half without it.
if [ -n "${REDJACK_GAMEFILES:-}" ] && [ -d "${REDJACK_GAMEFILES:-}" ]; then
  ln -sfn "$REDJACK_GAMEFILES" redjack/gamefiles
  echo "redjack:          $(ls redjack/gamefiles | tr '\n' ' ')"
else
  echo "::warning::REDJACK_GAMEFILES (${REDJACK_GAMEFILES:-unset}) is not a directory — RedJack's disc-reading tests will skip, and its machine suites will FAIL if this change reaches them. In the runner container that is a volume in tools/runner/compose.yml; on a bare-metal runner, its .env. See docs/reference/ci.md."
fi

# Timelapse's four discs, OPTIONAL like the others: only its own
# machine suites read them, and that step fails without them. All
# four, because the whole game is played and its last world is on
# the fourth.
if [ -n "${TIMELAPSE_GAMEFILES:-}" ] && [ -d "${TIMELAPSE_GAMEFILES:-}" ]; then
  ln -sfn "$TIMELAPSE_GAMEFILES" timelapse/gamefiles
  echo "timelapse:        $(ls timelapse/gamefiles | tr '\n' ' ')"
else
  echo "::warning::TIMELAPSE_GAMEFILES (${TIMELAPSE_GAMEFILES:-unset}) is not a directory — Timelapse's machine suites will FAIL if this change reaches them. In the runner container that is a volume in tools/runner/compose.yml; on a bare-metal runner, its .env. See docs/reference/ci.md."
fi

# Lunicus's disc and its saves, OPTIONAL like the others: its machine
# suites fail without it, and the corpus half of
# `engine/tests/df0-formats.ts`, which reads `lunicus/gamefiles`, skips.
if [ -n "${LUNICUS_GAMEFILES:-}" ] && [ -d "${LUNICUS_GAMEFILES:-}" ]; then
  ln -sfn "$LUNICUS_GAMEFILES" lunicus/gamefiles
  echo "lunicus:          $(ls lunicus/gamefiles | tr '\n' ' ')"
else
  echo "::warning::LUNICUS_GAMEFILES (${LUNICUS_GAMEFILES:-unset}) is not a directory — Lunicus's disc-reading tests will skip, and its machine suites will FAIL if this change reaches them. In the runner container that is a volume in tools/runner/compose.yml; on a bare-metal runner, its .env. See docs/reference/ci.md."
fi

# Jump Raven's disc, OPTIONAL like the others: its machine suites fail
# without it. The variable names the directory holding RAVEN/, as
# jumpraven/gamefiles does.
if [ -n "${JUMPRAVEN_GAMEFILES:-}" ] && [ -d "${JUMPRAVEN_GAMEFILES:-}" ]; then
  ln -sfn "$JUMPRAVEN_GAMEFILES" jumpraven/gamefiles
  echo "jumpraven:        $(ls jumpraven/gamefiles | tr '\n' ' ')"
else
  echo "::warning::JUMPRAVEN_GAMEFILES (${JUMPRAVEN_GAMEFILES:-unset}) is not a directory — Jump Raven's machine suites will FAIL if this change reaches them. In the runner container that is a volume in tools/runner/compose.yml; on a bare-metal runner, its .env. See docs/reference/ci.md."
fi

      # No setup-node here: the runner's own Node is used, so a run does not
      # re-download a toolchain onto a machine that already has one.
