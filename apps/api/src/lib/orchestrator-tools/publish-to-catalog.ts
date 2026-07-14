import {
  createAction as realCreateAction,
  updateAction as realUpdateAction,
  type V1Action,
} from "@/lib/api/v1/store";
import { publishCatalogEntry as realPublishCatalogEntry } from "@/lib/api/v1/catalog";
import { SYSTEM_PUBLISHER_WORKSPACE_ID } from "@/lib/api/v1/system-identity";
import { toolDefinitionMetadata } from "./capability-catalog";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";

type CatalogKind = "image" | "character" | "story";
const CATALOG_KINDS: CatalogKind[] = ["image", "character", "story"];

export interface PublishToCatalogInput {
  kind: CatalogKind;
  title: string;
  sourceAssetId?: string;
  sourceStoryBlueprintId?: string;
  summary?: string;
  tags?: string[];
}

export interface PublishToCatalogOutput {
  catalogEntryId: string;
  kind: CatalogKind;
  title: string;
}

export interface PublishToCatalogDeps {
  publishCatalogEntry: typeof realPublishCatalogEntry;
  createAction: typeof realCreateAction;
  updateAction: typeof realUpdateAction;
}

const defaultDeps: PublishToCatalogDeps = {
  publishCatalogEntry: realPublishCatalogEntry,
  createAction: realCreateAction,
  updateAction: realUpdateAction,
};

const str = { type: "string" } as const;

export const publishToCatalogInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { ...str, enum: CATALOG_KINDS, description: "What to publish: image, character, or story." },
    title: { ...str, description: "Short, human title shown in the catalog." },
    sourceAssetId: {
      ...str,
      description: "Asset id to publish (required for image/character). An image asset; character requires an anchor image.",
    },
    sourceStoryBlueprintId: {
      ...str,
      description: "Story blueprint id to publish (required for story).",
    },
    summary: { ...str, description: "Optional one-line description." },
    tags: { type: "array", items: str, description: "Optional tags for discovery." },
  },
  required: ["kind", "title"],
} as const;

export const publishToCatalogOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    catalogEntryId: str,
    kind: { ...str, enum: CATALOG_KINDS },
    title: str,
  },
  required: ["catalogEntryId", "kind", "title"],
} as const;

export function parsePublishToCatalogInput(input: unknown): PublishToCatalogInput {
  if (!input || typeof input !== "object") {
    throw new ToolInputError("publish_to_catalog requires an object input.");
  }
  const record = input as Record<string, unknown>;
  const kind = record.kind;
  if (typeof kind !== "string" || !CATALOG_KINDS.includes(kind as CatalogKind)) {
    throw new ToolInputError("kind must be one of: image, character, story.");
  }
  const title = record.title;
  if (typeof title !== "string" || title.trim().length === 0) {
    throw new ToolInputError("title is required.");
  }
  const sourceAssetId = optionalString(record.sourceAssetId, "sourceAssetId");
  const sourceStoryBlueprintId = optionalString(record.sourceStoryBlueprintId, "sourceStoryBlueprintId");
  if (kind === "story" && !sourceStoryBlueprintId) {
    throw new ToolInputError("story entries require sourceStoryBlueprintId.");
  }
  if (kind !== "story" && !sourceAssetId) {
    throw new ToolInputError(`${kind} entries require sourceAssetId.`);
  }
  return {
    kind: kind as CatalogKind,
    title: title.trim(),
    sourceAssetId,
    sourceStoryBlueprintId,
    summary: optionalString(record.summary, "summary"),
    tags: optionalStringArray(record.tags),
  };
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ToolInputError(`${field} must be a string.`);
  return value.trim() || undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new ToolInputError("tags must be an array of strings.");
  }
  return value as string[];
}

export function createPublishToCatalogTool(
  deps: Partial<PublishToCatalogDeps> = {}
): ToolDefinition<PublishToCatalogInput, PublishToCatalogOutput> {
  const resolved = { ...defaultDeps, ...deps };

  return {
    ...toolDefinitionMetadata("publish_to_catalog"),
    description:
      "Publish a generated image, character anchor, or story to the shared public catalog so any user can browse and copy it into their own project. The entry is attributed to the platform's system publisher, not the requesting user — use this to fulfill requests like 'create a set of public assets others can grab'.",
    usage: {
      preconditions: [
        "A ready image/anchor asset (sourceAssetId) or story blueprint (sourceStoryBlueprintId) exists in the project.",
      ],
      produces: [
        "A public catalog entry owned by the system publisher; the catalog copies the asset bytes into a public bucket, so the source project can stay private.",
      ],
      useWhen: [
        "The user asked for shareable / public / catalog assets that other users can grab.",
        "A generated anchor or story is good enough to offer to all users.",
      ],
    },
    inputSchema: publishToCatalogInputSchema,
    outputSchema: publishToCatalogOutputSchema,
    parseInput: parsePublishToCatalogInput,
    estimateCost: () => ({
      estimatedCostUsd: 0,
      unit: "model_call",
      notes: "Publishing copies an existing asset's bytes into the public catalog bucket; no generation.",
    }),
    async execute(input, context): Promise<ToolCallResult<PublishToCatalogOutput>> {
      if (!context.projectId) {
        return {
          status: "failed",
          error: {
            kind: "precondition_unmet",
            message: "publish_to_catalog requires a projectId in the execution context.",
            recoverable: false,
          },
        };
      }

      let action: V1Action | null = null;
      try {
        action = await resolved.createAction({
          projectId: context.projectId,
          orchestratorRunId: context.orchestratorRunId,
          tool: "publish_to_catalog",
          status: "running",
          params: { kind: input.kind, title: input.title },
          inputAssetIds: input.sourceAssetId ? [input.sourceAssetId] : [],
          rationale: "Publish a generated asset/story to the public catalog under the system publisher.",
        });

        const entry = await resolved.publishCatalogEntry({
          // Read the source asset from the run's workspace, but attribute the
          // entry to the system publisher so it isn't owned by the end user.
          authWorkspaceId: context.auth.workspaceId,
          publisherWorkspaceId: SYSTEM_PUBLISHER_WORKSPACE_ID,
          body: {
            kind: input.kind,
            title: input.title,
            sourceAssetId: input.sourceAssetId,
            sourceStoryBlueprintId: input.sourceStoryBlueprintId,
            summary: input.summary,
            tags: input.tags ?? [],
            status: "published",
          },
        });

        await resolved.updateAction(action.id, { status: "applied", outputAssetIds: [] });

        return {
          status: "succeeded",
          resourceIds: [entry.id],
          output: { catalogEntryId: entry.id, kind: input.kind, title: input.title },
        };
      } catch (error) {
        if (action) {
          await resolved.updateAction(action.id, {
            status: "failed",
            error: {
              code: "catalog_publish_failed",
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
        return {
          status: "failed",
          error: {
            kind: "provider_failed",
            message: error instanceof Error ? error.message : String(error),
            recoverable: true,
          },
        };
      }
    },
  };
}
