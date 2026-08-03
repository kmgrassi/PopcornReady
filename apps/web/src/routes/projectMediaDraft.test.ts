import assert from "node:assert/strict";
import test from "node:test";
import {
  clearProjectMediaDraft,
  projectMediaDraftKey,
  readProjectMediaDraft,
  stashProjectMediaDraft,
} from "./projectMediaDraft";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

test("project media drafts round-trip per project and deduplicate selections", () => {
  const storage = memoryStorage();
  stashProjectMediaDraft("project/one", {
    selectedIds: ["asset-b", "asset-a", "asset-b"],
    selectedPresetId: "montage",
    intentText: "Cut these into a launch montage.",
  }, storage);

  assert.deepEqual(readProjectMediaDraft("project/one", storage), {
    selectedIds: ["asset-b", "asset-a"],
    selectedPresetId: "montage",
    intentText: "Cut these into a launch montage.",
  });
  assert.equal(readProjectMediaDraft("project/two", storage), null);
  clearProjectMediaDraft("project/one", storage);
  assert.equal(readProjectMediaDraft("project/one", storage), null);
  assert.match(projectMediaDraftKey("project/one"), /project%2Fone$/);
});

test("empty and invalid drafts are removed", () => {
  const storage = memoryStorage();
  const key = projectMediaDraftKey("project-one");

  stashProjectMediaDraft("project-one", {
    selectedIds: [],
    selectedPresetId: "",
    intentText: "",
  }, storage);
  assert.equal(storage.getItem(key), null);

  storage.setItem(key, JSON.stringify({ version: 1, selectedIds: [42] }));
  assert.equal(readProjectMediaDraft("project-one", storage), null);
  assert.equal(storage.getItem(key), null);
});
