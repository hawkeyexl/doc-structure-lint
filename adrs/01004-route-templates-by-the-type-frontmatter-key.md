---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl]
---

# Route templates by a page's `type` frontmatter key

## Context and Problem Statement

`--template` applied one template to every file in the run. That is the wrong
unit. A `docs/` tree is a mix of how-tos, references, concepts, and tutorials,
and one template cannot describe all of them — so checking a docset meant one
invocation per doctype, each with a glob naming where that doctype lives:

```yaml
- run: moose-lint "docs/how-to/**" -t t.yaml#how-to
- run: moose-lint "docs/reference/**" -t t.yaml#reference
- run: moose-lint "docs/concepts/**" -t t.yaml#concept
```

That is a second classification of the docset, maintained by hand, in a file
nobody opens when they add a page. It drifts, and it drifts in the worst
direction: a how-to written into `docs/concepts/` is checked against the concept
template and reported as broken, and a page written into a directory no glob
covers is checked by nothing at all and reported as nothing at all. The run is
green either way.

Meanwhile the classification already exists. A typed page says what it is in its
own frontmatter — `type: how-to` — and it is the same key `moose-meta`'s OKF
schema requires, that Diataxis names, that TGDP's frontmatter carries, and that
`moose-kg` reads to build its graph. It is written by the person writing the
page, in the page, and it is already validated by a sibling tool. Nothing was
using it.

## Decision Drivers

- The doctype of a page is a property of the page, not of the command line.
- One invocation should check a whole tree, and adding a page should require no
  change to CI.
- There must still be a way to say "not this page" and "not this repo" — a
  routing scheme with no escape hatch gets abandoned at the first exception.
- "Why was this page linted with *that*?" must be answerable without reading the
  source, because a wrong answer is invisible: the page still passes.
- A page that silently stops being checked is worse than a page that fails.
- `moose-docevals` invokes this tool as `--templates t.yaml --template how-to`;
  that has to keep working.
- `docmeta` already resolves schemas through a precedence chain. A second chain
  in a sibling repository, ordered differently, is a cost with no return.

## Considered Options

- **A precedence chain ending in the page's `type`**
- `type` and nothing else
- Route by file path convention
- Keep `--template`, one invocation per doctype

## Decision Outcome

Chosen option: **a precedence chain ending in the page's `type`**, in
`src/core/resolve-template.ts`, ordered as `docmeta`'s `resolveSchemaSet` orders
its own: an explicit instruction beats a per-page declaration, which beats repo
policy, which beats the page's own vocabulary, which beats a blanket default.

| | stage | what it means |
| --- | --- | --- |
| 1 | `--template` | an operator overriding everything, for one run |
| 2 | `$template` in frontmatter | this page, specifically, is an exception |
| 3 | a config `overrides` glob | repo policy: everything under `docs/api` is a reference |
| 4 | `type` in frontmatter | what the page says it is |
| 5 | a config default | what to assume when a page says nothing |

`$template` sits **above** the override glob deliberately. A page that names its
own template did so on purpose, one page at a time; a glob included it by
accident of where it happens to live. The more specific statement wins, and the
more specific statement is the one somebody had to write by hand.

Stages 3 and 5 are read but nothing writes them yet — `moose.config.yaml` is a
later change. They are in the chain now rather than later because retrofitting a
stage into a precedence order changes the meaning of every configuration already
written against it, and the ordering argument is much easier to make before
anyone depends on the answer.

Every stage appends a `ResolutionStep` whether or not it fired, including the
ones with nothing to say, and `--explain` prints the whole record and lints
nothing. Printing the silent stages is the point: a surprising route is almost
always a stage the reader forgot applies — a stray `$template`, a glob matching
more than intended — and a report showing only the winner would hide exactly
what is being looked for. `--explain` exits `0` however the docs look, because it
answers a question about configuration and not about the documents.

**A missing `type` and an unknown one are treated differently, on purpose.**

A page with no `type` that reaches the end of the chain is **skipped**: counted
apart from passes and failures, not failing the run, not stopping its
neighbours. An untyped page is `moose-meta`'s complaint — its OKF schema already
requires `type` — and duplicating that check here would mean adopting this tool
requires typing every page first. Skipping is what lets a repo that has typed
three pages out of two hundred point `moose-lint` at the whole tree today and
get three pages checked.

A page whose `type` resolves to **no template** is an **error**: exit `1`, with
near misses named from a bounded edit-distance pass over the known doctypes
(`how-two` suggests `how-to`). That page's author believes it is being checked.
Skipping it would mean a rule they wrote is not enforced and nobody ever finds
out — the same failure mode ADR 01003 rejected for `instructions:`, and the one
outcome worse than a false positive.

### Consequences

- Good, because a docset is checked by `moose-lint docs/`, and adding a page
  changes no configuration anywhere.
- Good, because the classification lives next to the content it classifies and
  is maintained by whoever changes the content.
- Good, because it composes with the family rather than duplicating it: the key
  is the one `moose-meta` validates and `moose-kg` reads, so a repo that has
  adopted either gets routing for free.
- Good, because `--explain` makes the decision auditable, which matters more
  here than for most flags — routing to the wrong template usually produces a
  clean run, not a wrong one.
- Bad, because a repo that does not type its pages gets nothing from this and
  sees a wall of skips. The fix is `moose-meta`, not this tool, but it does mean
  the headline feature is inert on an untyped docset.
- Bad, because a run in which *every* page was skipped exits `0` and reports
  "0 files checked". That is the honest summary of what happened, but it reads
  like a clean bill of health, and an `--exclude` typo and a docset with no
  frontmatter look identical in CI.
- Bad, because five stages is more than anyone wants to hold in their head, and
  two of them currently do nothing. `--explain` exists partly to pay that back.
- Neutral, because `--template` is unchanged and still wins outright, so every
  existing invocation — including `moose-docevals`' adapter — keeps working with
  no edit. It stops being *required*, which is the whole change.

### Confirmation

`test/unit/resolve-template.test.ts` pins the chain in isolation: each stage's
precedence over the ones below it, the first-match-wins rule for override globs,
glob matching against a Windows path, non-string `type`/`$template` values being
ignored, the two causes and their near-miss suggestions, and the resolution
record — every consulted stage, in order, stopping at the one that decided.

`test/integration/routing.test.ts` pins what the chain is *for*, against real
files: a directory of mixed doctypes with each page checked against the template
for what it claims to be, a how-to missing its `Overview` reported as one
finding rather than the cascade a blanket template would produce, an untyped
page skipped without failing the run or stopping its typed neighbours, a typo'd
type failing with the suggestion, `--template` and `$template` overriding a
page's own type, and `--explain` recording the chain without linting.

## Pros and Cons of the Options

### A precedence chain ending in the page's `type`

- Good, because the common case needs no configuration at all, and every escape
  hatch above it is written in the place the exception actually lives.
- Good, because it is the shape `docmeta` already uses, so someone who knows one
  tool's resolution order knows the other's.
- Bad, because a surprising result needs `--explain` to unpick, which is a
  second command to learn about a decision the user did not know was being made.

### `type` and nothing else

- Good, because there is exactly one answer to "which template?", and nothing to
  explain.
- Bad, because there is then no way to check one page against a different
  template without editing the page, and no way to run the tool at all against a
  docset that is not yet typed.
- Bad, because it removes `--template`, which `moose-docevals` invokes.

### Route by file path convention

- Good, because it needs no frontmatter, so it works on any docset today.
- Bad, because it invents a second classification — the directory layout — that
  has to agree with the `type` the page already declares, and nothing checks
  that they agree. This is the problem the per-doctype globs already had.
- Bad, because moving a file would change what it is checked against. Nobody
  would choose that as a property of their documentation.

### Keep `--template`, one invocation per doctype

- Good, because it costs nothing to decide, and it is what exists.
- Bad, because every objection in the problem statement stands, and the failure
  mode is silence: a page no glob covers is never checked, and the run is green.
