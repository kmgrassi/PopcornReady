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

test("presigned S3 upload contracts require immutable cache metadata", async () => {
  const previousAccessKey = process.env.AWS_ACCESS_KEY_ID;
  const previousSecret = process.env.AWS_SECRET_ACCESS_KEY;
  process.env.AWS_ACCESS_KEY_ID = "test";
  process.env.AWS_SECRET_ACCESS_KEY = "test";
  try {
    const upload = await createAssetUploadUrl({
      workspaceId: "ws_1",
      projectId: "proj_1",
      filename: "clip.png",
      visibility: "private",
      contentType: "image/png",
      config: {
        backend: "s3",
        localMediaDir: "/tmp/popcornready-media",
        localUrlBase: "http://localhost:4000",
        region: "us-east-1",
        publicBucket: "assets-public",
        privateBucket: "assets-private",
        publicUrlBase: "https://cdn.example.com",
        s3EndpointUrl: "http://localhost:9000",
        forcePathStyle: true,
      },
    });

    assert.match(upload.signedUrl, /^http:\/\/localhost:9000\/assets-private\//);
    assert.deepEqual(upload.requiredHeaders, {
      "Cache-Control": "private, max-age=31536000, immutable",
    });
  } finally {
    if (previousAccessKey === undefined) delete process.env.AWS_ACCESS_KEY_ID;
    else process.env.AWS_ACCESS_KEY_ID = previousAccessKey;
    if (previousSecret === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
    else process.env.AWS_SECRET_ACCESS_KEY = previousSecret;
  }
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
  assert.deepEqual(upload.requiredHeaders, {
    "Cache-Control": "public, max-age=31536000, immutable",
  });
});
