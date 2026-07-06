-- Add 'audio_mix' to graph_asset_kind. The follow-up migration wires the value
-- into assets_kind_media and creates relational mix-layer rows after this enum
-- change has committed.

alter type graph_asset_kind add value if not exists 'audio_mix';
