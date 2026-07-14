# False-Confidence Test Audits

<!-- agent-summary: This audit finds tests that pass without proving the intended behavior. -->
<!-- agent-summary: Run it after harness changes and during periodic commit sweeps. -->
<!-- agent-summary: Start from user-visible failure modes, then trace each assertion to real behavior. -->
<!-- agent-summary: Replace assertion-free mocks and tautological expectations with observable outcomes. -->
<!-- agent-summary: Verify setup, teardown, test selection, and CI command coverage rather than trusting names. -->
<!-- agent-summary: Record audit findings in the worksheet and add regression tests with each fix. -->
<!-- agent-summary: The test skeptic owns this document and related improvements. -->

1. Deliberately break the behavior in a temporary local change: does the test fail for the expected reason?
2. Verify the test command actually selects the file and test name in CI.
3. Inspect whether mocks bypass the production branch the test claims to cover.
4. Check positive, negative, and reload/retry paths where state persists.
5. Check that fixtures isolate tenancy, authorization, and cleanup.
