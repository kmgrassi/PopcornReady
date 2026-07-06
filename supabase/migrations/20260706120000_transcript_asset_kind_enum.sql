-- Add 'transcript' to graph_asset_kind. The follow-up migration wires the value
-- into constraints and trigger functions after this enum change has committed.

alter type graph_asset_kind add value if not exists 'transcript';
