create or replace view public.history_resume_totals_v1
with (security_invoker = true)
as
select
  project_id,
  coalesce(sum(
    case
      when is_included_in_resume_total is false then 0
      when is_jumlah_manual is true then coalesce(jumlah_override, jumlah, 0)
      else coalesce(qty, 0) * coalesce(harga_satuan, 0)
    end
  ), 0)::numeric(18,2) as total_resume,
  max(updated_at) as updated_at
from public.resume_items
group by project_id;

grant select on public.history_resume_totals_v1 to anon, authenticated, service_role;

notify pgrst, 'reload schema';
