create unique index if not exists belanja_sync_jobs_active_idempotency_idx
  on public.belanja_sync_jobs ((metadata_json->>'idempotency_key'))
  where status in ('pending', 'processing')
    and coalesce(metadata_json->>'operation_type', 'legacy_item_submit') = 'copy_reconcile_v1'
    and metadata_json ? 'idempotency_key';

create index if not exists belanja_sync_jobs_operation_stage_idx
  on public.belanja_sync_jobs (
    (coalesce(metadata_json->>'operation_type', 'legacy_item_submit')),
    (metadata_json->>'stage')
  );

notify pgrst, 'reload schema';
