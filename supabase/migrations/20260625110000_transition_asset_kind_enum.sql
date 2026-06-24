-- Add 'transition' to graph_asset_kind. The follow-up migration
-- (20260625120000_transition_asset_kind.sql) wires the value into the
-- assets_kind_media constraint and assets_set_ref after this enum change has
-- committed — a new enum value cannot be referenced in the same transaction
-- that adds it.

alter type graph_asset_kind add value if not exists 'transition';
