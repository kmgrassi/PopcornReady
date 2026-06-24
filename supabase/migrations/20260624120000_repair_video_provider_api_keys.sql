-- Repair the other half of the 20260623140000 migration timestamp collision.
--
-- Some databases may have recorded 20260623140000 for the original
-- model-call-cost sidecar migration before the video-provider migration with
-- the same version could run. Reapply those enum additions under a unique
-- version so BYO-key upserts can accept every supported provider.

alter type public.model_provider add value if not exists 'kling';
alter type public.model_provider add value if not exists 'seedance';
alter type public.model_provider add value if not exists 'xai';
