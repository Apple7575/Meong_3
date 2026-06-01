insert into storage.buckets (id, name, public)
values ('dog-images', 'dog-images', false)
on conflict (id) do nothing;

create policy "dog_images_insert_own" on storage.objects for insert
  with check (bucket_id = 'dog-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "dog_images_select_own" on storage.objects for select
  using (bucket_id = 'dog-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "dog_images_update_own" on storage.objects for update
  using (bucket_id = 'dog-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "dog_images_delete_own" on storage.objects for delete
  using (bucket_id = 'dog-images' and (storage.foldername(name))[1] = auth.uid()::text);
