-- ================================================================
-- TABELA match_state — sistema de placar/timer local
-- Cole no SQL Editor do Supabase e clique RUN
-- ================================================================

create table if not exists match_state (
  id            text primary key,
  team_a        text default 'TIME A',
  team_b        text default 'TIME B',
  score_a       int  default 0,
  score_b       int  default 0,
  fouls_a       int  default 0,
  fouls_b       int  default 0,
  time_left     int  default 600,
  running       boolean default false,
  period        int  default 1,
  possession    text default null,
  game_duration int  default 600,
  updated_at    timestamptz default now()
);

-- Estado inicial da partida
insert into match_state (id) values ('match_atual') on conflict do nothing;

-- Permissão pública (acesso sem autenticação)
alter table match_state enable row level security;
drop policy if exists "public_all" on match_state;
create policy "public_all" on match_state for all using (true) with check (true);

-- Habilita Realtime para essa tabela
alter publication supabase_realtime add table match_state;
