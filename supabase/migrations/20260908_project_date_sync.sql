create or replace function public.shift_project_dates(
  p_project_id uuid,
  p_anchor text,
  p_new_date date
)
returns table (
  project_id uuid,
  shift_days integer,
  project_date date,
  report_date date,
  shifted_items bigint
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project_date date;
  v_report_date date;
  v_shift_days integer := 0;
  v_shifted_items bigint := 0;
begin
  if p_new_date is null then
    raise exception 'Tanggal baru wajib diisi.' using errcode = '22004';
  end if;

  if p_anchor not in ('project', 'report') then
    raise exception 'Anchor tanggal tidak valid: %', p_anchor using errcode = '22023';
  end if;

  select p.project_date, p.tanggal_laporan
    into v_project_date, v_report_date
  from public.projects p
  where p.id = p_project_id
  for update;

  if not found then
    raise exception 'Project tidak ditemukan: %', p_project_id using errcode = 'P0002';
  end if;

  if v_project_date is null then
    raise exception 'Tanggal Awal Project belum tersedia.' using errcode = '22004';
  end if;

  if p_anchor = 'project' then
    v_shift_days := p_new_date - v_project_date;

    update public.projects
    set project_date = p_new_date,
        tanggal_laporan = case
          when v_report_date is null then p_new_date
          else v_report_date + v_shift_days
        end,
        updated_at = now()
    where id = p_project_id;

    if v_shift_days <> 0 then
      update public.resume_items
      set tanggal = tanggal + v_shift_days,
          updated_at = now()
      where resume_items.project_id = p_project_id
        and tanggal is not null;
      get diagnostics v_shifted_items = row_count;
    end if;
  else
    -- Resume item dates are always anchored to Tanggal Awal Project.
    -- Changing Tanggal laporan updates report/document metadata only and must
    -- never shift resume item dates a second time.
    update public.projects
    set tanggal_laporan = p_new_date,
        updated_at = now()
    where id = p_project_id;

    v_shift_days := 0;
    v_shifted_items := 0;
  end if;

  return query
  select p.id,
         v_shift_days,
         p.project_date,
         p.tanggal_laporan,
         v_shifted_items
  from public.projects p
  where p.id = p_project_id;
end;
$$;

comment on function public.shift_project_dates(uuid, text, date) is
'Atomically shifts resume item dates only when Tanggal Awal Project changes. Tanggal laporan updates metadata only so item dates cannot be double-shifted.';
