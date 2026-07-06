# PR Merge To Main Guide

This guide defines when an open pull request is ready to merge into `main`.
Use it for agent-generated PRs and human-authored PRs that are being routed
through AI review.

## Signals

- **Thumbs-up on the PR description**: a `+1` reaction on the original PR
  description means the automated review found the PR acceptable to merge,
  assuming checks pass and no unresolved comments remain.
- **Comments on the PR**: any review thread, inline comment, or top-level
  actionable comment must be addressed before merge.
- **Checks**: required CI, deploy previews, smoke tests, and relevant local
  validation must pass or have a documented reason they could not run.

## Merge Eligibility

A PR can be merged into `main` when all of the following are true:

1. The original PR description has a thumbs-up reaction.
2. All actionable PR comments have been addressed.
3. The branch is mergeable with `main`.
4. Required checks have passed, or any unavailable checks are explicitly noted.
5. The final diff still matches the PR intent after conflict resolution or
   follow-up changes.

Do not merge a PR just because it has passing checks. The thumbs-up reaction on
the original PR description is the merge approval signal.

## Handling PR Comments

Every actionable comment needs one of two outcomes:

1. **Code change**: update the branch to address the comment, run the relevant
   validation, and push the fix.
2. **No-code response**: leave a clear note explaining why no code change was
   made. Use this when the comment is incorrect, already covered elsewhere,
   would cause a regression, is out of scope, or needs product clarification.

If a comment is ambiguous, do not guess silently. Either make the smallest
defensible code change or leave a note explaining the interpretation and the
reason for not changing code.

Resolved or outdated GitHub threads do not need further action unless a newer
comment reopens the issue.

## Conflict Resolution

When a PR has merge conflicts:

1. Update the PR branch with the latest `main`.
2. Resolve conflicts by preserving the newest intended behavior from `main` and
   the PR's still-relevant changes.
3. Watch for stale duplicate work. If another PR already merged the same change,
   do not reintroduce older code just to make the branch merge.
4. Run targeted checks for the conflicted files and any broader checks required
   by the risk of the merge.
5. Push the conflict-resolution commit and wait for checks to pass.

If conflict resolution leaves no meaningful PR changes, close the PR rather than
merging an empty or stale branch.

## Merge Procedure

1. List open PRs and inspect:
   - original description reactions,
   - unresolved review threads,
   - top-level comments,
   - check status,
   - mergeability.
2. For each PR with comments, address comments first.
3. Re-run or confirm relevant validation after any branch update.
4. For each PR with a thumbs-up on the original description and no unresolved
   actionable comments, merge it into `main`.
5. If multiple PRs are ready, merge one at a time and refresh mergeability before
   merging the next PR.
6. If a new PR appears during the pass, inspect it before finishing.

## Documentation In The Final Note

When reporting what happened, include:

- PRs merged.
- PRs updated but not merged, with the reason.
- PRs not touched because they lacked a thumbs-up reaction.
- Comments addressed and the validation that was run.
- Any checks that could not be run or any conflicts left unresolved.
