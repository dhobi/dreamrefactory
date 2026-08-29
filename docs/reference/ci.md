# Continuous integration

*Prerequisite: [Tests](tests.md) — which suite covers what.*

Every suite this project has runs on a pull request, but not on the same
machine, and the split is forced by one fact: **the suites read the original
game files.** A `gamefiles/` copy is a ~7 GB CD rip. It is gitignored, it will
never be in the repository, and so no GitHub-hosted runner can ever open it.

Measured, in a checkout with no `gamefiles/` present:

| | Suites | Tests | Runs on |
|---|---|---|---|
| **without the rip** | 28 files | 211 pass, 2 skip, ~8 s | GitHub's machines — any pull request, forks included |
| **needs the rip** | 10 files | 321 tests with it, and they fail without | the self-hosted runner, same-repo branches only |

The ten are all Titanic's — `regression`, `savegame`, `re_builtins`, `interp`,
`nav`, `text`, `audio-rates`, `sound-channels`, `shp-play-order`,
`cst-play-order` — and `tests.yml` names them as an **exclusion**, so a suite
added later runs on GitHub's machines by default and, if it turns out to need
the rip, fails loudly and gets added to the list. The other direction would
have skipped it in silence.

Everything else builds its own fixtures with
[the write path](../engine/formats/README.md#writing-one-back) instead of
reading the game, which is exactly why it travels — and that now includes all
of `engine/tests/` and `site/tests/`, plus Dust's three, which
[skip](tests.md#dust-s-suites-—-dust-tests) rather than fail without a disc.

They fail rather than skip on purpose — `text.ts` asserts that it found language
trees, because a suite that silently checks nothing would let the table rot
behind a green tick.

## The four workflows

| Workflow | Trigger | What |
|---|---|---|
| [`tests.yml`](https://github.com/dhobi/dreamrefactory/blob/master/.github/workflows/tests.yml) | every PR, push to master | `portable` on GitHub's machines; `full` (whole auto suite + playthrough) self-hosted |
| [`browser.yml`](https://github.com/dhobi/dreamrefactory/blob/master/.github/workflows/browser.yml) | nightly 02:00 UTC, manual, or the `full-run` label on a PR | the browser suite — ~39 min, because it costs what the game costs |
| [`docs.yml`](https://github.com/dhobi/dreamrefactory/blob/master/.github/workflows/docs.yml) | push to master under `docs/` | publishes this site to `/dreamrefactory/docs/`, over the same FTP mirror the builds use. Not versioned against a game — [why](deploy.md#the-documentation-is-not-a-release) |
| [`deploy.yml`](https://github.com/dhobi/dreamrefactory/blob/master/.github/workflows/deploy.yml) | a `site-v*`, `taoot-v*` or `dust-v*` tag, or manual | builds that one package and uploads it — a tag naming none of the three is an error rather than a default. [Releasing and deploying](deploy.md) |

The browser suite is off the per-PR path deliberately. Add the **`full-run`**
label to a pull request to pull it in for that PR.

## Setting the runner up

```bash
tools/setup-runner.sh /srv/taoot/gamefiles
```

That downloads the pinned runner (checksum-verified), registers it against this
repository with the label **`taoot-gamefiles`**, records the rip's path in the
runner's `.env` as `TAOOT_GAMEFILES`, warms Playwright's Chromium, and installs
the runner as a service. Pass `--no-service` to run it in the foreground
instead.

Self-hosted runners are **free on every plan**, private repositories included,
and they consume none of the 2,000 GitHub-hosted Actions minutes.

### On a machine of its own

The usual case — the runner belongs on a box that is always on, not on a
laptop, because the nightly browser run needs it awake at 02:00.

**A clone is not one of the things that host needs.** The runner makes its own
checkout under `_work/` on every run, so a clone sitting next to it would only
go stale and confuse. Two things have to be there: the runner and the rip.

```bash
# 1. the rip — anywhere OUTSIDE the runner's directory, so no checkout can
#    clean it. ~7 GB, once.
rsync -a --info=progress2 gamefiles/ runner-host:/srv/taoot/gamefiles/

# 2. the script, on its own
scp tools/setup-runner.sh runner-host:~

# 3. a registration token, minted here, valid one hour, single use
gh api --method POST repos/dhobi/dreamrefactory/actions/runners/registration-token --jq .token

# 4. on that host
ssh runner-host
chmod +x ~/setup-runner.sh
./setup-runner.sh /srv/taoot/gamefiles --token PASTE_TOKEN_HERE
```

`--token` exists so the runner host never needs `gh` installed or a login on
it. If it happens to have both, drop the flag and the script mints its own.

What that host needs: **node 22+**, npm, curl, tar, and about 5 GB free beyond
the rip for the checkout, `node_modules` and Chromium. Headless is fine — the
browser suite runs Chromium headless, and `--with-deps` pulls the system
libraries it wants. The script checks the Node version and warns about the disk
before it registers anything.

Worth doing once the rip is over: make it unwritable to the runner's user, since
every suite only ever reads it.

```bash
sudo chown -R root:root /srv/taoot/gamefiles && sudo chmod -R a-w /srv/taoot/gamefiles
```

Then confirm from anywhere:

```bash
gh api repos/dhobi/dreamrefactory/actions/runners \
  --jq '.runners[] | {name, status, labels: [.labels[].name]}'
```

`status: "online"` and a `taoot-gamefiles` label is the whole check — the
workflows select that label, not a hostname, so a replacement machine needs no
change here.

The Playwright warm-up is skipped when the script runs without a checkout beside
it. That is harmless: `browser.yml` installs Chromium itself, so the first
nightly run is a few minutes longer and no later one is. The warm-up
deliberately refuses to run bare `npx --yes playwright`, which would fetch a
newer browser than the one the suite pins.

### The rips are linked in, never copied

**Two** rips now, one per game package: each game's Vite config resolves
`gamefiles/` inside its own root, so Titanic's tree goes to `taoot/gamefiles`
and Dust's disc — which used to be a `dust/` subdirectory of the first — to
`dust/gamefiles`. The runner's `.env` names both.

Titanic's is **required** and Dust's is **optional**: Dust's suites skip the disc
rather than failing without it (`dust/tests/` passes with no rip present), so an
unset `DUST_GAMEFILES` is a warning naming what will not be covered, not a failed
run. Demanding it was stricter than the tests are.

```yaml
- uses: actions/checkout@v4
- run: |                                        # AFTER the checkout
    ln -sfn "$TAOOT_GAMEFILES" taoot/gamefiles
    ln -sfn "$DUST_GAMEFILES"  dust/gamefiles
```

`browser.yml` links only Titanic's, because the play page it drives is Titanic's.

The ordering is not cosmetic. `actions/checkout` cleans with `git clean -ffdx`,
and `-x` deletes *ignored* files too — a link made before the checkout is gone
by the time the tests run. Remaking it costs nothing; the 8 GB never moves.

### The dev server does not get port 5175

The browser suite drives a live server and does not start one, so `browser.yml`
starts it — on **5199**, with `--strictPort`, and reachable through `APP_URL`.
Two reasons it must not be 5175, which is Titanic's own port and the driver's
default:

- the runner shares a machine with a person, and 5175 is where their own
  `npm run dev -w taoot` lives;
- without `--strictPort`, Vite hops to the next free port and the suite would
  quietly test *their* working tree instead of the checkout.

It has to be the **dev** server, not `vite preview`: the `/gamefiles` middleware
is a `configureServer` hook (`tools/vite-gamefiles.ts`), which preview never
runs. It is started with `--config taoot/vite.config.ts`, because the play page
is served from Titanic's root and no other. Cleanup kills the
recorded pid — never `pkill -f vite`, which on a shared machine takes the
owner's server with it.

## The rip's directory must be named `gamefiles`

Not a convention — a constraint, and it costs exactly one test to get wrong.

`gamefilesRoot()` in `taoot/tools/gamefiles.ts` is `process.env.TAOOT_GAMEFILES`
falling back to `taoot/gamefiles` resolved from that file — not from the working
directory, because the two stopped being the same thing when each package got its
own build (`npm test` runs from the repository root, a build from `taoot/`). So
**the project already reads that variable**. The harness therefore enumerates
the shipped saves at whatever real path it names, and `SHIPPED_SAVE` in
`taoot/src/save-seed.ts` matches them on a literal `gamefiles/` segment:

```js
const SHIPPED_SAVE = /(?:^|\/)gamefiles\/(?:[^/]+\/)*save\/(.+\.ti)$/i;
```

Point it at `/srv/taoot-gamefiles` and the regex sees `taoot-gamefiles/` — the
`gamefiles` is preceded by a hyphen, not a slash — so it matches nothing and one
test fails on its own:

```
the dev-server manifest's shipped saves are all recognised for seeding
  → manifest=109 matched=0
```

So use `/srv/taoot/gamefiles`. Both `setup-runner.sh` and the container's
entrypoint check the basename and refuse to start otherwise, because one red
assertion in `savegame.ts` is a poor way to learn this.

## The runner in a container

Everything for it is in
[`tools/runner/`](https://github.com/dhobi/dreamrefactory/tree/master/tools/runner).

```bash
docker build -f tools/runner/Dockerfile -t taoot-runner .   # from the repo root
```

Or take the published one, which is the same bytes — `danielhobi/taoot-runner`,
public, tagged both `latest` and by runner version:

```bash
docker pull danielhobi/taoot-runner:2.336.0
```

It carries no game files and no registration, so there is nothing in it that is
not in this directory. Pulling costs 1.2 GB compressed against a ~2.4 GB pull
from Microsoft if you build instead, so the reason to prefer it is a pinned set
of bytes rather than speed. If you do pull it, `taoot-runner.service` passes
`--pull=never` on purpose — change that to `--pull=always` only if you want a
restart to pick up a newly published image, which also means a rebuild can
change what runs without you asking.

The image is built on `mcr.microsoft.com/playwright:v1.61.1-noble`, whose tag
**must** equal the Playwright version in `package-lock.json` — the browsers come
from the image, and a mismatch means the suite drives a browser it was never
recorded against. `runner.env` holds that pin, the runner version and its
checksum, and is shared with `setup-runner.sh` so the two cannot drift.

Three things are deliberately absent from the image:

- **the game files.** A 7 GB rip in an image layer would be copied into every
  rebuild, and one `docker push` would publish copyrighted material. It is a
  read-only bind mount, which makes that mistake impossible rather than
  unlikely.
- **any registration.** `config.sh` runs at start-up, so the image holds no
  credential and no identity — which is also what allows one registration per
  job.
- **a clone of the repository.** The runner checks out its own copy per job.

### One job per container

The entrypoint registers with `--ephemeral`: the runner takes exactly one job,
de-registers, and the container exits. A supervisor starts the next one. That is
what stops a job leaving anything behind for its successor — no files, no stray
process, no half-installed dependency.

Because each start needs a fresh registration token and those live one hour, an
unattended runner cannot be handed one at setup. It needs `GITHUB_PAT` (a
fine-grained PAT with *Administration: Read and write* on this repository) to
mint them per start. `RUNNER_TOKEN` covers a single manual start with no PAT on
the box, but such a container will not survive a restart.

Two supervisors, and they are **not** equivalent:

| | What restarts | Isolation between successive jobs |
|---|---|---|
| [`compose.yml`](https://github.com/dhobi/dreamrefactory/blob/master/tools/runner/compose.yml) | `restart: always` restarts the container, **reusing its writable layer** | from the host, yes; from the previous job, no |
| [`taoot-runner.service`](https://github.com/dhobi/dreamrefactory/blob/master/tools/runner/taoot-runner.service) | `docker run --rm`, a **brand new container** each time | complete — a pristine filesystem per job |

Use the systemd unit if you want the stronger property; compose is the quick
way to try it.

### Under Portainer

[`portainer-stack.yml`](https://github.com/dhobi/dreamrefactory/blob/master/tools/runner/portainer-stack.yml)
is the same service adjusted for a web-editor stack. *Stacks → Add stack → Web
editor*, paste it, and add one environment variable underneath:

```
GITHUB_PAT = github_pat_...
```

Keeping the PAT in Portainer's variables box rather than in the stack text is
why the file reads it as `${GITHUB_PAT}` — the value stays out of the stack
definition and out of git.

Three things differ from `compose.yml`, and each is a thing Portainer cannot do:

- **no `build:`** — there is no checkout to build from, so it pulls
  `danielhobi/taoot-runner:2.336.0`;
- **no `env_file:`** — that wants a file beside the compose file, which a
  web-editor stack has not got;
- **`RUNNER_EPHEMERAL=0`** — the container stays up and takes job after job.
  This is the important one. In ephemeral mode the runner exits after *every*
  job, and Portainer draws that as a container restarting every few minutes,
  which at a glance is indistinguishable from a crash loop. Staying up trades
  the pristine-filesystem-per-job property for a supervisor display that means
  something.

What that trade actually costs is small: `actions/checkout` still runs
`git clean -ffdx` at the start of every job, so what carries between jobs is the
npm cache and anything a job wrote outside the workspace. Set
`RUNNER_EPHEMERAL: "1"` if you would rather have the isolation and read the
restarts as normal.

The stack assumes **standalone Docker**. Under Swarm, `mem_limit` and `cpus`
have to be rewritten as `deploy.resources.limits`.

And the temptation Portainer puts one click away: **do not mount
`/var/run/docker.sock`**. It hands any job root on the host.

The PAT goes in a root-owned `0600` file — `/etc/taoot-runner.env` for systemd,
`tools/runner/runner.secret` for compose. The latter is gitignored by pattern
(`/tools/runner/*.secret`), because a token that can register runners must never
be committable.

### What the container gives up

`cap_drop: ALL`, `no-new-privileges`, a non-root `runner` user, the rip mounted
`:ro`, memory and CPU ceilings so a runaway job cannot take the host down, and
`shm_size: 1g` because Playwright needs more than Docker's default 64 MB.

**No docker socket, ever.** Mounting `/var/run/docker.sock` hands any job root on
the host and makes every other line here decorative.

## Who can make this runner execute code

Worth being exact, because the honest answer is not about the runner at all:
**the runner runs whatever this repository's workflows tell it to, so the
question is who can write to the repository.**

| Who | Can they run code on it? |
|---|---|
| You | yes — that is the point |
| Anyone with push access | yes. The collaborator list *is* the access list |
| A fork's pull request | **no.** Both rip-reading jobs require `head.repo.full_name == github.repository` |
| A stranger, while the repo is private | no — they cannot see it, let alone open a PR |
| Someone who steals the PAT | they can register *their* machine as a runner for this repo, and read it. They cannot execute on yours. Still: treat it as a repo-admin credential |

Two things that are **not** protections, and are easy to mistake for them:

- **Labels are not a boundary.** Any workflow in the repository can target
  `self-hosted`. What keeps a fork out is the `if:` guard in the job, not the
  label.
- **"Require approval for first-time contributors"** — the default — is weaker
  than it reads: one merged typo fix makes someone permanently trusted. Use
  **all external contributors**.

Never add `pull_request_target` to a workflow that checks out the PR head. That
one combination hands a fork write-scoped credentials on your machine, and it is
the most common way self-hosted runners are compromised.

## What the plan does and does not give you

Running the tests on a pull request is free. **Requiring them to pass before a
merge is not**, while the repository is private:

```
GET /repos/dhobi/dreamrefactory/branches/master/protection
GET /repos/dhobi/dreamrefactory/rulesets
→ 403 "Upgrade to GitHub Pro or make this repository public to enable this feature."
```

So on Free + private the checks are advisory: a red X you can see and merge past
anyway. Two ways to get the hard gate — GitHub Pro, or **make the repository
public**, which enables branch protection and rulesets at no cost.

## Going public, and the one setting this changes

Public is what makes required checks free. It also makes the self-hosted runner
dangerous, because a fork's pull request is untrusted code and the machine it
would run on holds the rip. GitHub's guidance is blunt: *"we recommend that you
only use self-hosted runners with private repositories."*

Three things keep the pairing safe, and only two of them are in this repository:

1. **The rip-reading jobs refuse fork pull requests.** Both workflows guard on
   `github.event.pull_request.head.repo.full_name == github.repository`. A fork
   gets the `portable` job, which needs no rip and holds no secrets.
2. **No secrets reach those jobs**, and `permissions: contents: read`.
3. **The setting you must make by hand**, the day the repository goes public:
   *Settings → Actions → General → Approval for running fork pull request
   workflows from contributors →* **Require approval for all external
   contributors**. The default is only *first-time* contributors, which is
   weaker than it sounds — one merged typo fix makes someone permanently
   trusted.

Never add `pull_request_target` to a workflow that checks out the PR head. That
combination hands a fork write-scoped credentials, and it is the single most
common way self-hosted runners get compromised.

## Adding a test that reads the rip

Add it and let it fail. A new file runs in `portable` by default, and if it
opens `gamefiles/` it fails there loudly — then add its name to the exclude glob
in `tests.yml`. The list is written as the *inverse* (the ten that need the
rip) for exactly this reason: the failure mode is "we noticed", not "silently
untested".

Dust's suites make the other bargain and **skip** without a disc, which is why
`DUST_GAMEFILES` is optional on the runner while `TAOOT_GAMEFILES` is required.
If you add a Dust suite that cannot skip, say so — an unset variable there is a
warning naming what will not be covered, not a failure.

Back to the [reference index](README.md).
