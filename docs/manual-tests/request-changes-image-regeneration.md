# Request Changes: Image Regeneration

Verify that a Request Changes submission on an existing image creates a new
immutable image version rather than silently completing the run.

## Setup

1. Open a project that has at least one generated image tile, keyframe, or
   visual anchor.
2. Open the image in the project/run view and choose **Request Changes**.
3. Enter an unmistakable replacement prompt, for example: “Make the storefront
   colder, rainier, and lit by blue neon.”

## Expected result

1. Submitting the request creates or resumes a generation run; it must not
   immediately complete with only a `board_feedback` action.
2. The run activity shows a `regenerate_image_asset` action after the feedback
   action.
3. The replacement image renders in the same tile after the action succeeds.
4. Reload the page. The replacement image remains selected and visible.
5. In the asset graph or API data, verify the previous image was preserved and
   the replacement is a higher version in the same lineage.

## Failure signals

- The run succeeds without a `regenerate_image_asset` action.
- The original image remains selected after a successful action.
- The request creates a new clip, edits video, or regenerates unrelated anchors.
- The request reports success but the replacement image cannot be loaded.
