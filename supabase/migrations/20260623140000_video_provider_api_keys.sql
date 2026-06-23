-- Add newly supported video/image provider keys to the BYO-key enum.

alter type public.model_provider add value if not exists 'kling';
alter type public.model_provider add value if not exists 'seedance';
alter type public.model_provider add value if not exists 'xai';
