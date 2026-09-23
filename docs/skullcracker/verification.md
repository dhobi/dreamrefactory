# How it is checked

Every suite in `skullcracker/tests/browser` over sixteen levels, and the reason
they run in one process. Titanic keeps the same page under the same name
([How we know it's right](../taoot/verification.md)) and for the same reason:
"how was this checked?" is a headline question for a project like this, not
lookup material.

## One browser, not thirty

The suites in `tests/browser` run in one process against one shared Chromium,
not as a `tsx` process each with its own `chromium.launch()`. A process per suite
costs twice.

The visible cost is time: each process imports Playwright from scratch, about a
second apiece, thirty seconds across the set before a single assertion runs.

The cost that matters is correctness. The development machine has around a
gigabyte free, with several gigabytes held by things that are not this repo, and
a Chromium per suite is more than that will take. Suites run back to back fail in
ways they never fail alone, for example:

```
  woods      a dog pays 0x40d450(0xc8); the score reads 0
  service    no position in the HUD
  arcade     TypeError: Cannot read properties of null (reading 'y')
  guns       0x451520 gives 40 and 0x45eed0 one more: · no flamer 0/160
```

Each of those passes on a re-run, and each needs a re-run to tell it apart from a
real regression — which defeats the point of the suites.

The full set runs in **993 seconds, one process, one Chromium** — 630MB across
its helper processes, flat from the first suite to the last, against a
machine with about a gigabyte free. It is not a cure for flakiness: some suites
drive the game with fixed waits and can fail on their own whatever the browser
does (`codes` and `service` did, and passed again). What it removes is the class
of failure that comes from the machine rather than the page.

A suite does not own a browser. It asks `harness.ts` for one, gets the shared
Chromium under the runner or a fresh one on its own, and gives back its contexts
rather than closing anything. A suite's top level awaits its own work —
importing a suite IS running it — and `fail()` throws rather than exiting,
because one `process.exit` would take every other suite with it.

### A failure is not taken at its word

Under the pooled runner, about one run in three still has one or two suites fail
— `codes`, `lift`, `mall`, `vat`, `woods`, `grave`, `service`, `ravecave`,
`mission`, `foes`, never the same pair twice — and each passes standalone on the
first ask. A red run alone therefore cannot tell a real regression from a flake.

The runner re-runs a failed suite itself, and first undoes the two things that
make a pooled failure different from a standalone one.

The first is a leak. `fail()` throws, so a suite that FAILS never reaches its own
`finish()` — and `finish()` is what closes its context. Without cleanup, the
page, its canvas, its audio graph and its copy of the rip stay open on the shared
browser for every suite that runs after it; on a machine with a gigabyte free,
one failure leaves a corpse and the next suites run beside it. This is the
mechanism behind the symptoms listed above. `harness.sweep()` closes whatever is
left after every suite, pass or fail, and prints the count when there is one.

The second is the browser. A retry closes the shared Chromium and launches a
fresh one, because that is all "standalone" means here.

Passing the second time prints `FLAKE` and does not fail the run; failing twice
is a `FAIL` and does. The last line names both sets, so what the run is worth is
readable without running anything again.

The re-import needs a cache-buster — `import()` twice in one process hands back
the first import's result, so the retry asks for `suite.ts?attempt=1`. The
suite's own `import "./harness"` carries no query and so still resolves to the
one harness module, which is what keeps the browser shared and leaves `sweep()`
able to see the contexts.

Both paths are tested against a suite written to fail on demand: fail-then-pass
reports `FLAKE` and exits 0, fail-twice reports `FAIL` and exits 1.

`menu` has no `test:browser:menu` script — its script is the bare
`test:browser` — so running it by that name runs nothing and reports a failure.
`speed` asserts the strides the drag settles at: 12 a frame for the walk and 22
for the run, 180 and 330 px/s.
