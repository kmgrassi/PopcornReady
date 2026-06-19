import type { Page, Route } from "@playwright/test";

const now = "2026-06-16T12:00:00.000Z";
const workspaceId = "workspace-e2e";
const projectId = "project-export-e2e";
const runId = "run-export-e2e";
const draftId = "draft-export-e2e";
const timelineId = "timeline-export-e2e";
const timelineArtifactId = "artifact-timeline-e2e";
const videoAssetId = "asset-video-e2e";
const exportJobId = "export-job-e2e";
const outputArtifactId = "artifact-output-e2e";
const mediaUrl = "data:video/mp4;base64,AAAA";

const briefDraft = {
  goal: "Launch a coffee tasting promo",
  targetLengthSec: 8,
  aspectRatio: "9:16",
  projectName: "Coffee Reveal",
  footageChoice: "prompt_only",
  footageMode: "asset_driven",
  selectedFootage: [],
  audience: "coffee fans",
  platform: "tiktok",
  format: "visual_reveal",
  hook: "The roast changes everything.",
  bestVisual: "Steam lifting from a fresh pour.",
  bigIdea: "Show the flavor reveal quickly.",
  payoff: "A bright final tasting note.",
  accuracyNote: "",
  style: "clean product demo",
  callToAction: "Try the tasting flight.",
  provider: "openai",
  seedKind: "image",
  seedSize: "1024x1792",
  showCaptions: true,
  reviewGates: [],
};

const timeline = {
  id: timelineId,
  aspectRatio: "9:16",
  fps: 30,
  showCaptions: true,
  segments: [
    {
      id: "segment-hook",
      clipId: videoAssetId,
      sourceInSec: 0,
      sourceOutSec: 8,
      role: "Hook",
      beatId: "beat-hook",
      reason: "Open with the strongest product visual.",
      caption: "Fresh roast, fast reveal",
    },
  ],
};

const project = {
  id: projectId,
  schemaVersion: 1,
  workspaceId,
  name: "Coffee Reveal",
  status: "active",
  visibility: "private",
  brief: {
    goal: briefDraft.goal,
    targetLengthSec: briefDraft.targetLengthSec,
    aspectRatio: briefDraft.aspectRatio,
    style: briefDraft.style,
  },
  currentBriefVersionId: "brief-version-e2e",
  hasStoryboard: true,
  posterAssetId: null,
  posterUrl: null,
  createdAt: now,
  updatedAt: now,
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function draftRecord(step = "generate") {
  return {
    draftId,
    excerpt: briefDraft.goal,
    step,
    updatedAt: now,
    projectId,
    runId,
    payload: {
      v: 1,
      draft: briefDraft,
      step,
      projectId,
      runId,
    },
  };
}

function runDetail() {
  return {
    run: {
      runId,
      projectId,
      status: "succeeded",
      currentStageType: "ready",
      progressPercent: 100,
      message: "Rough cut ready.",
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt: now,
    },
    stages: [
      {
        stageId: "stage-timeline",
        runId,
        type: "timeline_assembly",
        label: "Timeline assembly",
        order: 6,
        status: "succeeded",
        progressPercent: 100,
        startedAt: now,
        completedAt: now,
        jobIds: [],
        artifactIds: [timelineArtifactId],
        createdAt: now,
        updatedAt: now,
      },
    ],
    stageItems: [
      {
        itemId: "item-timeline",
        stageId: "stage-timeline",
        kind: "timeline",
        purpose: "timeline",
        label: "Rough cut timeline",
        status: "succeeded",
        progressPercent: 100,
        artifactId: timelineArtifactId,
        createdAt: now,
        updatedAt: now,
      },
    ],
    resultArtifacts: [
      {
        kind: "timeline",
        purpose: "timeline",
        artifactId: timelineArtifactId,
        stageId: "stage-timeline",
        itemId: "item-timeline",
      },
    ],
  };
}

function output() {
  return {
    artifactId: outputArtifactId,
    projectId,
    projectName: project.name,
    timelineId,
    url: mediaUrl,
    playbackUrl: mediaUrl,
    thumbnailUrl: "",
    durationSec: 8,
    format: "mp4",
    createdAt: now,
  };
}

export async function mockReviewExportApi(page: Page) {
  const calls: Array<{ method: string; pathname: string; body?: unknown }> = [];
  let exportPollCount = 0;

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const method = request.method();
    let body: unknown;
    if (method !== "GET" && request.postData()) {
      body = request.postDataJSON();
    }
    calls.push({ method, pathname, body });

    if (method === "GET" && pathname === "/api/v1/me") {
      return json(route, {
        actor: { id: "user-e2e", type: "local", email: "local@example.test" },
        workspaceId,
        workspaceName: "E2E Workspace",
        authMode: "local",
        isLocal: true,
      });
    }

    if (method === "GET" && pathname === `/api/v1/workspaces/${workspaceId}/studio-drafts`) {
      return json(route, { drafts: [draftRecord()] });
    }

    if (
      method === "GET" &&
      pathname === `/api/v1/workspaces/${workspaceId}/studio-drafts/${draftId}`
    ) {
      return json(route, { draft: draftRecord() });
    }

    if (
      method === "PUT" &&
      pathname === `/api/v1/workspaces/${workspaceId}/studio-drafts/${draftId}`
    ) {
      return json(route, { draft: draftRecord("review") });
    }

    if (
      method === "DELETE" &&
      pathname === `/api/v1/workspaces/${workspaceId}/studio-drafts/${draftId}`
    ) {
      return json(route, { ok: true });
    }

    if (
      method === "GET" &&
      pathname === `/api/v1/projects/${projectId}/generation-runs/${runId}`
    ) {
      return json(route, runDetail());
    }

    if (
      method === "GET" &&
      pathname ===
        `/api/v1/projects/${projectId}/generation-runs/${runId}/artifacts/${timelineArtifactId}`
    ) {
      return json(route, {
        artifact: {
          artifactId: timelineArtifactId,
          runId,
          stageId: "stage-timeline",
          kind: "timeline",
          content: { timeline },
          createdAt: now,
        },
        timelineId,
      });
    }

    if (method === "GET" && pathname === `/api/v1/projects/${projectId}`) {
      return json(route, { project });
    }

    if (method === "GET" && pathname === `/api/v1/workspaces/${workspaceId}/assets`) {
      return json(route, {
        assets: [
          {
            id: videoAssetId,
            assetId: videoAssetId,
            projectId,
            projectName: project.name,
            kind: "video",
            status: "ready",
            source: "generated",
            filename: "coffee-reveal.mp4",
            title: "Coffee reveal clip",
            description: "The source clip for the review timeline.",
            url: mediaUrl,
            thumbnailUrl: "",
            durationSec: 8,
            visibility: "private",
            createdAt: now,
            updatedAt: now,
          },
        ],
        pagination: { limit: 100, nextCursor: null },
      });
    }

    if (method === "GET" && pathname === `/api/v1/projects/${projectId}/timelines/latest`) {
      return json(route, { timeline });
    }

    if (
      method === "POST" &&
      pathname === `/api/v1/projects/${projectId}/timelines/${timelineId}/revisions`
    ) {
      return json(route, {
        job: {
          id: "revision-job-e2e",
          type: "timeline_revision",
          status: "queued",
          projectId,
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    if (
      method === "POST" &&
      pathname === `/api/v1/projects/${projectId}/timelines/${timelineId}/exports`
    ) {
      exportPollCount = 0;
      return json(route, {
        job: {
          id: exportJobId,
          type: "export",
          status: "running",
          projectId,
          step: "render",
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    if (method === "GET" && pathname === `/api/v1/projects/${projectId}/exports/${exportJobId}`) {
      exportPollCount += 1;
      return json(route, {
        job: {
          id: exportJobId,
          type: "export",
          status: exportPollCount >= 2 ? "succeeded" : "running",
          projectId,
          step: exportPollCount >= 2 ? "complete" : "render",
          result: exportPollCount >= 2 ? { artifactId: outputArtifactId } : {},
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    if (method === "GET" && pathname === `/api/v1/projects/${projectId}/artifacts/${outputArtifactId}`) {
      return json(route, {
        artifact: {
          id: outputArtifactId,
          projectId,
          kind: "video/mp4",
          status: "ready",
          url: mediaUrl,
          timelineId,
          durationSec: 8,
          createdAt: now,
        },
      });
    }

    if (method === "GET" && pathname === `/api/v1/workspaces/${workspaceId}/outputs`) {
      return json(route, {
        outputs: [output()],
        pagination: { limit: Number(url.searchParams.get("limit") ?? 24), nextCursor: null },
      });
    }

    if (method === "GET" && pathname === `/api/v1/projects/${projectId}/watch`) {
      return json(route, {
        media: {
          assetId: outputArtifactId,
          projectId,
          projectName: project.name,
          filename: "coffee-reveal-final.mp4",
          kind: "video",
          url: mediaUrl,
          posterUrl: "",
          durationSec: 8,
          expiresAt: "2026-06-16T13:00:00.000Z",
          createdAt: now,
          updatedAt: now,
        },
        fallback: {
          storyboardUrl: `/projects/${projectId}/storyboard`,
        },
      });
    }

    return json(
      route,
      {
        error: {
          code: "not_found",
          message: `Unhandled ${method} ${pathname}`,
        },
      },
      404,
    );
  });

  return {
    calls,
    projectId,
    draftId,
    timelineId,
    exportJobId,
    outputArtifactId,
  };
}
