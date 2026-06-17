-- Add 'story_blueprint' to graph_asset_kind. The follow-up migration wires the
-- value into constraints/functions after this enum change has committed.

alter type graph_asset_kind add value if not exists 'story_blueprint';
