# Releasing and deploying

*Prerequisite: [Continuous integration](ci.md) — which suites run where.*

The site is published to <https://www.danielhobi.ch/taoot/> by
[`deploy.yml`](https://github.com/dhobi/taoot-web/blob/master/.github/workflows/deploy.yml),
and **a release is a tag**. Nothing deploys from an ordinary push to master.

```bash
npm version 0.9.1        # bumps package.json and commits it
git push && git push --tags
```

`npm version` writes the tag as `v0.9.1`, which is what the workflow listens
for. It can also be run from the Actions tab (`workflow_dispatch`) to re-publish
the current master without cutting a version.

## Where the version comes from

One number, in `package.json`, and three places it surfaces:

| | |
|---|---|
| `package.json` | the source of truth — semver, `0.9.0` at the first release |
| `vite.config.ts` | substitutes it for `__APP_VERSION__` at build time |
| [`src/version.ts`](https://github.com/dhobi/taoot-web/blob/master/src/version.ts) | exports `VERSION`, and draws it in the top bar beside the wordmark |
| [`src/bug-report.ts`](https://github.com/dhobi/taoot-web/blob/master/src/bug-report.ts) | puts it in the issue body, so a report names the build it came from |

Node does no substitution, so a test or a tool that imports `version.ts` reads
`0.0.0-dev` rather than throwing.

The deploy fails if the tag and `package.json` disagree — the pages read the
version from `package.json`, and a site announcing a version nobody tagged is
worse than a failed deploy.

## What a deploy never touches

The host serves `dist/` out of the same directory as four things that are not
in it and never in this repository:

| | | |
|---|---|---|
| `gamefiles/` | the CD rip | ~7 GB, [gitignored forever](ci.md) |
| `*.zip` | the offline DBGL archives the collection page links to | ~1 GB apiece |
| `nightdive.mov` | the intro movie | gitignored, so a CI checkout does not have it |
| `gamefiles.json` | the listing of the rip | see below |

So the mirror only **adds and overwrites**. There is no `--delete` and no option
to turn one on: re-uploading a wrong file costs a minute, and a deleted 7 GB rip
does not. Vite's asset filenames are content-hashed, so a superseded bundle is
dead weight rather than a stale page — sweep `assets/` by hand if it ever
matters. The three files that could in principle be *written* over are excluded
from the transfer as well.

### Why the manifest is not uploaded

`gamefiles.json` is the listing every page reads to find out what game data
exists ([the manifest](tools.md)). A build writes it by walking `gamefiles/` —
and a GitHub runner has no rip, so the file it produces holds **one entry**
(`lang.stg`) against the **4,137** the host serves. Uploading it would leave the
play page offering nothing at all, so the workflow deletes it before the
transfer and the host's copy stays put.

That copy has to be regenerated whenever the *game data* on the host changes, or
when this repository adds an authored DF file to `public/`. Do it where the tree
is, not where the build was:

```bash
npx tsx tools/mkmanifest.ts . ./gamefiles .
```

The third argument is where the authored files (`lang.stg`, `nightdive.mov`)
are: `public/` in a checkout, but the deployment root in a deployment, because
that is where `public/` is served from.

## Secrets

Set as repository secrets, or on the `production` environment:

| Secret | |
|---|---|
| `FTP_HOST` | the host to connect to — a hostname, no scheme and no path |
| `FTP_USER` | |
| `FTP_PASSWORD` | |
| `FTP_PATH` | the remote directory the site is served from |
| `FTP_PORT` | optional, 21 if unset |
| `FTP_INSECURE_TLS` | optional escape hatch, see below |
| `FTP_ALLOW_PLAINTEXT` | optional escape hatch, see below |

```bash
gh secret set FTP_HOST      # and FTP_USER, FTP_PASSWORD, FTP_PATH
```

The first four are required; the run fails with a named error before it
connects if one is missing.

### The connection

Plain FTP sends the password as text on the wire, so the upload demands **TLS**:
`AUTH TLS` on the ordinary FTP port, which is explicit FTPS — what a shared host
usually means by "FTP over SSL". Passive mode, because the runner is behind NAT.
One connection rather than several, because shared FTP accounts cap concurrent
logins and 115 files is not worth the risk.

`FTP_HOST` is **`s067.cyon.net`**, not `www.danielhobi.ch`, and that is on
purpose: the FTP server's certificate is a real one but it names the provider
(`*.cyon.net`), so connecting by the domain fails verification while connecting
by the server's own name passes it. The login lands directly in the deployed
directory, which is why `FTP_PATH` is `.`.

If cyon ever moves the account to another machine the connection will fail
outright — check `dig -x` on the site's address for the new server name and
update the secret, or fall back to `www.danielhobi.ch` with `FTP_INSECURE_TLS=1`.

Two escape hatches for a host that cannot do TLS properly. Both are off by
default and both print a warning into the run when used:

| | |
|---|---|
| `FTP_INSECURE_TLS=1` | still encrypted, but the certificate is not checked. The usual shared-hosting case: the cert names the server rather than the domain |
| `FTP_ALLOW_PLAINTEXT=1` | no TLS at all. The password crosses the wire in the clear — a last resort, and worth asking the host about first |

The password never reaches a command line: the workflow writes the lftp script
to `$RUNNER_TEMP` at mode 600 and deletes it on exit.

Back to [Reference](README.md).
