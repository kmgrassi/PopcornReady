import { useMutation, useQueryClient } from "@tanstack/react-query";
import { v1Api } from "./api-client";
import { queryKeys } from "./queryClient";

// Generate (or regenerate) a scene's disposable cartoon wireframe. The server
// runs the sketch generation synchronously and points scene_asset_id at it, so
// on success we just refetch the storyboard to pick up the new image.
export function useGenerateSceneWireframeMutation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      storyboardId,
      sceneId,
      prompt,
    }: {
      storyboardId: string;
      sceneId: string;
      prompt?: string;
    }) => v1Api.generateSceneWireframe(projectId, storyboardId, sceneId, { prompt }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projectStoryboard(projectId),
      });
    },
  });
}
