-- Add a genuine standalone image kind to the immutable asset graph.
-- The follow-up migration wires it into constraints and generated refs.
alter type public.graph_asset_kind add value if not exists 'image';
