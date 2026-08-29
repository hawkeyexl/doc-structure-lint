---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl]
---

# Match sections to template rules in one ordered pass, not by array index

## Context and Problem Statement

`doc-structure-lint` decided which template rule described which document section
by **array position**. `structureValidator.validateStructure` walked
`Object.keys(template.sections)` and read `structure.sections[i]`;
`subsectionValidator.validateRequiredSubsections` did the same one level down.

Position is only a correct identity when the two lists are the same length and in
the same order. A template with an optional section breaks that on the first
document that omits it: every later rule is compared against the section before
the one it describes, so a single missing `## Background` yields a heading error
on `## Usage`, another on `## See also`, and a spurious missing-section report at
the end. The findings are not merely noisy — they name the wrong sections.

The `additionalSections` branch failed differently. `validateAdditionalSections`
decided whether a document section *was* a given template section by running full
validation against it and treating **zero errors as identity**. Two consequences
follow. Any two loosely constrained sections are interchangeable, because both
validate cleanly against either rule. And a section can never be simultaneously
matched and wrong, because being wrong is what disqualified it from matching —
so the only report an invalid section can produce is "missing".

This mattered now because the tool is adopting published doctype templates. The
Good Docs Project's templates are built out of optional and placeholder sections
(`## (Optional) Background`, `## {Task name}`, `## Symptom 1`), which is exactly
the shape both code paths get wrong.

## Decision Drivers

- Optional sections are the norm in real doctype templates, not an edge case.
- Matching must be decidable without running the rules, so that "which section is
  this rule about?" and "is that section valid?" stay separate questions.
- Findings must name the section the author would name, and one structural
  divergence should produce one finding, not a cascade.
- The tool is becoming deterministic (ADR 01003); matching must be a total
  function of the document and the template, with no dependence on evaluation
  order or on how many errors something happened to produce.
- Existing templates in the wild — starting with this repository's own
  `templates.yaml` — must keep working.

## Considered Options

- **One ordered left-to-right pass with anchored rules and slots**
- Keep index matching, but pre-align the lists by dropping absent optional rules
- Match on heading text only, ignoring order
- Full backtracking search for the best assignment

## Decision Outcome

Chosen option: **one ordered left-to-right pass**, in `src/core/match.ts`,
distinguishing two kinds of rule:

- An **anchored** rule constrains heading text (`heading.const` or
  `heading.pattern`) and claims at most one section. If the section at the cursor
  does not satisfy it, we scan forward: a match further on means the sections in
  between are extra, and no match anywhere means the rule is missing.
- A **slot** rule constrains no heading text — the DSL's expression of a
  placeholder like `{Task name}`. It claims exactly one section, or, when it sets
  `repeat: true`, every consecutive section up to the next anchored rule that
  could claim one.

An optional rule that does not match is skipped without moving the cursor, which
is the whole fix: a rule that describes nothing consumes nothing.

Two details are load-bearing.

**Repetition is opt-in.** Greedy slots were implemented first and were wrong.
Adjacent unconstrained sections are ordinary in hand-written templates — this
repository's own `Sample` has `Setup` followed by `Usage` — and a greedy first
slot consumed both, then reported `Usage` missing. `repeat` is therefore a new
key rather than the default, and only genuinely repeated placeholders set it.

**A lone mismatch stays a mismatch.** When a required anchored rule matches
nothing anywhere, and the section at the cursor is wanted by no later rule, the
rule is paired with that section anyway and the heading rule reports
`Expected title "X", but found "Y"`. Without this the commonest error in the
tool's history — one section, one wrong heading — would have degraded into
`missing_section` plus `unexpected_section`, leaving the reader to work out that
they are the same problem.

### Consequences

- Good, because an absent optional section costs exactly nothing: the sections
  after it still match the rules that describe them.
- Good, because matching no longer runs the rules, so a section can be both
  matched and invalid — the report says what is wrong with it instead of
  claiming it is absent.
- Good, because it is O(n+m) with no backtracking, and total: the same document
  and template always produce the same findings in the same order.
- Good, because `subsectionValidator` disappears. Recursion is the same function
  applied to a matched pair's children, so there is one matching rule in the
  codebase rather than two that drifted apart.
- Bad, because the DSL grows a key (`repeat`), and a template author who wants a
  repeated placeholder must now say so.
- Bad, because two adjacent `repeat: true` slots remain ambiguous, and the first
  wins. No rule can resolve that without backtracking, and the shape does not
  occur in any template we ship.
- Neutral, because `section_count_mismatch` is gone. It reported an arithmetic
  disagreement about how many sections there should be; the pass now reports the
  specific rule that went unmatched or the specific section that went unclaimed.

### Confirmation

`test/unit/match.test.ts` pins each branch: ordered anchoring, an absent optional
rule leaving later matches intact, missing and unexpected sections, forward
scanning past extras, pattern anchors, single and repeated slots, empty required
and optional slots, and the coerced-mismatch message.

`test/integration/repo-templates.test.ts` pins the combination against this
repository's own `templates.yaml` and `artifacts/sample_markdown.md`: `Sample`
lints clean, and the deliberately mismatched `how-to` produces exactly three
heading mismatches rather than a cascade. That integration test is what caught
the greedy-slot error — every unit test passed with greedy slots.

## Pros and Cons of the Options

### One ordered left-to-right pass with anchored rules and slots

- Good, because order is preserved without order being the identity.
- Good, because the matching decision is explainable in one sentence per rule,
  which is what makes a `--explain` mode possible later.
- Bad, because "slot" is a concept template authors have to learn, even though
  they write one by simply omitting `heading`.

### Pre-align the lists by dropping absent optional rules

- Good, because it is a small patch to the existing code.
- Bad, because deciding which optional rules are absent is the matching problem;
  this option assumes the answer it needs.

### Match on heading text only, ignoring order

- Good, because it is trivial to implement and never misaligns.
- Bad, because section order is most of what a doctype template asserts. A
  how-to with "See also" before "Before you start" would pass.
- Bad, because placeholder sections have no heading text to match on.

### Full backtracking search for the best assignment

- Good, because it resolves the adjacent-slot ambiguity optimally.
- Bad, because "best" needs a scoring function, and a finding set that depends on
  a score is one nobody can predict from reading the template.
- Bad, because worst-case cost is exponential in the number of slots, for a case
  that does not arise in practice.
