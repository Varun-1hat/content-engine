-- =============================================================================
-- 0003_pipelines_uuid.sql — v2 stage-toggle model.
--   * clients.id: text slug -> uuid PK, with a human-readable `slug` column
--     that keeps driving Storage/KB/Cloudinary folder naming (media unmoved).
--   * client_pipelines: N per client; each = enabled-stage subset + settings.
--     This replaces tier/content_type/script_mode plan-derivation.
--   * jobs: bind to a pipeline + snapshot a per-reel stage_plan + per-reel
--     product photo URLs (transient reel inputs, not a catalog).
--   * Backfill: one 'Default' pipeline per existing client, reproducing the old
--     derivation exactly, then bind existing jobs to it.
-- Legacy columns (tier, content_type, script_mode, locale_region) are dropped
-- in 0004 AFTER verification.
-- =============================================================================

-- A. Drop dummy client (cascades to its children).
delete from clients where id = 'meera';

-- B. slug column (human-readable; drives storage/KB folder names).
alter table clients add column slug text;
update clients set slug = id;
alter table clients alter column slug set not null;
alter table clients add constraint clients_slug_key unique (slug);

-- C. New UUID identity.
alter table clients add column uid uuid not null default gen_random_uuid();
alter table clients add constraint clients_uid_key unique (uid);

-- D. Repoint every child FK from text id -> uuid.
alter table client_avatars   add column client_uid uuid;
alter table client_templates add column client_uid uuid;
alter table jobs             add column client_uid uuid;
alter table app_users        add column client_uid uuid;
alter table kb_revisions     add column client_uid uuid;
update client_avatars   c set client_uid = p.uid from clients p where c.client_id = p.id;
update client_templates c set client_uid = p.uid from clients p where c.client_id = p.id;
update jobs             c set client_uid = p.uid from clients p where c.client_id = p.id;
update app_users        c set client_uid = p.uid from clients p where c.client_id = p.id;
update kb_revisions     c set client_uid = p.uid from clients p where c.client_id = p.id;
alter table client_avatars   drop constraint client_avatars_client_id_fkey;
alter table client_templates drop constraint client_templates_client_id_fkey;
alter table jobs             drop constraint jobs_client_id_fkey;
alter table app_users        drop constraint app_users_client_id_fkey;
alter table kb_revisions     drop constraint kb_revisions_client_id_fkey;
alter table client_avatars   drop column client_id;
alter table client_templates drop column client_id;
alter table jobs             drop column client_id;
alter table app_users        drop column client_id;
alter table kb_revisions     drop column client_id;
alter table client_avatars   rename column client_uid to client_id;
alter table client_templates rename column client_uid to client_id;
alter table jobs             rename column client_uid to client_id;
alter table app_users        rename column client_uid to client_id;
alter table kb_revisions     rename column client_uid to client_id;
alter table client_avatars   alter column client_id set not null;
alter table client_templates alter column client_id set not null;
alter table jobs             alter column client_id set not null;
alter table kb_revisions     alter column client_id set not null;

-- E. Swap clients PK to the uuid.
alter table clients drop constraint clients_uid_key;
alter table clients drop constraint clients_pkey cascade;
alter table clients drop column id;
alter table clients rename column uid to id;
alter table clients add primary key (id);   -- keeps default gen_random_uuid()

-- F. Re-add child FKs to clients(id).
alter table client_avatars   add constraint client_avatars_client_id_fkey   foreign key (client_id) references clients(id) on delete cascade;
alter table client_templates add constraint client_templates_client_id_fkey foreign key (client_id) references clients(id) on delete cascade;
alter table jobs             add constraint jobs_client_id_fkey             foreign key (client_id) references clients(id) on delete cascade;
alter table app_users        add constraint app_users_client_id_fkey        foreign key (client_id) references clients(id) on delete set null;
alter table kb_revisions     add constraint kb_revisions_client_id_fkey     foreign key (client_id) references clients(id) on delete cascade;

-- G. client_pipelines — N per client; each = enabled-stage set + settings.
create table client_pipelines (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references clients(id) on delete cascade,
  name                 text not null,
  enabled_stages       text[] not null,           -- validated against the code stage registry
  product_input        boolean not null default false,  -- reels take per-reel product photos
  duration_min_sec     int not null default 15,
  duration_max_sec     int not null default 90,
  duration_default_sec int not null default 45,
  sort_order           int not null default 0,
  active               boolean not null default true,
  extra                jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (client_id, name),
  check (array_length(enabled_stages, 1) >= 1)
);
create index client_pipelines_client_idx on client_pipelines (client_id, sort_order);
alter table client_pipelines enable row level security;
create trigger client_pipelines_set_updated_at before update on client_pipelines
  for each row execute function set_updated_at();

-- H. jobs: pipeline binding + per-job snapshot + per-reel product photos.
alter table jobs
  add column pipeline_id        uuid references client_pipelines(id) on delete set null,
  add column stage_plan         text[],       -- resolved at creation; per-reel toggles applied here
  add column product_image_urls text[] not null default '{}';  -- transient reel inputs (Cloudinary)

-- I. Backfill one 'Default' pipeline per client, mirroring the OLD derivation.
with tier_cut as (
  select id, case tier when 'script_only' then 3 when 'audio_only' then 4
                       when 'avatar_only' then 5 else 7 end as cut from clients),
avatar_counts as (
  select c.id cid, count(a.id)::int n from clients c
    left join client_avatars a on a.client_id = c.id group by c.id),
stages(name, ord) as (
  select * from unnest(array['topic','script','adapt_voice','audio','avatar','broll_plan','assemble']) with ordinality)
insert into client_pipelines (client_id, name, enabled_stages, product_input, sort_order)
select c.id, 'Default', array_agg(s.name order by s.ord),
       (c.content_type = 'product_visual'), 0
from clients c
join tier_cut t on t.id = c.id
join avatar_counts ac on ac.cid = c.id
join stages s on s.ord <= t.cut
where not (s.name='topic'       and c.script_mode='polish')
  and not (s.name='adapt_voice' and c.locale_language='english')
  and not (s.name in ('avatar','assemble') and (c.content_type='product_visual' or ac.n=0))
group by c.id;

-- J. Bind existing jobs to Default + snapshot its stage_plan.
update jobs j set pipeline_id = p.id, stage_plan = p.enabled_stages
from client_pipelines p where p.client_id = j.client_id and p.name = 'Default' and j.pipeline_id is null;
