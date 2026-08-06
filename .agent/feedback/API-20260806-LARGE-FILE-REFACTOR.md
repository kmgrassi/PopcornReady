# Feedback: API-20260806-LARGE-FILE-REFACTOR

<!-- agent-summary: Task-scoped feedback for the generated-assets refactor. -->
<!-- agent-summary: Provider execution and persistence form a cohesive extraction boundary. -->
<!-- agent-summary: Public lifecycle exports can remain stable while implementation moves. -->
<!-- agent-summary: Large-file refactors need typecheck plus route and domain-adjacent tests. -->
<!-- agent-summary: Generated modules should not import back from their public facade. -->
<!-- agent-summary: Review must check preserved budget and type declarations after movement. -->
<!-- agent-summary: This feedback record ships with the implementation and worksheet. -->

## Lesson

The generated-assets module had a natural boundary at provider execution and asset persistence: reference-byte materialization, prompt preflight, provider dispatch, provenance, storage, and revision handling all move together while the public job lifecycle stays small and stable. When extracting a large function, preserve nearby public type declarations and budget-admission helpers explicitly; line-based movement can accidentally remove adjacent declarations even when the moved function itself is correct.

## Follow-up

Keep future large-file refactors bounded by one cohesive lifecycle or transformation boundary, and validate with typecheck plus tests that exercise the facade's route contract and adjacent domain projections.
