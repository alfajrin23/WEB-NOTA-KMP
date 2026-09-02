drop index if exists belanja_sync_items_active_once_idx;

create unique index belanja_sync_items_active_once_idx
  on belanja_sync_items(project_id, source_resume_item_id)
  where status in ('pending', 'processing');

notify pgrst, 'reload schema';
