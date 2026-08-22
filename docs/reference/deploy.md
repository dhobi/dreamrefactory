# Releasing and deploying

*Prerequisite: [Continuous integration](ci.md) — which suites run where.*

Everything is published under <https://www.danielhobi.ch/dreamrefactory/>, and
**a release is a tag**. Nothing deploys from an ordinary push to master except
the documentation.

## Four things in one directory

Three builds and a doc set share that one hosting directory, and each goes out on
its own:

| tag | build | lands at |
|---|---|---|
| `site-v0.1.0` | `npm run build:site` | `/dreamrefactory/` — the front door and the seven format editors |
| `taoot-v0.9.51` | `npm run build:taoot` | `/dreamrefactory/taoot/` — Titanic's four pages |
| `dust-v0.3.1` | `npm run build:dust` | `/dreamrefactory/dust/` — Dust's one page |
| *(no tag)* | `npm run docs:build` | `/dreamrefactory/docs/` — on any push that touches `docs/` |

```bash
# in the package that is releasing:
npm version 0.9.1 --no-git-tag-version -w @dreamfactory/taoot
# commit, merge, then tag the merged commit:
git tag taoot-v0.9.1 && git push --tags
```

**Do not let `npm version` cut the tag.** It writes a bare `v0.9.1`, which no
pattern here listens for — the tag would push and deploy nothing at all,
silently. `--no-git-tag-version` keeps it to the files and leaves the tag to the
hand that knows which of the three it is.

Every namespace carries its target's name, and a tag naming none of them **fails
the run** rather than defaulting to one. The old default-to-TAOOT is exactly what
would let a mis-typed tag ship the wrong build. `deploy.yml` can also be run
from the Actions tab, where a `workflow_dispatch` input picks the target.

### Why sharing a directory is safe

Because the mirror only **adds and overwrites** — see below. The site's build
writes the root of the tree and the two games write directories inside it, so
none of the three can remove another's files. Asset names are content-hashed, so
a superseded bundle is dead weight rather than a stale page.

### Each package holds its own version

There used to be one `package.json` with a `version` and a `dustVersion` in it,
which was a symptom of one build serving two games. Now:

| | |
|---|---|
| `taoot/package.json`, `dust/package.json`, `site/package.json` | the sources of truth — semver |
| each package's `vite.config.ts` | substitutes its own for `__APP_VERSION__` at build time |
| [`site/src/version.ts`](https://github.com/dhobi/dreamrefactory/blob/master/site/src/version.ts) | exports `VERSION`, and draws it in the top bar beside the wordmark |
| [`taoot/src/bug-report.ts`](https://github.com/dhobi/dreamrefactory/blob/master/taoot/src/bug-report.ts) | puts it in the issue body, so a report names the build it came from |

There is one constant where there were two, because a page now belongs to exactly
one package and reads exactly one number. Node does no substitution, so a test or
a tool that imports `version.ts` reads `0.0.0-dev` rather than throwing.

The deploy fails if the tag and the package disagree: the pages read their number
from the manifest, and a site announcing a version nobody tagged is worse than a
failed deploy.

## What a deploy never touches

Each game's directory holds things that are in no build and never in this
repository:

| | | |
|---|---|---|
| `*/gamefiles/` | the CD rips | 7.4 GB (Titanic) and 645 MB (Dust), [gitignored forever](ci.md) |
| `*.zip` | the offline DBGL archives the collection page links to | ~1 GB apiece |
| `*/gamefiles.json` | the listing of a rip | see below |

`nightdive.mov` was a fourth until [#171](https://github.com/dhobi/dreamrefactory/issues/171).
It is **generated and deployed now**, and reaches the host like `lang.stg` does.
The film is not in git — `taoot/assets/nightdive.gif` is, and a Vite plugin
compiles the MOV into `taoot/public/` at build time.

So the mirror only **adds and overwrites**. There is no `--delete` and no option
to turn one on: re-uploading a wrong file costs a minute, and a deleted 7 GB rip
does not. The files that could in principle be *written* over are excluded from
the transfer as well ([`.github/actions/ftp-mirror`](https://github.com/dhobi/dreamrefactory/blob/master/.github/actions/ftp-mirror/action.yml),
which every deploy in the repository goes through).

### Why the manifest is not uploaded

`gamefiles.json` is the listing every page reads to find out what game data
exists ([the manifest](tools.md)). A build writes it by walking that game's
`gamefiles/` — and a GitHub runner has no rip, so the file it produces holds a
handful of entries against the **4,172** (Titanic) or **460** (Dust) the host
serves. Uploading it would leave the page offering nothing, so the workflow
deletes it before the transfer and excludes it besides.

The host's copy has to be regenerated whenever the game data there changes, or
when this repository adds an authored DF file to a package's `public/`. Do it
where the tree is, **once per game**:

```bash
cd …/dreamrefactory/taoot && npx tsx …/tools/mkmanifest.ts . ./gamefiles .
cd …/dreamrefactory/dust  && npx tsx …/tools/mkmanifest.ts . ./gamefiles .
```

The third argument is where the authored files (`lang.stg`, `nightdive.mov`) are:
`public/` in a checkout, but the game's directory in a deployment, because that
is where `public/` is served from.

There used to be a second file beside the first — `gamefiles-dust.json`, the same
walk filtered to keys under `gamefiles/dust/` — because one tree held both games.
Two trees need no filter, and Dust's page now downloads a 20 KB listing of its
own disc instead of a slice of a 212 KB index.

## Secrets

The account details live on the **`dreamrefactory` environment**; `FTP_HOST` is a
repository secret and falls through to it, because it is the same server for
everything.

| Secret | where | |
|---|---|---|
| `FTP_HOST` | repository | the host to connect to — a hostname, no scheme and no path |
| `FTP_USER` | environment | |
| `FTP_PASSWORD` | environment | |
| `FTP_PATH` | environment | `.` — the account lands in the site directory already |
| `FTP_PORT` | either | optional, 21 if unset |
| `FTP_INSECURE_TLS` | either | optional escape hatch, see below |
| `FTP_ALLOW_PLAINTEXT` | either | optional escape hatch, see below |

```bash
gh secret set FTP_USER --env dreamrefactory   # and FTP_PASSWORD, FTP_PATH
```

The first four are required; the run fails with a named error before it connects
if one is missing. The environment exists so that the account scoped to this
directory cannot be reached by anything else.

### The connection

Plain FTP sends the password as text on the wire, so the upload demands **TLS**:
`AUTH TLS` on the ordinary FTP port, which is explicit FTPS — what a shared host
usually means by "FTP over SSL". Passive mode, because the runner is behind NAT.
One connection rather than several, because shared FTP accounts cap concurrent
logins.

`FTP_HOST` is **`s067.cyon.net`**, not `www.danielhobi.ch`, and that is on
purpose: the FTP server's certificate is a real one but it names the provider
(`*.cyon.net`), so connecting by the domain fails verification while connecting
by the server's own name passes it.

If cyon ever moves the account to another machine the connection will fail
outright — check `dig -x` on the site's address for the new server name and
update the secret, or fall back to `www.danielhobi.ch` with `FTP_INSECURE_TLS=1`.

Two escape hatches for a host that cannot do TLS properly. Both are off by
default and both print a warning into the run when used:

| | |
|---|---|
| `FTP_INSECURE_TLS=1` | still encrypted, but the certificate is not checked. The usual shared-hosting case: the cert names the server rather than the domain |
| `FTP_ALLOW_PLAINTEXT=1` | no TLS at all. The password crosses the wire in the clear — a last resort, and worth asking the host about first |

The password never reaches a command line: the action writes the lftp script to
`$RUNNER_TEMP` at mode 600 and deletes it on exit.

## The documentation is not a release

`docs.yml` publishes `docs/` on any push that touches it. Docs are not versioned
against a game — a correction to a format page should be readable the day it is
written.

It used to be a GitHub Pages project site at `dhobi.github.io/dreamrefactory/`, which
put the one part of the project that explains the rest on a different domain from
the thing it explains, under a base path made of the repository's name. Two
things ended that at once: the site moved, and renaming the repository would have
broken that base anyway.

Unlike the three builds, the docs site cannot be path-independent: VitePress needs
an absolute `base` for its router, so `docs/.vitepress/config.ts` names
`/dreamrefactory/docs/` outright. It is the one place in the repository that knows
the deployment's URL. It sits under `docs/` rather than at the root because a
VitePress site owns its whole route namespace — and this doc set has an
`editors/` section that would land exactly on top of the editors application.

Back to [Reference](README.md).
