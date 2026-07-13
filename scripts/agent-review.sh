#!/usr/bin/env bash
set -euo pipefail

phase="${1:-}"
worksheet_id="${2:-}"
if [[ -z "$phase" || -z "$worksheet_id" ]]; then
  echo "Usage: pnpm agent:review -- <research|plan|implementation|wrap-up> <WORKSHEET_ID>" >&2
  exit 2
fi
if [[ -z "${AGENT_REVIEW_COMMAND:-}" ]]; then
  echo "AGENT_REVIEW_COMMAND is not configured. Record this in the worksheet and use an available independent reviewer." >&2
  exit 3
fi

export AGENT_REVIEW_PHASE="$phase"
export AGENT_WORKSHEET_ID="$worksheet_id"
export AGENT_REVIEW_REPOSITORY_ROOT="$(git rev-parse --show-toplevel)"
exec bash -lc "$AGENT_REVIEW_COMMAND"
