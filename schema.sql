-- ================================================================
-- BASQUETE 3x3 — Schema Supabase
-- Cole isso no SQL Editor do Supabase e clique em RUN
-- ================================================================

-- 1. Configurações do evento
create table if not exists settings (
  id          text primary key default 'main',
  event_name  text default '3x3 Open',
  venue       text default '',
  admin_pass  text default 'admin123'
);
insert into settings (id) values ('main') on conflict do nothing;

-- 2. Estado global do torneio (prazo + sorteio realizado)
create table if not exists tournament (
  id        text primary key default 'main',
  deadline  timestamptz,
  drawn     boolean default false
);
insert into tournament (id) values ('main') on conflict do nothing;

-- 3. Jogadores inscritos
create table if not exists players (
  id         text primary key,
  name       text not null,
  position   text not null,
  created_at timestamptz default now()
);

-- 4. Times sorteados
create table if not exists teams (
  id      text primary key,
  name    text not null,
  color   text not null,
  players jsonb default '[]',
  wins    int  default 0,
  losses  int  default 0,
  draws   int  default 0,
  pf      int  default 0,
  pa      int  default 0,
  named   boolean default false  -- true após o time escolher seu nome
);

-- 5. Jogos
create table if not exists games (
  id           text primary key,
  round        int  default 1,
  team_a       jsonb not null,
  team_b       jsonb not null,
  score_a      int,
  score_b      int,
  fouls_a      int  default 0,
  fouls_b      int  default 0,
  timeouts_a   int  default 1,
  timeouts_b   int  default 1,
  status       text default 'pending',
  notes        text default '',
  elapsed_sec  int  default 0,
  game_date    timestamptz,
  seq          int default 0  -- ordem de exibição
);

-- ================================================================
-- Segurança: acesso público total (app interno sem autenticação)
-- ================================================================
alter table settings   enable row level security;
alter table tournament enable row level security;
alter table players    enable row level security;
alter table teams      enable row level security;
alter table games      enable row level security;

-- Apaga policies antigas se existirem e recria
do $$ begin
  drop policy if exists "public_all" on settings;
  drop policy if exists "public_all" on tournament;
  drop policy if exists "public_all" on players;
  drop policy if exists "public_all" on teams;
  drop policy if exists "public_all" on games;
end $$;

create policy "public_all" on settings   for all using (true) with check (true);
create policy "public_all" on tournament for all using (true) with check (true);
create policy "public_all" on players    for all using (true) with check (true);
create policy "public_all" on teams      for all using (true) with check (true);
create policy "public_all" on games      for all using (true) with check (true);
