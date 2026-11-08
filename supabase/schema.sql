-- Run this once in Supabase: Dashboard �� SQL Editor �� New query �� paste �� Run.

create table if not exists public.settings (
  id int primary key,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.exhibits (
  id uuid primary key,
  image_path text not null,
  title text not null default '',
  description text not null default '',
  sort bigint not null default 0,
  w int not null default 800,
  h int not null default 1000,
  created_at timestamptz not null default now()
);

create table if not exists public.visitors (
  id uuid primary key,
  token text not null,
  name text not null,
  gender text not null,
  age int,
  answer text,
  answered_at timestamptz,
  visits int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only the server (service key) touches these tables; block the public API.
alter table public.settings enable row level security;
alter table public.exhibits enable row level security;
alter table public.visitors enable row level security;

-- Public bucket for the pictures (anyone with a link can view an image).
insert into storage.buckets (id, name, public)
values ('pictures', 'pictures', true)
on conflict (id) do nothing;
