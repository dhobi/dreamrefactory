# A self-hosted runner for this repository's test workflows, in a container.
#
# Build from the REPOSITORY ROOT so runner.env is in context:
#   docker build -f tools/runner/Dockerfile -t taoot-runner .
#
# What is deliberately NOT in this image:
#
#   * the game files. A ~7 GB CD rip does not belong in an image layer — it
#     would be copied into every rebuild, and one `docker push` would publish
#     copyrighted material to a registry. It is a read-only bind mount instead
#     (see compose.yml), which makes that mistake impossible rather than
#     unlikely.
#   * any registration. `config.sh` runs at START-UP, not here, so the image
#     holds no credential and no identity. That is also what lets the runner be
#     ephemeral — a fresh registration per job.
#   * a clone of the repository. The runner checks out its own copy per job.

# Playwright's own image: it carries the browsers AND the system libraries they
# need, already matched to a Playwright release. The tag is pinned to the
# version in package-lock.json — see runner.env for why that has to match.
FROM mcr.microsoft.com/playwright:v1.61.1-noble

# Browsers live here in this image, outside any user's home, world-readable —
# which is what lets the non-root runner user below drive them.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    DEBIAN_FRONTEND=noninteractive \
    # Actions writes a lot of transient state; keep it off the image layers.
    RUNNER_ALLOW_RUNASROOT=0

# `jq` for the entrypoint's token call, `git` for checkout, `curl`/`tar` for the
# download below, `libicu` because the runner's .NET host needs it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl tar git jq libicu74 \
 && rm -rf /var/lib/apt/lists/*

# The suites assume Node 22+. The base image ships a Node; fail the BUILD if it
# is too old rather than let a run discover it, and say what to do about it.
RUN node_major="$(node -p 'process.versions.node.split(".")[0]')" \
 && echo "base image Node: $(node --version)" \
 && if [ "$node_major" -lt 22 ]; then \
      echo "ERROR: this base image ships Node $(node --version); the suites need 22+." >&2; \
      echo "Either use a newer playwright tag or add a NodeSource install here." >&2; \
      exit 1; \
    fi

# A non-root user. The runner refuses to configure itself as root without an
# explicit override, and that refusal is worth keeping: a workflow step runs as
# this user, and it should not be able to alter the image or the mount.
RUN useradd --create-home --shell /bin/bash runner
WORKDIR /home/runner/runner

# Download and verify against the checksum pinned in runner.env — one source of
# truth shared with tools/setup-runner.sh.
COPY tools/runner/runner.env /tmp/runner.env
RUN . /tmp/runner.env \
 && tarball="actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
 && curl -fSL -o "/tmp/${tarball}" \
      "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${tarball}" \
 && echo "${RUNNER_SHA256}  /tmp/${tarball}" | sha256sum -c - \
 && tar xzf "/tmp/${tarball}" -C /home/runner/runner \
 && rm -f "/tmp/${tarball}" /tmp/runner.env \
 && ./bin/installdependencies.sh \
 && chown -R runner:runner /home/runner

COPY --chown=root:root --chmod=0755 tools/runner/entrypoint.sh /usr/local/bin/entrypoint.sh

USER runner

# Where the rip is mounted. The LAST SEGMENT MUST BE `gamefiles` — this is not
# cosmetic. `TAOOT_GAMEFILES` is a variable the project itself already reads
# (tools/gamefiles.ts: `gamefilesRoot()`), so the harness enumerates the shipped
# saves at this real path, and `SHIPPED_SAVE` in src/save-seed.ts matches on a
# literal `gamefiles/` path segment. Mounted at `/srv/taoot-gamefiles` the regex
# sees `taoot-gamefiles/`, matches nothing, and exactly one test fails:
# "the dev-server manifest's shipped saves are all recognised for seeding".
ENV TAOOT_GAMEFILES=/srv/taoot/gamefiles

# No CMD arguments: the entrypoint registers, runs exactly one job, and exits.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
