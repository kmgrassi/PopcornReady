import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  editGeminiVideo,
  findGeminiOmniOutputVideo,
  normalizeGeminiVideoMime,
} from "../providers/gemini";

async function tempVideoPath(name = "source.mp4"): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "popcorn-gemini-edit-test-"));
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, Buffer.from("source-video"));
  return filePath;
}

function input(sourcePath: string, overrides: Record<string, unknown> = {}) {
  return {
    provider: "gemini" as const,
    kind: "video" as const,
    prompt: "Add a dinosaur on the couch.",
    editSourceVideoPath: sourcePath,
    seconds: 6,
    ...overrides,
  };
}

test("Gemini Omni edit uploads, waits for active files, polls interactions, and returns data output", async () => {
  const sourcePath = await tempVideoPath();
  const uploads: Array<{ file: string; mimeType: string }> = [];
  const interactionInputs: unknown[] = [];
  const ai = {
    files: {
      upload: async ({ file, config }: { file: string; config: { mimeType: string } }) => {
        uploads.push({ file, mimeType: config.mimeType });
        return { name: "files/source", state: "PROCESSING", mimeType: config.mimeType };
      },
      get: async ({ name }: { name: string }) => {
        assert.equal(name, "files/source");
        return {
          name,
          state: "ACTIVE",
          uri: "https://files.test/source",
          mimeType: "video/mp4",
        };
      },
      download: async () => {
        throw new Error("download should not be called for base64 data output");
      },
    },
    interactions: {
      create: async (payload: unknown) => {
        interactionInputs.push(payload);
        return { id: "interaction_1", status: "in_progress" };
      },
      get: async () => ({
        id: "interaction_1",
        status: "completed",
        steps: [
          {
            type: "model_output",
            content: [
              {
                type: "video",
                data: Buffer.from("edited-video").toString("base64"),
                mime_type: "video/mp4",
              },
            ],
          },
        ],
      }),
    },
  };

  const result = await editGeminiVideo(input(sourcePath), {
    ai,
    apiKey: "gemini-test-key",
    sleep: async () => {},
    now: () => 0,
  } as never);

  assert.deepEqual(uploads, [{ file: sourcePath, mimeType: "video/mp4" }]);
  assert.equal(interactionInputs.length, 1);
  assert.equal(result.model, "gemini-omni-flash-preview");
  assert.equal(result.mimeType, "video/mp4");
  assert.equal(result.costUsd, 3);
  assert.equal(result.bytes.toString(), "edited-video");
});

test("Gemini Omni edit normalizes QuickTime input and transcodes/retries once on invalid argument", async () => {
  const sourcePath = await tempVideoPath("source.mov");
  const uploads: Array<{ file: string; mimeType: string }> = [];
  const interactionMimes: string[] = [];
  let createCount = 0;
  const execCalls: Array<{ cmd: string; args: string[] }> = [];
  const ai = {
    files: {
      upload: async ({ file, config }: { file: string; config: { mimeType: string } }) => {
        uploads.push({ file, mimeType: config.mimeType });
        return {
          name: `files/${uploads.length}`,
          state: "ACTIVE",
          uri: `https://files.test/${uploads.length}`,
          mimeType: config.mimeType,
        };
      },
      get: async () => {
        throw new Error("get should not be called for active uploads");
      },
      download: async () => {
        throw new Error("download should not be called for base64 data output");
      },
    },
    interactions: {
      create: async (payload: { input: Array<{ mime_type?: string }> }) => {
        createCount += 1;
        interactionMimes.push(String(payload.input[0]?.mime_type));
        if (createCount === 1) throw Object.assign(new Error("invalid"), { status: 400 });
        return {
          id: "interaction_retry",
          status: "completed",
          steps: [
            {
              type: "model_output",
              content: [
                {
                  type: "video",
                  data: Buffer.from("retried-edit").toString("base64"),
                  mime_type: "video/mp4",
                },
              ],
            },
          ],
        };
      },
      get: async () => {
        throw new Error("get should not be called for completed interaction");
      },
    },
  };

  const result = await editGeminiVideo(input(sourcePath), {
    ai,
    apiKey: "gemini-test-key",
    sleep: async () => {},
    now: () => 0,
    execFileAsync: async (cmd: string, args: string[]) => {
      execCalls.push({ cmd, args });
      await fs.writeFile(args.at(-1) as string, Buffer.from("converted"));
      return { stdout: "", stderr: "" };
    },
  } as never);

  assert.equal(createCount, 2);
  assert.equal(uploads[0]?.mimeType, "video/mov");
  assert.equal(uploads[1]?.mimeType, "video/mp4");
  assert.deepEqual(interactionMimes, ["video/mov", "video/mp4"]);
  assert.equal(execCalls.length, 1);
  assert.ok(execCalls[0]?.args.includes("libx264"));
  assert.equal(result.bytes.toString(), "retried-edit");
});

test("Gemini Omni output extraction returns the last model video block", () => {
  const output = findGeminiOmniOutputVideo({
    steps: [
      { type: "tool_call", content: [{ type: "video", uri: "ignored" }] },
      {
        type: "model_output",
        content: [{ type: "video", uri: "first", mime_type: "video/mp4" }],
      },
      {
        type: "model_output",
        content: [{ type: "video", uri: "last", mime_type: "video/mp4" }],
      },
    ],
  });

  assert.equal(output?.uri, "last");
});

test("Gemini Omni edit downloads URI outputs with authenticated fetch fallback", async () => {
  const sourcePath = await tempVideoPath();
  const fetchCalls: Array<{ url: string; key: string | null }> = [];
  const ai = {
    files: {
      upload: async () => ({
        name: "files/source",
        state: "ACTIVE",
        uri: "https://files.test/source",
        mimeType: "video/mp4",
      }),
      get: async () => {
        throw new Error("get should not be called for active uploads");
      },
      download: async () => {
        throw new Error("force fetch fallback");
      },
    },
    interactions: {
      create: async () => ({
        id: "interaction_uri",
        status: "completed",
        steps: [
          {
            type: "model_output",
            content: [{ type: "video", uri: "https://files.test/output" }],
          },
        ],
      }),
      get: async () => {
        throw new Error("get should not be called for completed interaction");
      },
    },
  };

  const result = await editGeminiVideo(input(sourcePath), {
    ai,
    apiKey: "gemini-test-key",
    sleep: async () => {},
    now: () => 0,
    fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({
        url: String(url),
        key: new Headers(init?.headers).get("x-goog-api-key"),
      });
      return new Response("fetched-edit", { status: 200 });
    },
  } as never);

  assert.deepEqual(fetchCalls, [
    {
      url: "https://files.test/output?alt=media",
      key: "gemini-test-key",
    },
  ]);
  assert.equal(result.bytes.toString(), "fetched-edit");
});

test("Gemini video MIME normalization matches Omni enum values", () => {
  assert.equal(normalizeGeminiVideoMime("video/quicktime"), "video/mov");
  assert.equal(normalizeGeminiVideoMime("video/webm; charset=utf-8"), "video/webm");
  assert.equal(normalizeGeminiVideoMime("application/octet-stream"), "video/mp4");
});
