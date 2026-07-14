import type { ToolBattery } from "../types";

export const regenerateImageAssetBattery: ToolBattery = {
  tool: "regenerate_image_asset",
  cases: [
    {
      name: "regenerates a selected image as a new immutable version",
      instruction:
        "Regenerate the selected image asset with a colder, rainier blue-neon bakery storefront. Use provider mock.",
      // The generic tool-test harness cannot inject a freshly seeded asset UUID
      // into the model turn. The targeted unit test plus UI manual test cover
      // this until the harness supports setup-produced tool inputs.
      status: "pending",
    },
  ],
};
