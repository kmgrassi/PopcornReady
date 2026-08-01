# Worksheets And Feedback

<!-- agent-summary: Every durable task has a committed worksheet under .agent/worksheets. -->
<!-- agent-summary: Worksheets make unfinished work resumable by another agent without chat history. -->
<!-- agent-summary: A worksheet records decisions, changed files, commands, results, blockers, and next action. -->
<!-- agent-summary: Tag completed commits as worksheet/<WORKSHEET_ID> for durable lookup. -->
<!-- agent-summary: Every completed task adds a task-scoped record under .agent/feedback. -->
<!-- agent-summary: Periodically review feedback entries and turn repeated friction into workflow or tooling changes. -->
<!-- agent-summary: Do not store secrets, private prompts, or raw customer data in either record. -->

Copy `.agent/worksheets/TEMPLATE.md` at task start, update it as evidence arrives,
and commit it with the work. Create a matching task-scoped feedback record at
`.agent/feedback/<WORKSHEET_ID>.md`; do not append routine task feedback to the
historical shared `LOG.md`. At least monthly, run an interactive feedback review:
group entries by repeated failure, missing tool, unclear rule, and slow
validation; select one small improvement; record that decision in a new
worksheet.
