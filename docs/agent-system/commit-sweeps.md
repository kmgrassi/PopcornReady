# Commit Sweeps

<!-- agent-summary: Commit sweeps detect cross-cutting regressions that individual PR checks miss. -->
<!-- agent-summary: Sweep recent merged work on a schedule or after a concentrated delivery period. -->
<!-- agent-summary: Inspect boundaries, migrations, auth, duplicated patterns, test gaps, and documentation drift. -->
<!-- agent-summary: Prefer small follow-up issues or PRs; do not fold unrelated cleanup into feature work. -->
<!-- agent-summary: Run the false-confidence audit on changed harnesses and high-risk tests. -->
<!-- agent-summary: Record the reviewed range, findings, and disposition in a worksheet. -->
<!-- agent-summary: Maintainer owns this procedure. -->

Run `pnpm agent:sweep -- --base <commit> --head <commit>` weekly or after a major release train. The script reports changed commits and files; the reviewer then checks boundaries, migrations, authorization, duplicate patterns, test gaps, and documentation drift. It is intentionally a context helper, not an automatic code reviewer.
