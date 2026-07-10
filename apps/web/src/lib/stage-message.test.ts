import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { humanizeStageMessage } from "./stage-message";

describe("humanizeStageMessage", () => {
  it("passes plain messages through unchanged", () => {
    assert.equal(humanizeStageMessage("Rendering audio."), "Rendering audio.");
  });

  it("extracts the nested message from an embedded provider payload", () => {
    const raw =
      'ElevenLabs request failed (422): {"detail":{"type":"unprocessable_entity","code":"unprocessable_entity","message":"Invalid model id: eleven_multilingual_v2","status":"unprocessable_entity","request_id":"220704c21df75418326e518518090846"}}';
    assert.equal(
      humanizeStageMessage(raw),
      "ElevenLabs request failed (422): Invalid model id: eleven_multilingual_v2"
    );
  });

  it("extracts a top-level message field", () => {
    assert.equal(
      humanizeStageMessage('Upstream error: {"message":"Rate limit exceeded","code":429}'),
      "Upstream error: Rate limit exceeded"
    );
  });

  it("returns the message body when there is no prefix", () => {
    assert.equal(
      humanizeStageMessage('{"error":{"message":"Model overloaded"}}'),
      "Model overloaded"
    );
  });

  it("falls back to the prefix when the payload has no message", () => {
    assert.equal(
      humanizeStageMessage('Video render failed: {"status":500,"trace":"abc123"}'),
      "Video render failed"
    );
  });

  it("leaves messages with unparseable braces unchanged", () => {
    assert.equal(
      humanizeStageMessage("Set {width} and {height} before export."),
      "Set {width} and {height} before export."
    );
  });
});
