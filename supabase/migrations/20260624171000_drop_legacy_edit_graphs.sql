-- Retire the legacy timeline-forward EditGraph persistence surface.
-- The replacement asset graph stores provenance in assets, asset_edges,
-- selections, and actions.
drop table if exists public.edit_graphs;
