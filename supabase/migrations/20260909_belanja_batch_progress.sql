create or replace view public.belanja_sync_batch_progress_v1
with (security_invoker = true)
as
select
  j.id,
  j.project_id,
  j.status,
  j.dry_run,
  j.total_items,
  j.success_items,
  j.failed_items,
  j.skipped_items,
  j.created_at,
  j.started_at,
  j.finished_at,
  j.error_message,
  nullif(j.metadata_json->>'stage', '') as stage,
  coalesce(
    nullif(j.metadata_json->>'stage_message', ''),
    nullif(j.metadata_json->>'stageMessage', '')
  ) as stage_message,
  case
    when jsonb_typeof(j.metadata_json->'progress') = 'object'
      then j.metadata_json->'progress'
    else '{}'::jsonb
  end as progress_json,
  case
    when jsonb_typeof(j.metadata_json->'report'->'errors') = 'array'
      then j.metadata_json->'report'->'errors'
    else '[]'::jsonb
  end as error_details
from public.belanja_sync_jobs j;

revoke all on public.belanja_sync_batch_progress_v1 from anon, authenticated;
grant select on public.belanja_sync_batch_progress_v1 to service_role;

notify pgrst, 'reload schema';
