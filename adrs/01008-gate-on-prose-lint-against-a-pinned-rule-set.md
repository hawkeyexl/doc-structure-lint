---
status: "accepted"
date: 2026-09-04
decision-makers: [hawkeyexl]
---

# Gate on prose lint, against a pinned rule set

## Context and Problem Statement

[ADR 01003](01003-remove-the-language-model-and-be-deterministic.md) drew the
family boundary: this tool checks structure and `moose-docevals` judges prose.
That boundary is about what the tool reports on a user's documents. It says
nothing about the repo's own writing, which had no check at all.

Adopting the Moose Vale package left 270 alerts across 13 files and a check that
annotated added lines without failing. An advisory check is a check nobody acts
on. It also cannot hold a corpus at zero, because nothing stops the next pull
request from adding the 271st alert.

Making it fail is not one decision but four. Three of them are easy to get
wrong, in ways that leave a check looking like protection while it enforces
less than it claims.

## Decision Drivers

- A gate must enforce what its own documentation says it enforces.
- A gate must never pass by looking at nothing.
- An external rule set must not be able to redden every open pull request on a
  day nobody chose.
- Vendored fixtures must stay byte-for-byte upstream's, whatever the voice says
  about them.

## Considered Options

- **Gate on every alert, against a pinned package, exempting test input**
- Keep the check advisory and work the corpus down by habit
- Gate only on the lines a pull request adds
- Tune or scope the shared Moose rules instead of rewriting the corpus

## Decision Outcome

The chosen option is to **gate on every alert, against a pinned package**.

**`fail_level: any`, not `fail_on_error: true`.** The action maps
`fail_on_error` to reviewdog's `-fail-level=error`, which passes the one
warning-level rule the package ships, `Voices.ColonReveal`. A gate that skips a
rule its own comment claims to enforce is worse than no gate, because it is
believed. `fail_level` takes precedence over `fail_on_error`.

**`filter_mode: nofilter`, not `added`.** Whole-corpus checking catches a change
that breaks the voice in a file it did not touch. An edit to `.vale.ini` or a
moved pin does exactly that. A run costs well under a second, so the whole
corpus is affordable on every pull request.

**The package is pinned to a release tag.** Every other external authority here
is pinned: TGDP at v1.6.0 with `npm run check:tgdp-pin` watching it, the Vale
binary at 3.20.0, `actions/checkout` at v7. Under an advisory check a floating
`releases/latest` was absorbed silently. Under a gate it hands a third party the
power to block merges. It also destroys reproducibility, because re-running
yesterday's green commit re-fetches today's rules.

**A canary step asserts the rule set is loaded.** Every `BasedOnStyles` lives
inside the fetched package, so Vale with an empty `StylesPath` lints zero files
and exits `0`. Only the action's throw on a failed `vale sync` stands between a
bad fetch and a green run over nothing. That is the failure mode
[README](../README.md) says the linter itself exits `2` to prevent, so the
workflow checks `vale ls-config` rather than trusting it.

**Test input is exempted in `.vale.ini`, not in the workflow.** Config is the one
place both a local `vale .` and CI read, so the two cannot disagree about which
files are in scope. The globs name the directory (`**/fixtures/**`) rather than
a path, because Vale matches them against the path as invoked.

The 265 alerts in this repo's own prose were resolved by rewriting it, not by
loosening the rules. The rules are the house voice, shared across the family.
Bending them here to fit existing writing would make every sibling repo inherit
this repo's convenience.

### Consequences

- Good, because the gate now enforces what its documentation says, at every
  severity and over every file.
- Good, because moving the pin is a commit with a diff and a review, rather than
  a surprise on an unrelated pull request.
- Good, because the canary makes a fetch regression loud instead of green.
- Bad, because a pinned package goes stale, and nothing yet watches it the way
  `check:tgdp-pin` watches TGDP. Moving it by hand is the cost until something
  does.
- Bad, because MADR's `Chosen option:` lead-in trips `Voices.ColonReveal`, so
  all seven earlier records were reworded to "The chosen option is". A carve-out
  would have hidden genuine colon-reveals in the same files.
- Neutral, because `reporter: github-pr-review` cannot attach comments outside
  the diff. reviewdog falls back to Check annotations there, so nothing is lost,
  but out-of-diff findings arrive as annotations rather than review comments.

### Confirmation

`.github/workflows/vale.yml` carries the gate, and reversing any part of it
fails visibly:

- Drop `fail_level: any` back to `fail_on_error: true` and a `Voices.ColonReveal`
  alert stops failing the check.
- Drop `filter_mode: nofilter` back to `added` and an alert in an untouched file
  stops failing the check.
- Float the pin back to `releases/latest` and the corpus is no longer checked
  against a known rule set.
- Break the package fetch and the canary step fails rather than the job passing
  over zero rules.

`vale .` from the repository root reports zero alerts. It reports the same zero
from an absolute path and from inside `test/`, which is what the `**/` glob
prefixes buy.

## Pros and Cons of the Options

### Keep the check advisory and work the corpus down by habit

- Good, because no upstream release can ever block a merge.
- Good, because it needs no decision about severity, pinning, or scope.
- Bad, because the corpus drifts back the first time somebody is in a hurry, and
  270 alerts is the evidence that it does.

### Gate only on the lines a pull request adds

- Good, because a contributor is only ever asked about prose they wrote.
- Good, because reviewdog can always annotate those lines inline.
- Bad, because an edit to `.vale.ini` or a moved pin breaks files nobody
  touched, and the check stays green.

### Tune or scope the shared Moose rules instead of rewriting the corpus

- Good, because 126 em-dash alerts are real evidence about a rule. The rule's
  own header documents an escape hatch for exactly that argument.
- Good, because it would have kept MADR's `Chosen option:` label intact.
- Bad, because the rules are shared across the family, so tuning them to fit one
  repo's existing prose exports that convenience to every sibling. If a rule is
  wrong it should be argued upstream in `moose-vale`, on its merits, not bent
  here under deadline.
