import {
  fitProjectAudioToPicture as realFitProjectAudioToPicture,
  parseAudioFitRequest,
  type AudioFitRequest,
  type AudioFitResponse,
} from "@/lib/api/v1/audio-fit";
import { toolDefinitionMetadata } from "./capability-catalog";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";

export type FitAudioToPictureInput = AudioFitRequest;
export type FitAudioToPictureOutput = AudioFitResponse;

export interface FitAudioToPictureDeps {
  fitProjectAudioToPicture: typeof realFitProjectAudioToPicture;
}

const defaultDeps: FitAudioToPictureDeps = {
  fitProjectAudioToPicture: realFitProjectAudioToPicture,
};

const str = { type: "string" } as const;
const num = { type: "number" } as const;

export const fitAudioToPictureInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    audioAssetId: str,
    beatId: str,
    options: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxRetime: num,
      },
    },
  },
  required: ["audioAssetId", "beatId"],
} as const;

export const fitAudioToPictureOutputSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    audioAssetId: str,
    beatId: str,
    critiqueAssetId: str,
    verdict: { type: "string", enum: ["ok", "needs_review", "fail"] },
    requiresApproval: { type: "boolean" },
  },
  required: ["audioAssetId", "beatId", "critiqueAssetId", "verdict", "requiresApproval"],
} as const;

export function parseFitAudioToPictureInput(input: unknown): FitAudioToPictureInput {
  try {
    return parseAudioFitRequest(input);
  } catch (error) {
    throw new ToolInputError(
      error instanceof Error ? error.message : "fit_audio_to_picture input is invalid.",
      { expected: fitAudioToPictureInputSchema }
    );
  }
}

function missingProject(): ToolCallResult<FitAudioToPictureOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "fit_audio_to_picture requires a projectId in the execution context.",
      recoverable: false,
    },
  };
}

export function createFitAudioToPictureTool(
  deps: Partial<FitAudioToPictureDeps> = {}
): ToolDefinition<FitAudioToPictureInput, FitAudioToPictureOutput> {
  const resolved = { ...defaultDeps, ...deps };

  return {
    ...toolDefinitionMetadata("fit_audio_to_picture"),
    description:
      "Fit a generated audio segment to a beat window, persist a sync critique, and flag segments that need review.",
    usage: {
      preconditions: [
        "A ready audio asset exists.",
        "The project has an active shot plan containing the target beat id.",
      ],
      produces: [
        "A persisted audio_fit critique asset with placement, retime, verdict, and staged retreat reasons.",
      ],
      useWhen: [
        "Generated voiceover or dialogue must be checked against a target beat before approval or export.",
      ],
    },
    inputSchema: fitAudioToPictureInputSchema,
    outputSchema: fitAudioToPictureOutputSchema,
    parseInput: parseFitAudioToPictureInput,
    estimateCost: () => ({
      estimatedCostUsd: 0,
      unit: "local_math",
      notes: "Audio fit is deterministic arithmetic over known durations.",
    }),
    async execute(input, context) {
      if (!context.projectId) return missingProject();
      const result = await resolved.fitProjectAudioToPicture({
        auth: context.auth,
        projectId: context.projectId,
        request: input,
        orchestratorRunId: context.orchestratorRunId,
      });
      return {
        status: "succeeded",
        resourceIds: [result.critiqueAssetId],
        artifactIds: [result.critiqueAssetId],
        output: result,
      };
    },
  };
}
