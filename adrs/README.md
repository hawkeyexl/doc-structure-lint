# Architecture decisions

Why `moose-lint` is built the way it is. Each record states the problem, the
options that were actually considered, what was chosen, and — the part worth
reading — what it costs.

These are a log, not a specification. A record describes the decision as it was
made; where later work changed something, the later record says so. If the code
and a record disagree, the code is what runs and the record needs fixing.

| # | decision |
| --- | --- |
| [01001](01001-derive-structure-from-an-ast-behind-a-format-registry.md) | Derive document structure from an AST, behind a per-format parser registry |
| [01002](01002-match-sections-in-order-not-by-index.md) | Match sections to template rules in one ordered pass, not by array index |
| [01003](01003-remove-the-language-model-and-be-deterministic.md) | Remove the bundled language model; structure linting is deterministic |
| [01004](01004-route-templates-by-the-type-frontmatter-key.md) | Route templates by a page's `type` frontmatter key |
| [01005](01005-ship-tgdp-structure-templates-without-demoting-user-templates.md) | Ship TGDP structure templates as built-ins, without demoting user templates |

## Writing one

Follow the format of the existing records — frontmatter (`status`, `date`,
`decision-makers`), then Context and Problem Statement, Decision Drivers,
Considered Options, Decision Outcome, Consequences, Confirmation, and Pros and
Cons of the Options.

Two things make a record worth having. **Name the options you rejected**, and
say what was good about them; a record listing only the winner is an
advertisement. And **write the Confirmation section**, naming the tests that
would fail if the decision were reversed — a decision nothing checks is a
preference.
