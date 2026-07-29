-- Replay the audio_mix enum value for environments that recorded the
-- transcript migration under the historical 20260706120000 collision.
-- Keep this enum-only migration before 20260727181000 so PostgreSQL commits
-- the value before the combined asset constraint and ref trigger use it.

alter type public.graph_asset_kind add value if not exists 'audio_mix';
