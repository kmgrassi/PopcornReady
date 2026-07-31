#!/usr/bin/env tsx
/**
 * popcorn CLI — drive the Popcorn Ready API from the terminal.
 *
 * One thin HTTP client over the v1 API so the flows the UI runs are scriptable
 * against a local server or a remote deploy. Everything is JSON + poll-based, so
 * there is nothing the UI does over websockets/SSE that this can't reach.
 *
 * Config (flags override env):
 *   --api <origin>     POPCORN_API_URL    API origin (default http://localhost:4000)
 *   --token <jwt>      POPCORN_API_TOKEN  Bearer token (omit in AUTH_MODE=local/hybrid)
 *   --json                                Print raw JSON only (machine-readable)
 *
 * Run: pnpm --filter @popcorn/api cli -- <command> [options]
 *      pnpm --filter @popcorn/api cli -- help
 */

type Json = Record<string, unknown>;

interface Cfg {
  base: string; // ...origin + /api/v1
  origin: string;
  token?: string;
  json: boolean;
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

// --- tiny arg parser: positionals + --key value / --flag ---
function parseArgs(argv: string[]): { positionals: string[]; opts: Record<string, string | true> } {
  const positionals: string[] = [];
  const opts: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        opts[key] = true;
      } else {
        opts[key] = next;
        i += 1;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, opts };
}

function str(opts: Record<string, string | true>, key: string): string | undefined {
  const v = opts[key];
  return typeof v === "string" ? v : undefined;
}

function required(opts: Record<string, string | true>, key: string): string {
  const v = str(opts, key);
  if (!v) fail(`--${key} is required`);
  return v;
}

function readCfg(opts: Record<string, string | true>): Cfg {
  const origin = (str(opts, "api") ?? process.env.POPCORN_API_URL ?? "http://localhost:4000").replace(
    /\/+$/,
    ""
  );
  const base = origin.endsWith("/api/v1") ? origin : `${origin}/api/v1`;
  return {
    origin,
    base,
    token: str(opts, "token") ?? process.env.POPCORN_API_TOKEN,
    json: opts.json === true,
  };
}

async function api<T = Json>(cfg: Cfg, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${cfg.base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    fail(`non-JSON response from ${method} ${path} (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const envelope = (data as { error?: { code?: string; message?: string } })?.error;
    fail(`${method} ${path} -> HTTP ${res.status} ${envelope?.code ?? ""} ${envelope?.message ?? text}`);
  }
  return data as T;
}

function out(cfg: Cfg, value: unknown, human?: () => void) {
  if (cfg.json || !human) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    human();
  }
}

function briefFromOpts(opts: Record<string, string | true>): Json | undefined {
  const goal = str(opts, "prompt") ?? str(opts, "goal");
  if (!goal) return undefined;
  const brief: Json = {
    goal,
    targetLengthSec: Number(str(opts, "length") ?? 30),
    aspectRatio: str(opts, "aspect") ?? "9:16",
  };
  if (str(opts, "style")) brief.style = str(opts, "style");
  if (str(opts, "format")) brief.format = str(opts, "format");
  if (str(opts, "platform")) brief.platform = str(opts, "platform");
  return brief;
}

const HELP = `popcorn CLI — drive the Popcorn Ready API

Global: --api <origin> --token <jwt> --json

  health
  me

  project create --name <n> [--prompt <text> --length 30 --aspect 9:16 --format <f>]
  project list [--limit 24]
  project get <projectId>

  upload --project <id> --file <path> [--kind image|video|audio --filename <n> --content-type <ct>]

  run start --project <id> --prompt <text> [--gates a,b --budget <usd> --length --aspect]
  run get --project <id> --run <id>
  run watch --project <id> --run <id> [--interval 4 --timeout 1800]
  run approve --project <id> --run <id> [--note <text>]
  run cancel  --project <id> --run <id>

  discover projects [--limit 24]
  discover assets   [--limit 24 --kind image|video|audio]

  catalog list   [--limit 24 --kind character|story|image]
  catalog search --q <text> [--limit 24 --kind <k>]
  catalog publish --project <id> --kind image|character|story --title <t> \\
                  (--asset <assetId> | --story <storyBlueprintId>) [--summary <s> --tags a,b]
  catalog use --entry <entryId> --project <targetProjectId>

  auth login --email <e> --password <p>   (Supabase password grant -> prints access token)
`;

async function main() {
  const [, , ...argv] = process.argv;
  const { positionals, opts } = parseArgs(argv);
  const [command, sub] = positionals;
  const cfg = readCfg(opts);

  if (!command || command === "help" || opts.help) {
    console.log(HELP);
    return;
  }

  switch (command) {
    case "health":
      return out(cfg, await api(cfg, "GET", "/health"));

    case "me":
      return out(cfg, await api(cfg, "GET", "/me"));

    case "project": {
      if (sub === "create") {
        const body: Json = { name: required(opts, "name") };
        const brief = briefFromOpts(opts);
        if (brief) body.brief = brief;
        const res = await api<{ project: Json }>(cfg, "POST", "/projects", body);
        return out(cfg, res, () => console.log((res.project as Json).id));
      }
      if (sub === "list") {
        const res = await api<{ projects: Json[] }>(cfg, "GET", `/projects?limit=${str(opts, "limit") ?? 24}`);
        return out(cfg, res, () =>
          res.projects.forEach((p) => console.log(`${(p as Json).id}\t${(p as Json).name}`))
        );
      }
      if (sub === "get") {
        const projectId = positionals[2] ?? required(opts, "id");
        return out(cfg, await api(cfg, "GET", `/projects/${projectId}`));
      }
      if (positionals[1] && !["create", "list", "get"].includes(positionals[1])) {
        return out(cfg, await api(cfg, "GET", `/projects/${positionals[1]}`));
      }
      return fail("usage: project create|list|get");
    }

    case "upload": {
      const projectId = required(opts, "project");
      const file = required(opts, "file");
      const { readFile } = await import("node:fs/promises");
      const path = await import("node:path");
      const bytes = await readFile(file);
      const filename = str(opts, "filename") ?? path.basename(file);
      const kind = str(opts, "kind") ?? "image";
      const contentType = str(opts, "content-type") ?? guessContentType(filename);
      const res = await api(cfg, "POST", `/projects/${projectId}/assets`, {
        source: { type: "multipart_upload", dataBase64: bytes.toString("base64"), mimeType: contentType },
        kind,
        filename,
      });
      return out(cfg, res);
    }

    case "run": {
      const projectId = required(opts, "project");
      const baseRun = `/projects/${projectId}/generation-runs`;
      if (sub === "start") {
        const body: Json = { ...briefFromOpts(opts) };
        if (!body.goal) fail("--prompt is required");
        const gates = str(opts, "gates");
        if (gates) body.reviewGates = gates.split(",").map((g) => g.trim()).filter(Boolean);
        if (str(opts, "budget")) body.budgetUsd = Number(str(opts, "budget"));
        const res = await api<{ runId: string }>(
          cfg,
          "POST",
          `/projects/${projectId}/generation-entrypoints/prompt`,
          body
        );
        return out(cfg, res, () => console.log(res.runId));
      }
      const runId = required(opts, "run");
      if (sub === "get") return out(cfg, await api(cfg, "GET", `${baseRun}/${runId}`));
      if (sub === "approve" || sub === "cancel") {
        const body = str(opts, "note") ? { note: str(opts, "note") } : {};
        return out(cfg, await api(cfg, "POST", `${baseRun}/${runId}/${sub}`, body));
      }
      if (sub === "watch") return watchRun(cfg, baseRun, runId, opts);
      return fail("usage: run start|get|watch|approve|cancel");
    }

    case "discover": {
      const limit = str(opts, "limit") ?? 24;
      if (sub === "projects") return out(cfg, await api(cfg, "GET", `/discover/projects?limit=${limit}`));
      if (sub === "assets") {
        const kind = str(opts, "kind") ? `&kind=${str(opts, "kind")}` : "";
        return out(cfg, await api(cfg, "GET", `/discover/assets?limit=${limit}${kind}`));
      }
      return fail("usage: discover projects|assets");
    }

    case "catalog": {
      const limit = str(opts, "limit") ?? 24;
      if (sub === "list") {
        const kind = str(opts, "kind") ? `&kind=${str(opts, "kind")}` : "";
        return out(cfg, await api(cfg, "GET", `/catalog/entries?limit=${limit}${kind}`));
      }
      if (sub === "search") {
        const kind = str(opts, "kind") ? `&kind=${str(opts, "kind")}` : "";
        return out(
          cfg,
          await api(cfg, "GET", `/catalog/search?q=${encodeURIComponent(required(opts, "q"))}&limit=${limit}${kind}`)
        );
      }
      if (sub === "publish") {
        const kind = required(opts, "kind");
        const body: Json = { kind, title: required(opts, "title"), status: "published" };
        if (str(opts, "summary")) body.summary = str(opts, "summary");
        if (str(opts, "tags")) body.tags = str(opts, "tags")!.split(",").map((t) => t.trim());
        if (kind === "story") body.sourceStoryBlueprintId = required(opts, "story");
        else body.sourceAssetId = required(opts, "asset");
        return out(cfg, await api(cfg, "POST", "/catalog/entries", body));
      }
      if (sub === "use") {
        return out(
          cfg,
          await api(cfg, "POST", `/catalog/entries/${required(opts, "entry")}/use`, {
            targetProjectId: required(opts, "project"),
          })
        );
      }
      return fail("usage: catalog list|search|publish|use");
    }

    case "auth": {
      if (sub === "login") return authLogin(cfg, opts);
      return fail("usage: auth login --email <e> --password <p>");
    }

    default:
      return fail(`unknown command "${command}" (try: help)`);
  }
}

async function watchRun(cfg: Cfg, baseRun: string, runId: string, opts: Record<string, string | true>) {
  const intervalMs = Number(str(opts, "interval") ?? 4) * 1000;
  const timeoutMs = Number(str(opts, "timeout") ?? 1800) * 1000;
  const started = Date.now();
  let lastLine = "";
  for (;;) {
    const detail = await api<{ run: Json; stages: Json[] }>(cfg, "GET", `${baseRun}/${runId}`);
    const run = detail.run as { status: string; reviewGate?: { stageType?: string } | null; progressPercent?: number };
    const stageLine = detail.stages
      .map((s) => `${(s as Json).type}:${(s as Json).status}`)
      .join(" ");
    const line = `[${run.status}${run.reviewGate ? ` gate@${run.reviewGate.stageType}` : ""}] ${stageLine}`;
    if (line !== lastLine) {
      console.error(line);
      lastLine = line;
    }
    if (["succeeded", "failed", "canceled"].includes(run.status) || run.reviewGate) {
      return out(cfg, detail);
    }
    if (Date.now() - started > timeoutMs) fail(`watch timed out after ${timeoutMs / 1000}s`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// Supabase password grant — mints a bearer token for AUTH_MODE=supabase without a browser.
async function authLogin(cfg: Cfg, opts: Record<string, string | true>) {
  const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    fail("set SUPABASE_URL and SUPABASE_ANON_KEY (or VITE_ variants) to mint a token");
  }
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: anonKey! },
    body: JSON.stringify({ email: required(opts, "email"), password: required(opts, "password") }),
  });
  const data = (await res.json()) as { access_token?: string; error_description?: string; msg?: string };
  if (!res.ok || !data.access_token) {
    fail(`login failed: ${data.error_description ?? data.msg ?? JSON.stringify(data)}`);
  }
  // Print only the token so it can be captured: TOKEN=$(... auth login ...)
  console.log(data.access_token);
}

function guessContentType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
  };
  return map[ext] ?? "application/octet-stream";
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
