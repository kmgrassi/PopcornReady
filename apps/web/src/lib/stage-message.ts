// Stage messages sometimes carry a provider's raw error payload verbatim, e.g.
// 'ElevenLabs request failed (422): {"detail":{"message":"Invalid model id",...}}'.
// Pull the human sentence out of the JSON so the rail shows
// "ElevenLabs request failed (422): Invalid model id" instead of the blob.
export function humanizeStageMessage(message: string): string {
  const braceIndex = message.indexOf("{");
  if (braceIndex === -1) return message;
  const parsed = tryParseJson(message.slice(braceIndex));
  if (parsed === null) return message;
  const prefix = message.slice(0, braceIndex).replace(/[\s:]+$/, "").trim();
  const detail = extractMessage(parsed);
  if (detail && prefix) return `${prefix}: ${detail}`;
  if (detail) return detail;
  return prefix || message;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

// Depth-first search for the first non-empty string under a "message" key —
// provider payloads nest it ("detail.message", "error.message", …).
function extractMessage(value: unknown, depth = 0): string | null {
  if (depth > 4 || value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message.trim();
  }
  for (const nested of Object.values(record)) {
    const found = extractMessage(nested, depth + 1);
    if (found) return found;
  }
  return null;
}
