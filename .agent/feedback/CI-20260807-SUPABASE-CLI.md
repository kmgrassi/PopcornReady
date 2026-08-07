# Feedback: CI-20260807-SUPABASE-CLI

Related worksheet: [CI-20260807-SUPABASE-CLI](../worksheets/CI-20260807-SUPABASE-CLI.md)

<!-- agent-summary: Production mutation tools should use reviewed exact versions. -->
<!-- agent-summary: Floating CLI upgrades can break migrations without repository changes. -->
<!-- agent-summary: Deployment health correctly kept the previous API active. -->
<!-- agent-summary: The first failing surface may be downstream of the actual mutation failure. -->
<!-- agent-summary: Workflow policy tests should encode exact external-tool pins. -->
<!-- agent-summary: Upgrade pins intentionally after exercising the hosted command path. -->
<!-- agent-summary: Release verification observes coherence; it does not repair deployments. -->

## Lesson

The API build and process start both succeeded, but Railway correctly refused to
promote the release because two migrations were missing. The upstream failure
occurred earlier: a floating Supabase CLI resolved a same-day release whose
strict Management API decoder broke `supabase link`. Reading the mutation job,
Railway health failure, and final coherence timeout as one causal chain avoided
patching the verifier or weakening readiness.

External tools that mutate production should not float on `latest`. An exact
pin plus a repository policy assertion makes upgrades visible and reviewable.

## Follow-up

After this PR merges, confirm the migration workflow applies the pending
migrations, redeploy the same main commit on Railway, and verify direct API,
web metadata, and the same-origin proxy report one coherent release.
