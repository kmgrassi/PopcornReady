import {
  fitProjectAudioToPicture as realFitProjectAudioToPicture,
  parseAudioFitRequest,
  type AudioFitRequest,
  type AudioFitResponse,
} from "@/lib/api/v1/audio-fit";
import {
  releaseOrchestratorBudget as realReleaseBudget,
  settleOrchestratorBudget as realSettleBudget,
} from "@/lib/api/v1/orchestrator-budget-controls";
import {
  reserveRerunChildBudget as realReserveRerunChildBudget,
} from "@/lib/api/v1/rerun-lifecycle-store";
import { toolDefinitionMetadata } from "./capability-catalog";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";

export type FitAudioToPictureInput = AudioFitRequest;
export type FitAudioToPictureOutput = AudioFitResponse;

export interface FitAudioToPictureDeps {
  fitProjectAudioToPicture: typeof realFitProjectAudioToPicture;
  reserveRerunChildBudget: typeof realReserveRerunChildBudget;
  settleBudget: typeof realSettleBudget;
  releaseBudget: typeof realReleaseBudget;
}

const defaultDeps: FitAudioToPictureDeps = {
  fitProjectAudioToPicture: realFitProjectAudioToPicture,
  reserveRerunChildBudget: realReserveRerunChildBudget,
  settleBudget: realSettleBudget,
  releaseBudget: realReleaseBudget,
};

const str = { type: "string" } as const;
const num = { type: "number" } as const;

export const fitAudioToPictureInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    audioAssetId: str,
    pictureAssetId: str,
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
      const callback = context.domainTask?.approvalContext?.rerunCallback;
      const executionReservationId =
        context.domainTask?.approvalContext?.executionReservationId;
      const reservationKey = callback && context.actionId
        ? `rerun-local-tool:${context.actionId}`
        : undefined;
      if (callback) {
        if (
          !executionReservationId ||
          !context.orchestratorRunId ||
          !context.actionId ||
          !reservationKey
        ) {
          throw new ToolInputError(
            "Proposal picture fit is missing durable child causation."
          );
        }
        await resolved.reserveRerunChildBudget({
          projectId: context.projectId,
          executionReservationId,
          workItemId: callback.workItemId,
          actionId: context.actionId,
          childRunId: context.orchestratorRunId,
          reservationKey,
          estimatedUsd: 0,
        });
      }
      try {
        const result = await resolved.fitProjectAudioToPicture({
          auth: context.auth,
          projectId: context.projectId,
          request: input,
          orchestratorRunId: context.orchestratorRunId,
          actionId: context.actionId,
          selectResult: callback ? false : undefined,
        });
        if (reservationKey) {
          await resolved.settleBudget({
            projectId: context.projectId,
            reservationKey,
            actualUsd: 0,
          });
        }
        return {
          status: "succeeded",
          resourceIds: [result.critiqueAssetId],
          artifactIds: [result.critiqueAssetId],
          output: result,
        };
      } catch (error) {
        if (reservationKey) {
          await resolved.releaseBudget({
            projectId: context.projectId,
            reservationKey,
            reason: "rerun_audio_fit_failed",
          });
        }
        throw error;
      }
    },
  };
}
