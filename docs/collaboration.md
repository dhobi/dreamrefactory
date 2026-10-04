# Collaboration

dreamREfactory is made by a human and a machine together. It is a common
playground — old games taken apart to see how they tick — and this page is about
how the two of them play in it: who brings what, the habits they have picked up,
and how either of them shows the other that something is right.

It is not a contract and not a harness: the habits below were written down after
the work, each where it went wrong without one, and they change when it teaches
something new.

## Two things everything else protects

**The human holds the intent.** The machine can produce more code, analysis and
options in an hour than anyone can read. That is only worth something when
someone with taste and a reason to care chooses the direction and recognises
when it has been reached. Hand the judgement over with the labour, and the work
fills up with plausible output nobody chose.

**The human keeps understanding the work.** If the human can no longer follow
it, the human can no longer steer it, and the first thing falls with the second.
The human reviews the structure — which code goes where, what each part does
and why, whether a change fits — and tries the result on the page. The details
inside a function are where review is thinnest: nobody reads a cleanup of a
thousand code smells line by line. That makes the explanations load-bearing. The
docs are written for a curious programmer rather than for the machine, a pull
request says why and not only what, and "how do you know?" is always a fair
question. This is the weaker of the two, and the one that needs watching.

Every habit below exists to keep these two true.

## Who brings what

**The human steers.** What is in scope, what "right" means for a game, which
SonarQube rules are on, when something is good enough to merge, and when a
release goes out. The human also does what only a person at a real screen can:
plays the port with the original game running next to it, and says when the two
differ.

**The machine digs.** Disassembling the executables, porting what they do,
writing the machine suites that play each game through, keeping the docs in step
with the code, and the long mechanical work — a thousand code smells, a format
decoded field by field — that would otherwise never get done. The machine
proposes; the proposal says what it rests on and what it would cost.

**Players join in.** The **Report bug** button on every game page
(`site/src/bug-report.ts`) opens a GitHub issue that already says where the
player was standing, what the engine had just logged, and has a screenshot to
paste. Most issues start there. Contributors send pull requests too. One from
a fork runs only the suites that need no game files, and no SonarQube scan:
neither the game files nor the scan's token are given to a fork's code.

The split shows in the history, partly: commits the machine co-wrote carry a
`Co-Authored-By` trailer, but some squash merges dropped it, so `git log`
undercounts the shared work rather than overcounting it.

## Habits, and where each came from

**The original is the truth.** Behaviour is settled by the game's own files and
executables, not by the port's comments, not by its docs, and not by memory.
A Skull Cracker fix cites the `SC.EXE` addresses it rests on; a Lunicus or Jump
Raven port is read out of `LUNICUS.EXE` or `RAVEN.EXE`; an adventure's command
is recovered from `TI.EXE` or `DF.EXE`. A claim that cannot be traced to one is
reported as open, not guessed. *Why:* the port's own docs were wrong more than
once where the executable was not — the machine twice answered that Skull
Cracker's INV button only holsters a weapon, repeating a doc; the disassembly
showed it is a toggle.

**A negative result needs a tool that can find a positive one.** "Nothing
references this address" is only a finding if the search has been shown to find
an address that *is* referenced. *Why:* a disassembly sweep that decoded in
fixed windows reported four reference sites where a byte search found
twenty-two. The ways the Skull Cracker work was wrong are kept as a list,
because each is a way to be wrong again.

**Prove it where the fault is visible.** A mesh fault is settled in Blender
before the room is touched; a timing rule is asserted by stepping the state
machine in node, not by watching a headless browser for twenty minutes. *Why:*
the room's shader hides an open mesh as a lighting problem, and an armchair was
chased as one twice; a live loop that waits for a bishop to attack is slow and
flaky where the machine itself is neither.

**The human sees it before the pull request exists.** The machine implements and
runs the suites, then stops and says what changed and what to look at on the
page. The pull request comes after. *Why:* a Dust fix was merged that passed
every suite and did not change what the human saw on the dev server. Some bugs
exist only in a real browser.

**Partial work leaves the issue open.** When a pull request does one of the
things an issue asks, the issue gets a comment saying what landed, and stays
open. Like anything posted where others read it, the comment is the human's to
send. *Why:* an issue is a conversation with whoever reported it, and closing it
on the first ask reads as though the others were dismissed.

**No hidden suppressions.** No `NOSONAR` in the code and no risk accepted by
hand in the SonarQube interface. A finding is fixed, or its rule is switched off
in `sonar-project.properties` with the reason written next to it, where review
can see it and argue with it — for some rules that means the whole project, and
the file says so ([Continuous integration](reference/ci.md#sonarqube-cloud)).
*Why:* a suppression nobody can read is a decision nobody made.

**No counts that have to be kept up by hand.** The docs do not say how many
tests or files there are; the runner prints that in a second. Measurements —
a frame rate, a load time, a byte offset — are the exception. *Why:* every
count that was ever written down here was stale within a few releases.

**One path, exercised hard.** Speedrun checkpoints load through the games' own
save and load rather than a snapshot of the engine. "The original game could not
save here" is not a reason to scope a bug out. *Why:* reaching states a player
never could is what finds the real defects in save and load.

**The machine asks before it spends.** It asks before starting four or more
agents at once, and before chasing an open point nobody asked about. *Why:* the
work is paid for in a usage budget that is the human's, not the machine's.

**Ask the machine for its view, and for the case against.** The human asks for a
recommendation rather than a list of options, and for the machine to say
plainly when it thinks the human is wrong, or, when it does not know, which
check would settle it. *Why:* left to itself a language model leans toward
agreeing with whoever it is talking to, and an agreeable answer is the hardest
kind to catch. The INV answer above is that default at work. It has to be asked
for, and asked again.

**What can be undone, the machine just does. What cannot, it asks first.**
Edits, branches, local runs and experiments need no permission; a merge, a
release, a deletion, or anything posted where other people read it, does. *Why:*
speed where a mistake is cheap, and a person in the loop where it is not. Master
is protected so that even a slip goes through a pull request.

**Argue the other side, from a fresh start.** Either of them can ask for the
strongest case against a proposal. It works best in a new session that sees only
the proposal and none of the conversation behind it. *Why:* within one
conversation the machine leans toward what it already said. People rarely argue
against their own proposals; a machine can, if it is not defending a history.
This page was argued against that way before it was merged, and the objections
changed it.

## How a change gets proved

Each claim has a kind of evidence, and a pull request names the one it uses:

- **The executable** — a disassembly address, for what the original does.
- **The game played** — the machine suites play every game from start to end,
  headless, and compare what the engine does against the route
  ([How we know it's right](taoot/verification.md)).
- **The browser** — Playwright suites against a live dev server, for what only
  a page can show.
- **A person at the screen** — the human, before the pull request, and players
  after the release.
- **SonarQube Cloud** — a quality gate on master and on pull requests from this
  repository; advisory, not a required check.

The machine wrote much of the code *and* much of what checks it: the suites, the
routes, the probes. A misreading shared by both passes both. So the evidence
that counts most is the evidence the machine did not write — the original
executable, the human playing next to the original game, and players' reports.

## When the machine is wrong

It is, and the habits above are mostly the record of it. What makes the
collaboration work is not that the machine is right but that its mistakes are
cheap to catch: every claim names its evidence, the suites run on every change,
and nothing reaches master that the human has not reviewed and tried.

An example from the SonarQube cleanup: the machine replaced promise chains with
top-level `await`, which SonarQube prefers, and in four games' boot modules that
was wrong. Their boot finishes only after the player's first click or the
opening film, and the page suites and the pages' second scripts import those
modules first, so an `await` there holds all of them until the game has started.
The suites caught it. The change was taken back in those files and the rule
switched off there, with the reason in `sonar-project.properties`.

## How the habits change

By conversation. When the human corrects something, or confirms an approach that
was not obvious, the machine writes it down with its reason in notes it reads at
the start of every session. Those notes are private to the human's machine, not
part of the repository, so a reader cannot check them; the habits that hold for
the whole project are copied here, where anyone can.