-- =====================================================================
-- Personalized Meal Planner: full Supabase schema
-- Replaces MongoDB (users, sessions) and the per-user localStorage data
-- (profile, wizard draft, plan, favorites, grocery checks, settings,
--  diary, custom foods, saved meals, recent foods, water, weights).
-- Safe to re-run in the Supabase SQL Editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Shared trigger function: keeps updated_at current on every UPDATE.
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =====================================================================
-- 1. users (was Mongo "users")
-- =====================================================================
create table if not exists public.users (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,                 -- server stores it trimmed + lowercased
  salt        text not null,                 -- scrypt salt (hex)
  hash        text not null,                 -- scrypt hash (hex)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint users_email_key unique (email)
);

-- =====================================================================
-- 2. sessions (was Mongo "sessions")
-- =====================================================================
create table if not exists public.sessions (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null,                 -- SHA-256 of the cookie token (hex)
  user_id     uuid not null references public.users (id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint sessions_token_hash_key unique (token_hash)
);
create index if not exists sessions_user_id_idx    on public.sessions (user_id);
create index if not exists sessions_expires_at_idx on public.sessions (expires_at);

-- =====================================================================
-- 3. profiles (was localStorage "gather-v2-profile"); one per user.
--    No row = the user hasn't finished onboarding (profile === null).
--    Enum columns are nullable because the app already handles
--    incomplete/older profiles ("profile needs update" screen).
-- =====================================================================
create table if not exists public.profiles (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users (id) on delete cascade,
  name                text not null default '',
  age                 integer check (age between 15 and 80),
  gender              text check (gender in ('male', 'female', 'other')),
  formula_sex         text check (formula_sex in ('', 'male', 'female')),
  height_cm           numeric check (height_cm between 100 and 250),
  weight_kg           numeric check (weight_kg between 30 and 300),
  body_fat_percent    numeric check (body_fat_percent between 3 and 60),
  bmr_formula         text not null default 'mifflin' check (bmr_formula in ('mifflin', 'harris', 'katch')),
  units               text not null default 'metric'  check (units in ('metric', 'imperial')),
  activity_level      text check (activity_level in ('sedentary', 'light', 'moderate', 'active', 'veryActive')),
  goal                text not null default 'maintain' check (goal in ('lose', 'maintain', 'gain')),
  target_weight_kg    numeric,
  pace                text not null default 'standard' check (pace in ('mild', 'standard')),
  diet_type           text not null default 'vegetarian'
                        check (diet_type in ('vegetarian', 'non-vegetarian', 'vegan', 'eggetarian')),
  cuisine_preferences text[] not null default array['No preference']::text[],
  meals_per_day       integer not null default 4  check (meals_per_day in (3, 4)),
  max_cooking_time    integer not null default 30 check (max_cooking_time in (15, 30, 60)),
  allergies           text[] not null default '{}',
  disliked_foods      text[] not null default '{}',
  health_conditions   text[] not null default '{}',
  preferences_set     boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint profiles_user_id_key unique (user_id)
);

-- =====================================================================
-- 4. user_settings: one row per user of small per-account values
--    online_recipes  <- "gather-v2-online-recipes"
--    water_goal      <- "gather-v2-water-goal"
--    onboarding_step <- "gather-v5-onboarding-step"
--    wizard_draft    <- "gather-v3-wizard-draft" (unvalidated form state,
--                       so jsonb; null = use the app's empty draft)
-- =====================================================================
create table if not exists public.user_settings (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users (id) on delete cascade,
  online_recipes   boolean not null default true,
  water_goal       integer not null default 8 check (water_goal >= 1),
  onboarding_step  integer not null default 0 check (onboarding_step >= 0),
  wizard_draft     jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint user_settings_user_id_key unique (user_id)
);

-- =====================================================================
-- 5. meal_plans (was "gather-v2-plan"); the app keeps one current plan.
--    The plan is a generated tree (7 days -> slots -> full recipe objects
--    incl. Spoonacular data), always read/replaced whole -> jsonb.
-- =====================================================================
create table if not exists public.meal_plans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  plan        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint meal_plans_user_id_key unique (user_id)
);

-- =====================================================================
-- 6. favorite_recipes (was "gather-v2-favorites": array of recipe ids)
--    Recipes are not in the DB (meals.json ids like "b01", or
--    "spoonacular:123"), so recipe_id is text with no FK.
-- =====================================================================
create table if not exists public.favorite_recipes (
  user_id     uuid not null references public.users (id) on delete cascade,
  recipe_id   text not null,
  position    integer not null,              -- keeps the array order
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

-- =====================================================================
-- 7. grocery_checks (was "gather-v2-grocery-checks": "name|unit" keys)
-- =====================================================================
create table if not exists public.grocery_checks (
  user_id     uuid not null references public.users (id) on delete cascade,
  item_key    text not null,                 -- `${name}|${unit}`
  position    integer not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, item_key)
);

-- =====================================================================
-- 8. diary_entries (was "gather-v2-diary": { "YYYY-MM-DD": { slot: [entry] } })
--    One row per logged food. client_id is the app's own entry id
--    (uuid, "plan:...", "copy:..."), kept as text.
-- =====================================================================
create table if not exists public.diary_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  entry_date  date not null,
  slot        text not null check (slot in ('breakfast', 'lunch', 'dinner', 'snacks')),
  position    integer not null,              -- order within the slot
  client_id   text not null,
  name        text not null default '',
  servings    numeric not null default 1 check (servings > 0),
  calories    numeric not null default 0 check (calories >= 0),
  protein     numeric not null default 0 check (protein >= 0),
  carbs       numeric not null default 0 check (carbs >= 0),
  fat         numeric not null default 0 check (fat >= 0),
  source      text not null default 'manual',
  logged_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists diary_entries_user_date_idx on public.diary_entries (user_id, entry_date, slot, position);

-- =====================================================================
-- 9. custom_foods (was "gather-v2-custom-foods")
-- =====================================================================
create table if not exists public.custom_foods (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  client_id     text not null,               -- "custom:<timestamp>"
  position      integer not null,
  name          text not null,
  serving_size  text not null default '',
  calories      numeric not null default 0 check (calories >= 0),
  protein       numeric not null default 0 check (protein >= 0),
  carbs         numeric not null default 0 check (carbs >= 0),
  fat           numeric not null default 0 check (fat >= 0),
  ingredients   jsonb not null default '[]'::jsonb,   -- [{ name }]
  diet_type     text[] not null default '{}',
  source        text not null default 'custom',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint custom_foods_user_client_key unique (user_id, client_id)
);

-- =====================================================================
-- 10. saved_meals (was "gather-v2-saved-meals")
-- =====================================================================
create table if not exists public.saved_meals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  client_id    text not null,                -- "saved:<timestamp>"
  position     integer not null,
  name         text not null,
  calories     numeric not null default 0 check (calories >= 0),
  protein      numeric not null default 0 check (protein >= 0),
  carbs        numeric not null default 0 check (carbs >= 0),
  fat          numeric not null default 0 check (fat >= 0),
  ingredients  jsonb not null default '[]'::jsonb,    -- [{ name }]
  diet_type    text[] not null default '{}',
  source       text not null default 'saved meal',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint saved_meals_user_client_key unique (user_id, client_id)
);

-- =====================================================================
-- 11. recent_foods (was "gather-v2-recent-foods", capped at 30 by the app)
--     Each item is whatever food was logged (local recipe, Spoonacular
--     recipe, custom food, saved meal), so the record itself is jsonb.
-- =====================================================================
create table if not exists public.recent_foods (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  position    integer not null,              -- 0 = most recent
  food        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists recent_foods_user_position_idx on public.recent_foods (user_id, position);

-- =====================================================================
-- 12. water_logs (was "gather-v2-water": { "YYYY-MM-DD": glasses })
-- =====================================================================
create table if not exists public.water_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  log_date    date not null,
  glasses     integer not null default 0 check (glasses >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint water_logs_user_date_key unique (user_id, log_date)
);

-- =====================================================================
-- 13. weight_logs (was "gather-v2-weights": [{ date, kg }])
-- =====================================================================
create table if not exists public.weight_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  log_date    date not null,
  weight_kg   numeric not null check (weight_kg > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint weight_logs_user_date_key unique (user_id, log_date)
);

-- =====================================================================
-- updated_at triggers + Row Level Security on every table
-- Only the Express server (secret key, bypasses RLS) touches these tables.
-- RLS with no policies = the publishable/anon key can read or write nothing.
-- =====================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'users', 'sessions', 'profiles', 'user_settings', 'meal_plans',
    'favorite_recipes', 'grocery_checks', 'diary_entries', 'custom_foods',
    'saved_meals', 'recent_foods', 'water_logs', 'weight_logs'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- =====================================================================
-- RPC functions: atomic "replace the whole list" writes.
-- supabase-js has no transactions, and the app edits these as whole
-- arrays, so each function deletes + re-inserts in one transaction.
-- p_* jsonb arguments are arrays of snake_case objects built by the server.
-- =====================================================================

-- One diary day: all slots for p_date.
create or replace function public.replace_diary_day(p_user_id uuid, p_date date, p_entries jsonb)
returns void
language sql
set search_path = ''
as $$
  delete from public.diary_entries where user_id = p_user_id and entry_date = p_date;
  insert into public.diary_entries
    (user_id, entry_date, slot, position, client_id, name, servings, calories, protein, carbs, fat, source, logged_at)
  select p_user_id, p_date, e.slot, e.position, e.client_id, coalesce(e.name, ''), coalesce(e.servings, 1),
         coalesce(e.calories, 0), coalesce(e.protein, 0), coalesce(e.carbs, 0), coalesce(e.fat, 0),
         coalesce(e.source, 'manual'), coalesce(e.logged_at, now())
  from jsonb_to_recordset(coalesce(p_entries, '[]'::jsonb)) as e(
    slot text, position integer, client_id text, name text, servings numeric, calories numeric,
    protein numeric, carbs numeric, fat numeric, source text, logged_at timestamptz);
$$;

create or replace function public.replace_custom_foods(p_user_id uuid, p_foods jsonb)
returns void
language sql
set search_path = ''
as $$
  delete from public.custom_foods where user_id = p_user_id;
  insert into public.custom_foods
    (user_id, client_id, position, name, serving_size, calories, protein, carbs, fat, ingredients, diet_type, source)
  select p_user_id, f.client_id, f.position, f.name, coalesce(f.serving_size, ''), coalesce(f.calories, 0),
         coalesce(f.protein, 0), coalesce(f.carbs, 0), coalesce(f.fat, 0), coalesce(f.ingredients, '[]'::jsonb),
         coalesce(f.diet_type, '{}'), coalesce(f.source, 'custom')
  from jsonb_to_recordset(coalesce(p_foods, '[]'::jsonb)) as f(
    client_id text, position integer, name text, serving_size text, calories numeric, protein numeric,
    carbs numeric, fat numeric, ingredients jsonb, diet_type text[], source text);
$$;

create or replace function public.replace_saved_meals(p_user_id uuid, p_meals jsonb)
returns void
language sql
set search_path = ''
as $$
  delete from public.saved_meals where user_id = p_user_id;
  insert into public.saved_meals
    (user_id, client_id, position, name, calories, protein, carbs, fat, ingredients, diet_type, source)
  select p_user_id, m.client_id, m.position, m.name, coalesce(m.calories, 0), coalesce(m.protein, 0),
         coalesce(m.carbs, 0), coalesce(m.fat, 0), coalesce(m.ingredients, '[]'::jsonb),
         coalesce(m.diet_type, '{}'), coalesce(m.source, 'saved meal')
  from jsonb_to_recordset(coalesce(p_meals, '[]'::jsonb)) as m(
    client_id text, position integer, name text, calories numeric, protein numeric, carbs numeric,
    fat numeric, ingredients jsonb, diet_type text[], source text);
$$;

create or replace function public.replace_recent_foods(p_user_id uuid, p_foods jsonb)
returns void
language sql
set search_path = ''
as $$
  delete from public.recent_foods where user_id = p_user_id;
  insert into public.recent_foods (user_id, position, food)
  select p_user_id, (f.ordinality - 1)::integer, f.value
  from jsonb_array_elements(coalesce(p_foods, '[]'::jsonb)) with ordinality as f(value, ordinality);
$$;

create or replace function public.replace_favorite_recipes(p_user_id uuid, p_recipe_ids text[])
returns void
language sql
set search_path = ''
as $$
  delete from public.favorite_recipes where user_id = p_user_id;
  insert into public.favorite_recipes (user_id, recipe_id, position)
  select p_user_id, r.recipe_id, (min(r.ordinality) - 1)::integer
  from unnest(coalesce(p_recipe_ids, '{}')) with ordinality as r(recipe_id, ordinality)
  group by r.recipe_id;
$$;

create or replace function public.replace_grocery_checks(p_user_id uuid, p_item_keys text[])
returns void
language sql
set search_path = ''
as $$
  delete from public.grocery_checks where user_id = p_user_id;
  insert into public.grocery_checks (user_id, item_key, position)
  select p_user_id, k.item_key, (min(k.ordinality) - 1)::integer
  from unnest(coalesce(p_item_keys, '{}')) with ordinality as k(item_key, ordinality)
  group by k.item_key;
$$;

-- The functions take a user id, so only the server (service_role) may call them.
do $$
declare
  f text;
begin
  foreach f in array array[
    'replace_diary_day(uuid, date, jsonb)', 'replace_custom_foods(uuid, jsonb)',
    'replace_saved_meals(uuid, jsonb)', 'replace_recent_foods(uuid, jsonb)',
    'replace_favorite_recipes(uuid, text[])', 'replace_grocery_checks(uuid, text[])'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;

-- =====================================================================
-- Optional: expired-session cleanup (replaces Mongo's TTL index).
-- Login already ignores expired sessions; this only removes stale rows.
-- Enable "pg_cron" under Database -> Extensions first, then uncomment:
-- =====================================================================
-- create extension if not exists pg_cron;
-- select cron.unschedule('delete-expired-sessions')
--   where exists (select 1 from cron.job where jobname = 'delete-expired-sessions');
-- select cron.schedule('delete-expired-sessions', '0 * * * *',
--   $$ delete from public.sessions where expires_at <= now() $$);
