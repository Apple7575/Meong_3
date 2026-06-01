create extension if not exists postgis;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fcm_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios','android')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index fcm_tokens_user_id_idx on public.fcm_tokens(user_id);

create table public.user_locations (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  geom geography(Point,4326) not null,
  updated_at timestamptz not null default now()
);
create index user_locations_geom_idx on public.user_locations using gist (geom);

create table public.dogs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  breed text,
  gender text check (gender in ('male','female','unknown')),
  is_neutered boolean,
  features text,
  emergency_contact text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index dogs_owner_id_idx on public.dogs(owner_id);

create table public.dog_images (
  id uuid primary key default gen_random_uuid(),
  dog_id uuid not null references public.dogs(id) on delete cascade,
  storage_path text not null,
  is_primary boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index dog_images_dog_id_idx on public.dog_images(dog_id);
