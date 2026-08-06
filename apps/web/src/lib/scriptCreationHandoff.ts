export const SCRIPT_CREATION_PROMPT_MAX_LENGTH = 4_000;

const SCRIPT_CREATION_HANDOFF_SCHEMA = "scriptCreationHandoff.v1" as const;

interface ScriptCreationHandoffState {
  scriptCreationHandoff: {
    schemaVersion: typeof SCRIPT_CREATION_HANDOFF_SCHEMA;
    prompt: string;
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

export function scriptCreationHandoffState(
  prompt: string,
): ScriptCreationHandoffState {
  return {
    scriptCreationHandoff: {
      schemaVersion: SCRIPT_CREATION_HANDOFF_SCHEMA,
      prompt: prompt.trim(),
    },
  };
}

export function readScriptCreationHandoff(
  state: unknown,
): { startSource: "idea"; goal: string } | null {
  if (!isPlainRecord(state)) return null;
  const handoff = state.scriptCreationHandoff;
  if (!isPlainRecord(handoff)) return null;
  if (
    Object.keys(handoff).some(
      (key) => key !== "schemaVersion" && key !== "prompt",
    ) ||
    handoff.schemaVersion !== SCRIPT_CREATION_HANDOFF_SCHEMA ||
    typeof handoff.prompt !== "string"
  ) {
    return null;
  }
  const goal = handoff.prompt.trim();
  if (!goal || goal.length > SCRIPT_CREATION_PROMPT_MAX_LENGTH) return null;
  return { startSource: "idea", goal };
}
