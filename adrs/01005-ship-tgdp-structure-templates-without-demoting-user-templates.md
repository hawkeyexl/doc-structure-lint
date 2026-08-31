---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl]
---

# Ship TGDP structure templates as built-ins, without demoting user templates

## Context and Problem Statement

ADR 01004 made a page's `type` route it to a template. That is only useful if a
template for the doctype exists, and out of the box none did. So the first task
for every adopter was to write, from nothing, an answer to "what sections should
a how-to have?" — the hardest part of adopting the tool, and the part where an
individual guess is least valuable, because the documentation community has
already answered it in public.

[The Good Docs Project](https://gitlab.com/tgdp/templates) publishes templates
for exactly these doctypes: how-to, tutorial, reference, concept,
troubleshooting, release notes, README. They are developed and reviewed in the
open, released under versioned tags, and widely used. Diataxis names the same
categories. Deriving structural templates from them turns adoption from "write a
schema for your doctypes" into "type your pages".

Shipping templates has two failure modes worth naming before choosing to do it.

The first is that a built-in which is awkward to override stops being a default
and becomes a house style imposed by a linter. Documentation teams have opinions
about their doctypes and most of those opinions are legitimate: TGDP's how-to
carries a `See also` section and does not mark it optional, so a template derived
faithfully requires one — and plenty of correct how-tos have none.

The second is that "derived from The Good Docs Project" is a *claim*. A YAML file
in `src/` with that sentence in a comment is a comment. Nothing stops it drifting
from what it says it mirrors, and nothing establishes that it was right about it
to begin with. A provenance claim nobody can check is worth roughly what a
version number nobody bumps is worth.

## Decision Drivers

- The tool should be useful against a typed docset with no template authoring at
  all.
- A template the user wrote must beat a built-in, without a config file and
  without a flag beyond naming the file.
- Disagreeing with one rule in a built-in must not require copying the whole
  thing, because a copy inherits none of the built-in's later corrections.
- The provenance claim must be executable, and the pin's staleness must be
  visible without anyone remembering to look.
- Deriving a structural template from a prose template is a judgement call per
  section. Those judgements have to be recorded where the next person looks,
  which is the template file itself.

## Considered Options

- **Derive seven, pin them, round-trip test them, and let user templates
  outrank them**
- Ship no built-ins; document how to write your own
- Vendor TGDP's Markdown and derive templates at runtime
- Ship built-ins that win, with a config key to opt out

## Decision Outcome

Chosen option: **derive seven templates, pin them at TGDP v1.6.0 ("Iron"),
round-trip test each against the published template it came from, and make user
templates outrank built-ins in the doctype index.**

**Built-ins are registered through a manifest, not hardcoded.**
`src/templates/tgdp/manifest.json` carries each entry's id, YAML file, title,
the doctypes it serves, and the upstream `source` it was derived from. The id
encodes the pin — `tgdp:how-to:1.6` — so the version in a ref is a statement
about which upstream revision it mirrors. `tgdp:concept:1.6` serves `explanation`
as well as `concept`, because Diataxis and TGDP name the same shape differently.

**The round-trip test is what makes "publicly vetted" checkable.**
`test/integration/tgdp.test.ts` lints TGDP's own `template_<slug>.md` — vendored
verbatim under `test/fixtures/tgdp/` — against the template derived from it, and
requires zero findings. Where the two disagree, **upstream is right**: the
fixture is the authority and the template is the thing under test, which is the
reverse of the usual fixture relationship and the only arrangement in which the
claim means anything. The suite is driven by the manifest, so a built-in cannot
be registered without acquiring this test, and cannot acquire it without a
vendored source.

**The pin is watched, not gated.** `npm run check:tgdp-pin` asks GitLab's release
API whether upstream has moved and prints what moving the pin would involve —
re-vendor each source, run the suite, fix wherever a built-in no longer matches,
bump the `pin` and every id. Upstream moving does not make the pinned templates
wrong, it makes them old, so it is a report; `--strict` exits non-zero for a job
whose purpose is to nag.

**User templates outrank built-ins by construction, not by policy.**
`buildTypeIndex` inserts the built-ins first and user templates second into one
map keyed by doctype, so a later entry simply overwrites an earlier one.
Overriding the how-to doctype for a repo is one file with `types: [how-to]` in
it. There is no "disable the built-ins" switch because there is nothing to
disable: claiming the doctype *is* the override, and a doctype a user file does
not claim quietly stays on its built-in.

**`extends` is the graduated form of the same thing.** `resolveExtends` merges
through `sections` by key, recursively, all the way down, while every other key
the child sets replaces the parent's outright — a section's own rules are units,
but `sections` is a container, and replacing it wholesale would mean tightening
one nested rule silently discarded every sibling the parent declared. That is
what lets `templates.yaml`'s `house-how-to` be four lines: `extends:
tgdp:how-to:1.6`, `types: [how-to]`, and `see also: {required: false}`. Overview,
Before you start, and the repeating task sections are all still checked.

**What the derived templates assert is order and membership, not volume.**
Content minimums are set only where the doctype genuinely requires prose — a
how-to `Overview` with no paragraph is not a how-to — and are absent almost
everywhere else. The reason is concrete: the parser models paragraphs, code
blocks, and lists but not tables (ADR 01001), and reference entries, README
dependency sections, and release-note categories are as often tables as lists.
A `lists: {min: 1}` there would fail pages a reader would call correct. Where
upstream ships an authoring marker in the literal heading — `## (Optional)
Commands`, `## Optional: Deprecation notice` — the pattern accepts the heading
both with the marker and without it, which is what lets upstream's own file lint
clean against the template derived from it.

### Consequences

- Good, because a typed docset is checked by `moose-lint docs/` and nothing
  else: no template to write, no flag, no config.
- Good, because the provenance claim is a test rather than a comment, and it
  fails in the right direction — if upstream's template does not pass ours,
  ours is wrong.
- Good, because the version in an id is kept honest by `check:tgdp-pin` rather
  than by anyone remembering.
- Good, because disagreement is cheap and graduated: relax one rule with
  `extends`, or claim the doctype outright with `types:`, and neither needs a
  config file.
- Bad, because deriving a structural template from a prose one is a judgement
  call per section and some of ours are arguable. Every one is argued in a
  `description:` in the YAML, which is mitigation, not a defence.
- Bad, because the built-ins model upstream's H1 as their top-level rule, so a
  docset whose page titles live in frontmatter and whose bodies start at `##`
  matches none of them — and fails with a cascade of missing and unexpected
  sections rather than one legible finding. Sites are commonly built this way.
  The escape (`extends` and replace the top-level rule) is not discoverable.

  *Resolved by [ADR 01006](01006-take-the-h1-from-frontmatter-when-the-body-has-none.md),
  which was taken after this one.* A first-class affordance was deferred here
  for want of somewhere honest to put it in the DSL; 01006's answer was that it
  does not belong in the DSL at all, but in the parsers, which prepend a
  synthetic H1 positioned on the metadata that carries the title. The built-ins
  are unchanged — they still model the H1 as their top-level rule — and now
  match these pages because the tree they are matched against is the document as
  a reader sees it rendered.
- Bad, because seven derived artifacts are seven files to re-derive whenever the
  pin moves, and the round-trip test says *that* one broke, not what to change
  in it.
- Neutral, because troubleshooting's causes and solutions are matched by a single
  repeating rule accepting either word. Upstream alternates them and the DSL
  cannot repeat a *pair* of rules, so a page that grouped all its causes before
  all its solutions also passes. It is the only place a built-in is structurally
  looser than the doctype it mirrors, and it is recorded in the template.

### Confirmation

`test/integration/tgdp.test.ts` is manifest-driven and pins four things: every
manifest entry is registered, every entry serves at least one doctype, no two
built-ins claim the same doctype, and every entry lints its vendored upstream
source with zero findings.

`test/integration/routing.test.ts` pins the precedence that keeps user templates
first-class: a template declaring `types: [how-to]` beats `tgdp:how-to:1.6` with
no config and no flag beyond `--templates`, and a doctype it does not declare
stays on the built-in.

`test/integration/repo-templates.test.ts` pins this repository's own
`templates.yaml`: that `api-operation-guide` and `house-how-to` declare the
doctypes they claim, and that `house-how-to` relaxes `see also` while inheriting
the rest of `tgdp:how-to:1.6`.

`npm run check:tgdp-pin` reports `pinned: v1.6.0`, `latest: v1.6.0`,
`derived: 7 built-in template(s)`.

## Pros and Cons of the Options

### Derive seven, pin, round-trip test, user templates outrank

- Good, because the default is immediately useful and the override is one file.
- Good, because the claim about where the templates came from is executable.
- Bad, because we now maintain seven derived artifacts against an upstream we do
  not control and cannot pin forever.

### Ship no built-ins; document how to write your own

- Good, because there is nothing to maintain and no opinion imposed on anyone.
- Bad, because routing by `type` is then inert until the adopter writes a
  template per doctype — the hardest part of adoption, and the part a published,
  reviewed answer already exists for.
- Bad, because everyone's first how-to template would be a private guess at a
  public question, and none of them would be checkable against anything.

### Vendor TGDP's Markdown and derive templates at runtime

- Good, because there is one artifact and it cannot drift from upstream.
- Bad, because "this section is optional" is stated in upstream's prose as
  `{This section is optional}` and in its heading text as `(Optional)`, and
  turning that into a rule is inference. A linter whose rules are inferred from
  prose at run time is not one anybody can predict.
- Bad, because every judgement now written into a `description:` would become a
  heuristic, and a wrong heuristic cannot be fixed for one doctype without
  changing the derivation for all seven.

### Ship built-ins that win, with a config key to opt out

- Good, because it makes the vetted templates the default in a stronger sense.
- Bad, because "the linter has an opinion you must configure your way out of" is
  how a tool becomes something teams route around rather than adopt.
- Bad, because it makes a config file necessary for the commonest customization
  there is, when the point of `types:` is that overriding takes none.
