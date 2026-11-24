-- 또타미 이동 기록 테이블 (Supabase SQL Editor에서 실행)
create table if not exists public.trips (
  id uuid primary key,
  device_id text not null,
  user_id uuid references auth.users (id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  from_station text not null,
  to_station text not null,
  lines text[] not null default '{}',
  stations text[] not null default '{}',
  minutes integer not null,
  transfers integer not null default 0,
  distance_km numeric(6,1) not null default 0,
  walk_m integer not null default 0,
  delay_min integer not null default 0,
  demo boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists trips_device_idx on public.trips (device_id, started_at desc);

alter table public.trips enable row level security;

-- ⚠️ 시연용 정책: 익명 키로 기기별 기록 접근 허용.
-- 실제 서비스에서는 Supabase Auth 로그인 후 아래 주석의 user_id 기준 정책으로 교체하세요.
create policy "demo device access" on public.trips for all using (true) with check (true);
-- create policy "own trips" on public.trips for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 기존 테이블에 컬럼 추가 (v3)
alter table public.trips add column if not exists delay_min integer not null default 0;
