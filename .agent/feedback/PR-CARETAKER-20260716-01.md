# PR caretaker feedback — 2026-07-16

<!-- agent-summary: Records the review findings from the 2026-07-16 PR caretaker sweep. -->
<!-- agent-summary: PR #794's recoverable storage concern was already fixed on its current head. -->
<!-- agent-summary: PR #795 had four actionable scope-boundary findings. -->
<!-- agent-summary: Audio primitive asset references are now validated against authorized scope. -->
<!-- agent-summary: Audio projections retain visual picture assets and affected candidates. -->
<!-- agent-summary: Preserve selection pins now include slot-key identity. -->
<!-- agent-summary: Targeted tests and API validation should be rerun after future caretaker changes. -->

The PR sweep identified four valid scope-boundary gaps in PR #795. The fixes
preserve the fail-closed model while allowing audio tasks to inspect visual
picture assets, authorizing graph-computed affected candidates, and binding
selection preserve pins to their declared slot key. PR #794's current head
already addressed its outdated recoverable-storage comment.
