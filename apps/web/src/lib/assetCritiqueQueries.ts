import { useMutation } from "@tanstack/react-query";
import { v1Api } from "./api-client";

export function useAssetCritiqueMutation(projectId: string, assetId: string) {
  return useMutation({
    mutationFn: (input: { question: string; idempotencyKey: string }) =>
      v1Api.createAssetCritique(
        projectId,
        assetId,
        input.question,
        input.idempotencyKey,
      ),
    meta: { errorMessage: "Could not receive AI feedback" },
  });
}
