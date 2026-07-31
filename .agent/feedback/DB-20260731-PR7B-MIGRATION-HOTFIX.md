# Feedback: DB-20260731-PR7B-MIGRATION-HOTFIX

<!-- agent-summary: The PR 7B production migration rolled back on a cross-table RLS dependency. -->
<!-- agent-summary: The dependent action policy queried a retiring orchestrator-run profile column. -->
<!-- agent-summary: The hotfix replaces that policy before the non-CASCADE column drop. -->
<!-- agent-summary: Its role, tool, status, project, run, action, and approval-context fences remain intact. -->
<!-- agent-summary: Retirement catalog assertions now scan every public policy for the old identifier. -->
<!-- agent-summary: Boundary-upgrade coverage verifies the final policy definition in PostgreSQL. -->
<!-- agent-summary: Production retries the same unapplied transaction without migration-ledger repair. -->

## Lesson

A column-retirement audit must include cross-table RLS dependencies, not only
functions, constraints, grants, triggers, and policies owned by the table whose
column is being dropped. A full-schema text search found the predicate, but the
retirement checklist grouped policies by the target table and missed a policy
on `actions` that queried `orchestrator_runs.root_execution_profile`.
Cross-table policies also compose through RLS on every referenced table: after
removing a dependency, the replacement policy on the referenced table must
still expose the causally authorized rows needed by the outer policy.

## Follow-up

Keep destructive drops non-`CASCADE`, scan every public policy for the retired
identifier, and verify the final catalog policy shape in the seeded boundary
upgrade harness. Before retrying production, confirm the failed migration is
absent from the remote ledger and the compatibility column and bridge objects
remain present.
