# Performance And Visual Regression Policy

<!-- agent-summary: Measure before and after for performance-sensitive changes; do not optimize by intuition. -->
<!-- agent-summary: Visual changes require browser inspection and should gain screenshot assertions where stable. -->
<!-- agent-summary: Playwright visual baselines are reviewed artifacts, not opaque approval stamps. -->
<!-- agent-summary: Keep representative benchmarks deterministic, small, and separate from paid provider calls. -->
<!-- agent-summary: Record metric, environment, baseline, change, and interpretation in the worksheet. -->
<!-- agent-summary: Regressions block handoff unless explicitly accepted and documented. -->
<!-- agent-summary: Performance engineer owns this policy and the benchmark backlog. -->

The repository has browser E2E and manual visual guidance, but no committed visual-snapshot suite or performance budget yet. Add them incrementally: start with stable route fixtures, `expect(page).toHaveScreenshot(...)`, and a small budgeted benchmark for the affected subsystem. Do not commit broad screenshots until fixtures and rendering environment are deterministic.

For web rendering, use browser performance tooling and record route, device/viewport, interaction, and trace conclusion. For API work, use a repeatable local request script with fixed data and report latency distribution, not one timing.
