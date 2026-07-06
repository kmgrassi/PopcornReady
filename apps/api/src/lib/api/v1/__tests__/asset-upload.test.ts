import assert from "node:assert/strict";
import test from "node:test";
import { assertProjectUploadPath, createAssetUploadUrl } from "../asset-upload";

test("assertProjectUploadPath accepts only the project upload prefix", () => {
  assert.doesNotThrow(() =>
    assertProjectUploadPath({
      workspaceId: "ws_1",
      projectId: "proj_1",
      path: "ws_1/proj_1/uploads/upload_1/clip.mp4",
    })
  );

  assert.throws(
    () =>
      assertProjectUploadPath({
        workspaceId: "ws_1",
        projectId: "proj_1",
        path: "ws_1/proj_2/uploads/upload_1/clip.mp4",
      }),
    /project upload prefix/
  );
  assert.throws(
    () =>
      assertProjectUploadPath({
        workspaceId: "ws_1",
        projectId: "proj_1",
        path: "ws_1/proj_1/uploads/../clip.mp4",
      }),
    /project upload prefix/
  );
});

test("createAssetUploadUrl scopes local signed paths under the project", async () => {
  const upload = await createAssetUploadUrl({
    workspaceId: "ws_1",
    projectId: "proj_1",
    filename: "../clip.mp4",
    visibility: "public",
    contentType: "video/mp4",
    config: {
      backend: "local",
      localMediaDir: "/tmp/popcornready-media",
      localUrlBase: "http://localhost:4000",
      region: "us-east-1",
      publicBucket: "assets-public",
      privateBucket: "assets-private",
      publicUrlBase: "",
      forcePathStyle: false,
    },
  });

  assert.match(upload.path, /^ws_1\/proj_1\/uploads\/[^/]+\/clip\.mp4$/);
  assert.match(
    upload.signedUrl,
    /^http:\/\/localhost:4000\/api\/v1\/projects\/proj_1\/assets\/upload-url\/local\?token=/
  );
  assert.ok(Date.parse(upload.expiresAt) > Date.now());
});
