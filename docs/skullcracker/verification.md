# How it is checked

Every suite in `skullcracker/tests/browser` over sixteen levels, and the reason
they run in one process. Titanic keeps the same page under the same name
([How we know it's right](../taoot/verification.md)) and for the same reason:
"how was this checked?" is a headline question for a project like this, not
lookup material.

## One browser, not thirty

Every suite in `tests/browser` used to be its own `tsx` process with its own
`chromium.launch()`, and that cost twice.

The visible cost was time: each process imports Playwright from scratch, about a
second apiece, thirty seconds across the set before a single assertion runs.

The cost that mattered was correctness. This machine has around a gigabyte free,
with several gigabytes held by things that are not this repo, and a Chromium per
suite is more than that will take. Suites run back to back failed in ways they
never failed alone, and in one afternoon they did it four different ways:

```
  woods      a dog pays 0x40d450(0xc8); the score reads 0
  service    no position in the HUD
  arcade     TypeError: Cannot read properties of null (reading 'y')
  guns       0x451520 gives 40 and 0x45eed0 one more: · no flamer 0/160
```

Every one of those passed on a re-run and every one cost a re-run to tell apart
from a real regression — which is the actual expense, because the whole point of
the suites is to say whether a change broke something.

The full set now runs in **993 seconds, one process, one Chromium** — 630MB
across its helper processes, flat from the first suite to the thirty-first,
against a machine with about a gigabyte free. It is not a cure for flakiness:
that first full run still had `codes` and `service` fail and pass again on their
own, and some of these suites drive the game with fixed waits and will do that
whatever the browser does. What it removes is the class of failure that came
from the machine rather than the page.

So a suite no longer owns a browser. It asks `harness.ts` for one, and gets the
shared Chromium under the runner or a fresh one on its own, and gives back its
contexts rather than closing anything. The only other change a suite needed is
that its top level now awaits its own work — importing a suite IS running it —
and that `fail()` throws rather than exiting, because one `process.exit` would
take the other twenty-nine with it.

### A failure is not taken at its word

What the pooled runner did not remove was the re-run. About one run in three, one
or two suites failed — `codes`, `lift`, `mall`, `vat`,
`woods`, `grave`, `service`, `ravecave`, `mission`, `foes`, never the same pair
twice — and every one of them passed standalone on the first ask. So a red run
said nothing. It meant "go and run that suite again by hand", and until that was
done a real regression and a flake looked identical.

The runner now does that re-run itself, and undoes first the two things that make
a pooled failure different from a standalone one.

The first is a leak, and it is the interesting one. `fail()` throws, so a suite
that FAILS never reaches its own `finish()` — and `finish()` is what closes its
context. The page, its canvas, its audio graph and its copy of the rip stayed
open on the shared browser for every suite that ran after it. That is the
mechanism behind the thing the section above describes as an afternoon's four
symptoms: on a machine with a gigabyte free, one failure leaves a corpse and the
next suites run beside it. `harness.sweep()` now closes whatever is left after
every suite, pass or fail, and prints the count when there is one.

The second is the browser. A retry closes the shared Chromium and launches a
fresh one, because that is the whole of what "standalone" means here.

Passing the second time prints `FLAKE` and does not fail the run; failing twice
is a `FAIL` and does. The last line names both sets, so what the run is worth is
readable without running anything again.

The re-import needs a cache-buster — `import()` twice in one process hands back
the first import's result, so the retry asks for `suite.ts?attempt=1`. The
suite's own `import "./harness"` carries no query and so still resolves to the
one harness module, which is what keeps the browser shared and leaves `sweep()`
able to see the contexts.

Both paths were tested against a suite written to fail on demand rather than
waiting for a real flake: fail-then-pass reports `FLAKE` and exits 0, fail-twice
reports `FAIL` and exits 1.

Two suites turned out not to be failing at all. `menu` had no
`test:browser:menu` script — its script is the bare `test:browser` — so every
attempt to run it by name had been running nothing and reporting a failure.
And `speed` asserted the strides, 120px/s and 225, when the drag it documents
elsewhere settles the walk at 12 a frame and the run at 22: 180 and 330. Both
were reported red for weeks by a list that could not tell a missing script from
a broken one.
