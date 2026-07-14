create extension if not exists "pgcrypto";

do $$ begin
  create type project_status as enum ('draft', 'review', 'generated', 'archived');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type generated_note_status as enum ('draft', 'generated', 'reviewed', 'exported', 'archived');
exception
  when duplicate_object then null;
end $$;

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  nama_desa text not null,
  kecamatan text not null,
  kabupaten text not null,
  nama_project text not null,
  wilayah text not null,
  kodim text,
  tanggal_laporan date not null,
  project_date date not null default current_date,
  metadata_json jsonb not null default '{}'::jsonb,
  status project_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists resume_stages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  stage_id text not null,
  stage_name text not null,
  sort_order integer not null default 0,
  source_total numeric(18,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, stage_id)
);

create table if not exists resume_categories (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  stage_id text not null,
  category_code text not null,
  category_name text not null,
  sort_order integer not null default 0,
  source_total numeric(18,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, stage_id, category_code)
);

alter table projects add column if not exists nama_desa text;
alter table projects add column if not exists kecamatan text;
alter table projects add column if not exists kabupaten text;
alter table projects add column if not exists nama_project text;
alter table projects add column if not exists wilayah text;
alter table projects add column if not exists kodim text;
alter table projects add column if not exists tanggal_laporan date;
alter table projects add column if not exists project_date date default current_date;
alter table projects add column if not exists metadata_json jsonb not null default '{}'::jsonb;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name = 'template_id') then
    execute 'alter table projects alter column template_id drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name = 'project_name') then
    execute 'alter table projects alter column project_name drop not null';
    execute 'update projects set nama_project = coalesce(nama_project, project_name)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name = 'village_name') then
    execute 'alter table projects alter column village_name drop not null';
    execute 'update projects set nama_desa = coalesce(nama_desa, village_name)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name = 'district_name') then
    execute 'alter table projects alter column district_name drop not null';
    execute 'update projects set kecamatan = coalesce(kecamatan, district_name)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name = 'regency_name') then
    execute 'alter table projects alter column regency_name drop not null';
    execute 'update projects set kabupaten = coalesce(kabupaten, regency_name)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name = 'region_name') then
    execute 'alter table projects alter column region_name drop not null';
    execute 'update projects set wilayah = coalesce(wilayah, region_name), kodim = coalesce(kodim, region_name)';
  end if;
  update projects
  set
    nama_desa = coalesce(nama_desa, ''),
    kecamatan = coalesce(kecamatan, ''),
    kabupaten = coalesce(kabupaten, ''),
    nama_project = coalesce(nama_project, ''),
    wilayah = coalesce(wilayah, ''),
    tanggal_laporan = coalesce(tanggal_laporan, project_date, current_date),
    project_date = coalesce(project_date, tanggal_laporan, current_date);
end $$;

create table if not exists resume_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  tahap text not null,
  stage_id text,
  stage_name text,
  category_code text,
  category_name text,
  item_no text,
  kategori text not null default '',
  tanggal date,
  uraian text not null default '',
  qty numeric(14,2) not null default 0,
  satuan text not null default '',
  harga_satuan numeric(18,2) not null default 0,
  jumlah numeric(18,2) not null default 0,
  jumlah_override numeric(18,2),
  is_jumlah_manual boolean not null default false,
  vendor text not null default '',
  vendor_id text,
  source_file text,
  source_page integer,
  source_row integer,
  is_manual_added boolean not null default false,
  is_included_in_resume_total boolean not null default true,
  is_generated_to_note boolean not null default false,
  note_id uuid,
  category_total numeric(18,2),
  stage_total numeric(18,2),
  source_type text not null default 'seed',
  validation_status text not null default 'valid',
  notes text,
  urutan integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table resume_items add column if not exists project_id uuid references projects(id) on delete cascade;
alter table resume_items add column if not exists tahap text;
alter table resume_items add column if not exists stage_id text;
alter table resume_items add column if not exists stage_name text;
alter table resume_items add column if not exists category_code text;
alter table resume_items add column if not exists category_name text;
alter table resume_items add column if not exists item_no text;
alter table resume_items add column if not exists kategori text not null default '';
alter table resume_items add column if not exists tanggal date;
alter table resume_items add column if not exists uraian text not null default '';
alter table resume_items add column if not exists qty numeric(14,2) not null default 0;
alter table resume_items add column if not exists satuan text not null default '';
alter table resume_items add column if not exists harga_satuan numeric(18,2) not null default 0;
alter table resume_items add column if not exists jumlah numeric(18,2) not null default 0;
alter table resume_items add column if not exists jumlah_override numeric(18,2);
alter table resume_items add column if not exists is_jumlah_manual boolean not null default false;
alter table resume_items add column if not exists vendor text not null default '';
alter table resume_items add column if not exists vendor_id text;
alter table resume_items add column if not exists source_file text;
alter table resume_items add column if not exists source_page integer;
alter table resume_items add column if not exists source_row integer;
alter table resume_items add column if not exists is_manual_added boolean not null default false;
alter table resume_items add column if not exists is_included_in_resume_total boolean not null default true;
alter table resume_items add column if not exists is_generated_to_note boolean not null default false;
alter table resume_items add column if not exists note_id uuid;
alter table resume_items add column if not exists category_total numeric(18,2);
alter table resume_items add column if not exists stage_total numeric(18,2);
alter table resume_items add column if not exists source_type text not null default 'seed';
alter table resume_items add column if not exists validation_status text not null default 'valid';
alter table resume_items add column if not exists notes text;
alter table resume_items add column if not exists urutan integer not null default 0;
alter table resume_items add column if not exists created_at timestamptz not null default now();
alter table resume_items add column if not exists updated_at timestamptz not null default now();

do $$
declare
  vendor_constraint record;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'resume_items'
      and column_name = 'vendor_id'
      and data_type = 'uuid'
  ) then
    for vendor_constraint in
      select tc.constraint_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name
       and tc.table_schema = kcu.table_schema
      where tc.table_schema = 'public'
        and tc.table_name = 'resume_items'
        and tc.constraint_type = 'FOREIGN KEY'
        and kcu.column_name = 'vendor_id'
    loop
      execute format('alter table resume_items drop constraint if exists %I', vendor_constraint.constraint_name);
    end loop;

    execute 'alter table resume_items alter column vendor_id type text using vendor_id::text';
  end if;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'resume_items' and column_name = 'project_category_id') then
    execute 'alter table resume_items alter column project_category_id drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'resume_items' and column_name = 'item_name') then
    execute 'alter table resume_items alter column item_name drop not null';
    execute 'update resume_items set uraian = coalesce(uraian, item_name)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'resume_items' and column_name = 'volume') then
    execute 'update resume_items set qty = coalesce(qty, volume)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'resume_items' and column_name = 'unit') then
    execute 'alter table resume_items alter column unit drop not null';
    execute 'update resume_items set satuan = coalesce(satuan, unit)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'resume_items' and column_name = 'unit_price') then
    execute 'update resume_items set harga_satuan = coalesce(harga_satuan, unit_price)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'resume_items' and column_name = 'sort_order') then
    execute 'alter table resume_items alter column sort_order drop not null';
    execute 'update resume_items set urutan = coalesce(urutan, sort_order)';
  end if;
end $$;

create table if not exists resume_summaries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade unique,
  total_tahap_1 numeric(18,2) not null default 0,
  total_tahap_2 numeric(18,2) not null default 0,
  total_tahap_3 numeric(18,2) not null default 0,
  total_tahap_4 numeric(18,2) not null default 0,
  total_diluar_konstruksi numeric(18,2) not null default 0,
  total_keseluruhan numeric(18,2) not null default 0,
  terbilang text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists generated_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  tahap text not null,
  vendor text not null,
  vendor_id text,
  template_id text not null,
  document_type text not null default 'nota',
  source_resume_item_ids text[] not null default '{}',
  data_json jsonb not null default '{}'::jsonb,
  total numeric(18,2) not null default 0,
  status generated_note_status not null default 'generated',
  auto_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists generated_notes_project_auto_key_idx
  on generated_notes(project_id, auto_key)
  where auto_key is not null;

create table if not exists kwitansi_edits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  note_id uuid not null references generated_notes(id) on delete cascade,
  nama_penerima text not null default '',
  warna_template text not null default 'default',
  custom_data_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(note_id)
);

create table if not exists custom_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  tahap text not null,
  vendor text not null,
  vendor_id text,
  template_id text not null,
  document_type text not null default 'nota',
  data_json jsonb not null default '{}'::jsonb,
  total numeric(18,2) not null default 0,
  alasan text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists note_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  action text not null,
  description text not null,
  created_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on projects;
create trigger projects_set_updated_at
before update on projects
for each row execute function set_updated_at();

drop trigger if exists resume_items_set_updated_at on resume_items;
create trigger resume_items_set_updated_at
before update on resume_items
for each row execute function set_updated_at();

drop trigger if exists resume_stages_set_updated_at on resume_stages;
create trigger resume_stages_set_updated_at
before update on resume_stages
for each row execute function set_updated_at();

drop trigger if exists resume_categories_set_updated_at on resume_categories;
create trigger resume_categories_set_updated_at
before update on resume_categories
for each row execute function set_updated_at();

drop trigger if exists generated_notes_set_updated_at on generated_notes;
create trigger generated_notes_set_updated_at
before update on generated_notes
for each row execute function set_updated_at();

drop trigger if exists kwitansi_edits_set_updated_at on kwitansi_edits;
create trigger kwitansi_edits_set_updated_at
before update on kwitansi_edits
for each row execute function set_updated_at();

drop trigger if exists custom_notes_set_updated_at on custom_notes;
create trigger custom_notes_set_updated_at
before update on custom_notes
for each row execute function set_updated_at();

create index if not exists projects_search_idx on projects using gin (
  to_tsvector('simple', coalesce(nama_desa, '') || ' ' || coalesce(nama_project, '') || ' ' || coalesce(kecamatan, '') || ' ' || coalesce(kabupaten, ''))
);
create index if not exists projects_tanggal_laporan_idx on projects(tanggal_laporan);
create index if not exists projects_status_idx on projects(status);
create index if not exists resume_stages_project_idx on resume_stages(project_id);
create index if not exists resume_categories_project_stage_idx on resume_categories(project_id, stage_id);
create index if not exists resume_items_project_idx on resume_items(project_id);
create index if not exists resume_items_project_tahap_idx on resume_items(project_id, tahap);
create index if not exists resume_items_vendor_idx on resume_items(vendor_id);
create index if not exists generated_notes_project_idx on generated_notes(project_id);
create index if not exists generated_notes_project_tahap_idx on generated_notes(project_id, tahap);
create index if not exists custom_notes_project_idx on custom_notes(project_id);
create index if not exists note_history_project_idx on note_history(project_id, created_at desc);

-- This app currently has no Supabase Auth flow. Data access is intentionally
-- driven by the public anon client, so RLS must not block CRUD for these tables.
-- If you later add login, replace this with user-scoped RLS policies.
alter table projects disable row level security;
alter table resume_stages disable row level security;
alter table resume_categories disable row level security;
alter table resume_items disable row level security;
alter table resume_summaries disable row level security;
alter table generated_notes disable row level security;
alter table kwitansi_edits disable row level security;
alter table custom_notes disable row level security;
alter table note_history disable row level security;

notify pgrst, 'reload schema';
