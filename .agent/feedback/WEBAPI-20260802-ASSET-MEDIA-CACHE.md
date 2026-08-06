# Feedback: WEBAPI-20260802-ASSET-MEDIA-CACHE

<!-- agent-summary: Task feedback for missing asset bytes and expiring signed media URLs. -->
<!-- agent-summary: A valid signature cannot compensate for a storage key absent from both buckets. -->
<!-- agent-summary: Signed URL state must be scoped by auth identity, workspace, and asset id. -->
<!-- agent-summary: Lists may project credentials but must not become the browser's credential cache. -->
<!-- agent-summary: Immutable byte caching requires every replacement to receive a new object key. -->
<!-- agent-summary: Visibility copies preserve response metadata but rewrite the target cache scope. -->
<!-- agent-summary: This feedback ships with worksheet WEBAPI-20260802-ASSET-MEDIA-CACHE. -->

## Lesson

`NoSuchKey` is a byte-lifecycle failure, not primarily a signing failure. The
reported URL was freshly signed, yet the key did not exist in either delivery
bucket or either version listing. A focused existence check gives the UI a
truthful null result while keeping ambiguous infrastructure failures visible.

Signed credentials and immutable bytes need different cache policies. API list
JSON is transient authorization state and stays `private, no-store`. The object
response is long-lived and immutable, so the browser may cache it for a year;
the client preserves and reuses the exact fresh URL long enough for that byte
cache to be effective.

## Follow-up

- Regenerate or restore the incident asset from its recorded storyboard
  provenance; the authenticated projection identifies the row and legacy
  public-bucket alias, but action-table history remains unavailable.
- Enable and retain S3 data events if deletion attribution is operationally
  required; bucket versioning alone does not prove who moved or removed a key.
- Keep overwrite checks in every future asset writer. A one-year immutable
  directive is only correct when changed bytes always mint a new key.
