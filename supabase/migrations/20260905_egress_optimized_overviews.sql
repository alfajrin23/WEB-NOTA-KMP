create index if not exists generated_notes_dashboard_stats_idx
  on public.generated_notes(project_id, tahap, vendor_id, document_type);

create index if not exists custom_notes_dashboard_stats_idx
  on public.custom_notes(project_id, tahap, vendor_id, document_type);

create index if not exists belanja_sync_jobs_project_created_idx
  on public.belanja_sync_jobs(project_id, created_at desc, id desc);

create index if not exists belanja_sync_items_job_source_updated_idx
  on public.belanja_sync_items(job_id, source_resume_item_id, updated_at desc, created_at desc, id desc);

create or replace view public.dashboard_note_stats_v1
with (security_invoker = true)
as
with note_rows as (
  select
    project_id,
    tahap,
    nullif(trim(vendor), '') as vendor,
    nullif(trim(vendor_id), '') as vendor_id,
    document_type,
    total,
    false as is_custom
  from public.generated_notes
  union all
  select
    project_id,
    tahap,
    nullif(trim(vendor), '') as vendor,
    nullif(trim(vendor_id), '') as vendor_id,
    document_type,
    total,
    true as is_custom
  from public.custom_notes
),
grouped as (
  select
    project_id,
    tahap,
    coalesce(vendor_id, vendor, 'vendor-tanpa-id') as vendor_id,
    coalesce(vendor, vendor_id, 'Tanpa vendor') as vendor_name,
    count(*) filter (where document_type = 'nota') as nota_count,
    count(*) filter (where document_type <> 'nota') as kwitansi_count,
    count(*) filter (where not is_custom) as generated_note_count,
    count(*) filter (where is_custom) as custom_note_count,
    coalesce(sum(total) filter (where document_type = 'nota'), 0)::numeric(18,2) as nota_total,
    coalesce(sum(total) filter (where document_type <> 'nota'), 0)::numeric(18,2) as kwitansi_total
  from note_rows
  group by project_id, tahap, coalesce(vendor_id, vendor, 'vendor-tanpa-id'), coalesce(vendor, vendor_id, 'Tanpa vendor')
)
select
  project_id,
  tahap,
  vendor_id,
  vendor_name,
  greatest(nota_count, kwitansi_count)::integer as document_count,
  case
    when nota_count > 0 then nota_total
    else kwitansi_total
  end as total,
  generated_note_count::integer,
  custom_note_count::integer
from grouped;

create or replace view public.dashboard_project_note_counts_v1
with (security_invoker = true)
as
select
  project_id,
  coalesce(sum(document_count), 0)::integer as nota_count,
  coalesce(sum(generated_note_count), 0)::integer as generated_note_count,
  coalesce(sum(custom_note_count), 0)::integer as custom_note_count
from public.dashboard_note_stats_v1
group by project_id;

create or replace view public.latest_note_history_v1
with (security_invoker = true)
as
select distinct on (project_id)
  id,
  project_id,
  action,
  description,
  created_at
from public.note_history
where project_id is not null
order by project_id, created_at desc, id desc;

create or replace view public.belanja_sync_project_overview_v1
with (security_invoker = true)
as
with ranked_jobs as (
  select
    j.*,
    row_number() over (partition by j.project_id order by j.created_at desc, j.id desc) as job_rank
  from public.belanja_sync_jobs j
),
latest_jobs as (
  select *
  from ranked_jobs
  where job_rank = 1
),
latest_items as (
  select distinct on (i.job_id, i.source_resume_item_id)
    i.*
  from public.belanja_sync_items i
  join latest_jobs j on j.id = i.job_id
  order by i.job_id, i.source_resume_item_id, i.updated_at desc, i.created_at desc, i.id desc
)
select
  j.project_id,
  j.id as latest_job_id,
  j.created_at as latest_job_created_at,
  jsonb_build_object(
    'id', j.id,
    'project_id', j.project_id,
    'status', j.status,
    'dry_run', j.dry_run,
    'total_items', j.total_items,
    'success_items', j.success_items,
    'failed_items', j.failed_items,
    'skipped_items', j.skipped_items,
    'created_at', j.created_at,
    'updated_at', j.updated_at,
    'started_at', j.started_at,
    'finished_at', j.finished_at,
    'error_message', j.error_message,
    'metadata_json', j.metadata_json
  ) as latest_job_json,
  coalesce(f.failed_details, '[]'::jsonb) as failed_details
from latest_jobs j
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'sourceResumeItemId', item.source_resume_item_id,
      'itemName', coalesce(item.payload_json->>'namaItem', ''),
      'tanggal', coalesce(item.payload_json->>'tanggal', ''),
      'jumlah',
        case
          when coalesce(item.payload_json->>'jumlah', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
            then (item.payload_json->>'jumlah')::numeric
          else 0
        end,
      'status', item.status,
      'errorMessage', coalesce(item.error_message, 'Item gagal tanpa pesan error dari runner.'),
      'updatedAt', item.updated_at
    )
    order by item.updated_at desc, item.created_at desc, item.id desc
  ) as failed_details
  from (
    select *
    from latest_items li
    where li.job_id = j.id
      and li.status in ('failed', 'needs_review')
    order by li.updated_at desc, li.created_at desc, li.id desc
    limit 5
  ) item
) f on true;

grant select on public.dashboard_note_stats_v1 to anon, authenticated, service_role;
grant select on public.dashboard_project_note_counts_v1 to anon, authenticated, service_role;
grant select on public.latest_note_history_v1 to anon, authenticated, service_role;
revoke all on public.belanja_sync_project_overview_v1 from anon, authenticated;
grant select on public.belanja_sync_project_overview_v1 to service_role;

notify pgrst, 'reload schema';
