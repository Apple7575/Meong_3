alter table public.profiles enable row level security;
alter table public.fcm_tokens enable row level security;
alter table public.user_locations enable row level security;
alter table public.dogs enable row level security;
alter table public.dog_images enable row level security;

create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "fcm_select_own" on public.fcm_tokens for select using (auth.uid() = user_id);
create policy "fcm_insert_own" on public.fcm_tokens for insert with check (auth.uid() = user_id);
create policy "fcm_update_own" on public.fcm_tokens for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "fcm_delete_own" on public.fcm_tokens for delete using (auth.uid() = user_id);

create policy "loc_all_own" on public.user_locations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "dogs_all_own" on public.dogs for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "dog_images_all_own" on public.dog_images for all
  using (exists (select 1 from public.dogs d where d.id = dog_id and d.owner_id = auth.uid()))
  with check (exists (select 1 from public.dogs d where d.id = dog_id and d.owner_id = auth.uid()));
