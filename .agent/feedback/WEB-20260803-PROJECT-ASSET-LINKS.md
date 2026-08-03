# Feedback: WEB-20260803-PROJECT-ASSET-LINKS

Related worksheet: [WEB-20260803-PROJECT-ASSET-LINKS](../worksheets/WEB-20260803-PROJECT-ASSET-LINKS.md)

<!-- agent-summary: Asset-detail links need durable asset identity plus project scope. -->
<!-- agent-summary: A query-param detail view must hydrate assets outside the first collection page. -->
<!-- agent-summary: Preview navigation and creation selection should remain separate controls. -->
<!-- agent-summary: Presentational media components should not own links when callers may already be links. -->
<!-- agent-summary: Unknown visibility must suppress visibility mutations rather than guess current state. -->
<!-- agent-summary: Public project media must not link into authenticated workspace collections. -->
<!-- agent-summary: Browser checks should cover canonical viewer open, close, keyboard, and mobile overflow. -->

## Lesson

Changing a project thumbnail into a link was only half the behavior. The
canonical asset viewer originally resolved `assetId` only from the workspace
assets already loaded on the first page, so an older project asset could land on
the correct URL without opening any detail. Including project scope in generated
links and hydrating the exact project asset made the destination durable without
forcing the whole workspace collection to paginate.

The exact project-asset response does not expose visibility in the web contract.
Guessing would have produced a misleading mutation label, so the canonical
viewer now withholds that action for exact-hydrated assets until visibility is
known.

The canonical viewer and Request Changes dialog are both full-screen overlays
with independent Escape handling. For an asset edit, retaining the selected
asset while temporarily unmounting the viewer avoids stacked-modal behavior and
preserves the deep-link URL. A stable asset/media snapshot keeps the proposal
target from changing while the dialog is open.

Production project-asset detail responses use `remoteUrl` for resolved media,
even though the shared client asset type historically expected `url`. A usable
thumbnail can make the media seed look complete and suppress a refresh, so the
detail boundary must represent that runtime field and normalize it before the
viewer decides whether it has playable media.

Canonical preview navigation unmounts project media, so its local creation
selection and intent need an explicit handoff. A versioned, project-keyed
session stash written only when preview opens and consumed on return preserves
the interrupted task without introducing global state or resurrecting unrelated
old drafts. In React Strict Mode, the restored value must remain readable across
the double initializer call and be cleared in the mount effect, not consumed
inside the initializer itself.

## Follow-up

If standalone `assetId` URLs must become reliable for assets outside the loaded
workspace page, add a workspace-scoped exact asset metadata endpoint or another
direct lookup that does not require `projectId`. Also consider exposing project
display name and visibility in the exact project-asset contract so the canonical
viewer can show all collection-backed actions for deep-linked assets.
