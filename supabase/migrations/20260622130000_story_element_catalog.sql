-- Story element catalog and blueprint usage tables.
--
-- Reusable story DNA (plot engines, settings, arcs, structures, themes, tones,
-- genres, stakes, conflicts, POVs, etc.) lives as catalog data. Project-specific
-- story choices attach to story_blueprints and remain linked to agent actions.

set check_function_bodies = off;

create table public.story_element_categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  description text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger story_element_categories_set_updated_at
  before update on public.story_element_categories
  for each row execute function public.set_updated_at();

create table public.story_elements (
  id               uuid primary key default gen_random_uuid(),
  category_id      uuid not null references public.story_element_categories(id) on delete cascade,
  group_slug       text,
  group_name       text,
  slug             text not null,
  name             text not null,
  core_idea        text,
  audience_promise text,
  story_question   text,
  sort_order       integer not null default 0,
  is_featured      boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (category_id, slug)
);

create index story_elements_category_idx on public.story_elements(category_id, sort_order);
create index story_elements_group_idx on public.story_elements(group_slug);
create index story_elements_featured_idx on public.story_elements(category_id, sort_order)
  where is_featured;
create index story_elements_search_idx on public.story_elements
  using gin (to_tsvector('english',
    coalesce(name, '') || ' ' || coalesce(core_idea, '') || ' ' ||
    coalesce(group_name, '') || ' ' || coalesce(audience_promise, '') || ' ' ||
    coalesce(story_question, '')));

create trigger story_elements_set_updated_at
  before update on public.story_elements
  for each row execute function public.set_updated_at();

create table public.story_element_examples (
  id               uuid primary key default gen_random_uuid(),
  story_element_id uuid not null references public.story_elements(id) on delete cascade,
  example          text not null,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  unique (story_element_id, example)
);

create index story_element_examples_element_idx
  on public.story_element_examples(story_element_id, sort_order);

create table public.story_element_relations (
  id                uuid primary key default gen_random_uuid(),
  source_element_id uuid not null references public.story_elements(id) on delete cascade,
  target_element_id uuid not null references public.story_elements(id) on delete cascade,
  relation          text not null check (relation in ('compatible_with', 'variant_of', 'conflicts_with', 'implies', 'often_combines_with')),
  weight            numeric,
  note              text,
  created_at        timestamptz not null default now(),
  unique (source_element_id, target_element_id, relation),
  check (source_element_id <> target_element_id)
);

create index story_element_relations_source_idx on public.story_element_relations(source_element_id);
create index story_element_relations_target_idx on public.story_element_relations(target_element_id);

create table public.story_blueprint_elements (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  story_blueprint_id   uuid not null references public.story_blueprints(id) on delete cascade,
  story_element_id     uuid not null references public.story_elements(id) on delete restrict,
  role                 text not null default 'primary',
  position             integer not null default 0,
  rationale            text,
  created_by_action_id uuid references public.actions(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (story_blueprint_id, story_element_id, role)
);

create index story_blueprint_elements_project_idx on public.story_blueprint_elements(project_id);
create index story_blueprint_elements_blueprint_idx on public.story_blueprint_elements(story_blueprint_id, position);
create index story_blueprint_elements_element_idx on public.story_blueprint_elements(story_element_id);

create trigger story_blueprint_elements_set_updated_at
  before update on public.story_blueprint_elements
  for each row execute function public.set_updated_at();

create table public.story_blueprint_character_arcs (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  story_blueprint_id   uuid not null references public.story_blueprints(id) on delete cascade,
  character_id         uuid not null references public.story_blueprint_characters(id) on delete cascade,
  arc_element_id       uuid references public.story_elements(id) on delete restrict,
  want                 text,
  need                 text,
  flaw                 text,
  wound                text,
  lie                  text,
  truth                text,
  old_self             text,
  new_truth            text,
  final_choice         text,
  rationale            text,
  created_by_action_id uuid references public.actions(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (story_blueprint_id, character_id)
);

create index story_blueprint_character_arcs_project_idx on public.story_blueprint_character_arcs(project_id);
create index story_blueprint_character_arcs_blueprint_idx on public.story_blueprint_character_arcs(story_blueprint_id);
create index story_blueprint_character_arcs_character_idx on public.story_blueprint_character_arcs(character_id);

create trigger story_blueprint_character_arcs_set_updated_at
  before update on public.story_blueprint_character_arcs
  for each row execute function public.set_updated_at();

create table public.story_blueprint_antagonistic_forces (
  id                         uuid primary key default gen_random_uuid(),
  project_id                 uuid not null references public.projects(id) on delete cascade,
  story_blueprint_id         uuid not null references public.story_blueprints(id) on delete cascade,
  antagonist_type_element_id uuid references public.story_elements(id) on delete restrict,
  name                       text,
  description                text,
  opposes_character_id       uuid references public.story_blueprint_characters(id) on delete set null,
  pressure                   text,
  rationale                  text,
  created_by_action_id       uuid references public.actions(id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create index story_blueprint_antagonistic_forces_project_idx on public.story_blueprint_antagonistic_forces(project_id);
create index story_blueprint_antagonistic_forces_blueprint_idx on public.story_blueprint_antagonistic_forces(story_blueprint_id);
create index story_blueprint_antagonistic_forces_type_idx on public.story_blueprint_antagonistic_forces(antagonist_type_element_id);

create trigger story_blueprint_antagonistic_forces_set_updated_at
  before update on public.story_blueprint_antagonistic_forces
  for each row execute function public.set_updated_at();

create table public.story_blueprint_premises (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  story_blueprint_id   uuid not null references public.story_blueprints(id) on delete cascade,
  premise_asset_id     uuid references public.assets(id) on delete set null,
  type_of_person       text,
  setting_summary      text,
  external_goal        text,
  antagonistic_force   text,
  inner_flaw_or_lie    text,
  old_self             text,
  new_truth            text,
  ending_type          text,
  logline              text,
  created_by_action_id uuid references public.actions(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (story_blueprint_id)
);

create index story_blueprint_premises_project_idx on public.story_blueprint_premises(project_id);
create index story_blueprint_premises_asset_idx on public.story_blueprint_premises(premise_asset_id);

create trigger story_blueprint_premises_set_updated_at
  before update on public.story_blueprint_premises
  for each row execute function public.set_updated_at();

create or replace function public.validate_story_blueprint_story_element_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_blueprint_project_id uuid;
  v_character_project_id uuid;
  v_character_blueprint_id uuid;
  v_action_project_id uuid;
  v_asset_project_id uuid;
  v_category_slug text;
begin
  select b.project_id into v_blueprint_project_id
  from public.story_blueprints b
  where b.id = new.story_blueprint_id;

  if v_blueprint_project_id is null then
    raise exception 'story blueprint does not exist (%)', new.story_blueprint_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_blueprint_project_id is distinct from new.project_id then
    raise exception 'story element row project does not match blueprint project'
      using errcode = 'check_violation';
  end if;

  if new.created_by_action_id is not null then
    select a.project_id into v_action_project_id
    from public.actions a
    where a.id = new.created_by_action_id;

    if v_action_project_id is distinct from new.project_id then
      raise exception 'story element row action does not belong to project'
        using errcode = 'check_violation';
    end if;
  end if;

  if TG_TABLE_NAME = 'story_blueprint_character_arcs' then
    select c.project_id, c.story_blueprint_id into v_character_project_id, v_character_blueprint_id
    from public.story_blueprint_characters c
    where c.id = new.character_id;

    if v_character_project_id is distinct from new.project_id
       or v_character_blueprint_id is distinct from new.story_blueprint_id then
      raise exception 'character arc character does not belong to the same blueprint'
        using errcode = 'check_violation';
    end if;

    if new.arc_element_id is not null then
      select c.slug into v_category_slug
      from public.story_elements e
      join public.story_element_categories c on c.id = e.category_id
      where e.id = new.arc_element_id;

      if v_category_slug <> 'character_arc' then
        raise exception 'arc_element_id must reference a character_arc story element'
          using errcode = 'check_violation';
      end if;
    end if;
  elsif TG_TABLE_NAME = 'story_blueprint_antagonistic_forces' then
    if new.opposes_character_id is not null then
      select c.project_id, c.story_blueprint_id into v_character_project_id, v_character_blueprint_id
      from public.story_blueprint_characters c
      where c.id = new.opposes_character_id;

      if v_character_project_id is distinct from new.project_id
         or v_character_blueprint_id is distinct from new.story_blueprint_id then
        raise exception 'antagonistic force character does not belong to the same blueprint'
          using errcode = 'check_violation';
      end if;
    end if;

    if new.antagonist_type_element_id is not null then
      select c.slug into v_category_slug
      from public.story_elements e
      join public.story_element_categories c on c.id = e.category_id
      where e.id = new.antagonist_type_element_id;

      if v_category_slug <> 'antagonist_type' then
        raise exception 'antagonist_type_element_id must reference an antagonist_type story element'
          using errcode = 'check_violation';
      end if;
    end if;
  elsif TG_TABLE_NAME = 'story_blueprint_premises' then
    if new.premise_asset_id is not null then
      select a.project_id into v_asset_project_id
      from public.assets a
      where a.id = new.premise_asset_id;

      if v_asset_project_id is distinct from new.project_id then
        raise exception 'premise asset does not belong to project'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_story_blueprint_story_element_refs() from public;

create trigger story_blueprint_elements_validate_refs
  before insert or update of project_id, story_blueprint_id, created_by_action_id
  on public.story_blueprint_elements
  for each row execute function public.validate_story_blueprint_story_element_refs();

create trigger story_blueprint_character_arcs_validate_refs
  before insert or update of project_id, story_blueprint_id, character_id, arc_element_id, created_by_action_id
  on public.story_blueprint_character_arcs
  for each row execute function public.validate_story_blueprint_story_element_refs();

create trigger story_blueprint_antagonistic_forces_validate_refs
  before insert or update of project_id, story_blueprint_id, antagonist_type_element_id, opposes_character_id, created_by_action_id
  on public.story_blueprint_antagonistic_forces
  for each row execute function public.validate_story_blueprint_story_element_refs();

create trigger story_blueprint_premises_validate_refs
  before insert or update of project_id, story_blueprint_id, premise_asset_id, created_by_action_id
  on public.story_blueprint_premises
  for each row execute function public.validate_story_blueprint_story_element_refs();

alter table public.story_element_categories enable row level security;
alter table public.story_elements enable row level security;
alter table public.story_element_examples enable row level security;
alter table public.story_element_relations enable row level security;
alter table public.story_blueprint_elements enable row level security;
alter table public.story_blueprint_character_arcs enable row level security;
alter table public.story_blueprint_antagonistic_forces enable row level security;
alter table public.story_blueprint_premises enable row level security;

create policy story_element_categories_public_read on public.story_element_categories
  for select to anon, authenticated using (true);
create policy story_elements_public_read on public.story_elements
  for select to anon, authenticated using (true);
create policy story_element_examples_public_read on public.story_element_examples
  for select to anon, authenticated using (true);
create policy story_element_relations_public_read on public.story_element_relations
  for select to anon, authenticated using (true);

create policy story_blueprint_elements_owner on public.story_blueprint_elements
  for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));
create policy story_blueprint_elements_public_read on public.story_blueprint_elements
  for select to anon, authenticated using (public.project_is_public(project_id));

create policy story_blueprint_character_arcs_owner on public.story_blueprint_character_arcs
  for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));
create policy story_blueprint_character_arcs_public_read on public.story_blueprint_character_arcs
  for select to anon, authenticated using (public.project_is_public(project_id));

create policy story_blueprint_antagonistic_forces_owner on public.story_blueprint_antagonistic_forces
  for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));
create policy story_blueprint_antagonistic_forces_public_read on public.story_blueprint_antagonistic_forces
  for select to anon, authenticated using (public.project_is_public(project_id));

create policy story_blueprint_premises_owner on public.story_blueprint_premises
  for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));
create policy story_blueprint_premises_public_read on public.story_blueprint_premises
  for select to anon, authenticated using (public.project_is_public(project_id));

insert into public.story_element_categories (slug, name, description, sort_order)
values
  ('plot_type', 'Plot type', 'Reusable plot engine: what happens.', 10),
  ('setting', 'Setting', 'Reusable time, place, world, environmental, cultural, and genre-flavored contexts.', 20),
  ('character_arc', 'Character arc', 'Reusable inner transformation pattern for a character.', 30),
  ('belief_shift', 'Belief shift', 'Reusable lie-to-truth transformation pattern.', 35),
  ('structure', 'Structure', 'Reusable arrangement for story events.', 40),
  ('protagonist_piece', 'Protagonist piece', 'Reusable protagonist-design field/question.', 45),
  ('antagonist_type', 'Antagonist type', 'Reusable opposing-force type.', 50),
  ('conflict', 'Conflict', 'Reusable conflict axis.', 60),
  ('stakes', 'Stakes', 'Reusable reason the story matters.', 70),
  ('theme', 'Theme', 'Reusable meaning/story question.', 80),
  ('genre', 'Genre', 'Reusable audience promise.', 90),
  ('tone', 'Tone', 'Reusable felt mode.', 100),
  ('pov', 'Point of view', 'Reusable story filtration mode.', 110)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order;

with seed(category_slug, group_slug, group_name, slug, name, core_idea, audience_promise, story_question, sort_order, is_featured) as (
  values
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'coming_of_age', 'Coming of age', 'A young or naive person matures through experience.', null, null, 1, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'rags_to_riches', 'Rags to riches', 'A low-status character rises in wealth, power, fame, or respect.', null, null, 2, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'riches_to_rags', 'Riches to rags', 'A powerful or privileged character loses everything.', null, null, 3, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'fall_from_grace', 'Fall from grace', 'A respected person is undone by flaws, scandal, temptation, or fate.', null, null, 4, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'redemption', 'Redemption', 'A flawed or guilty character earns moral repair.', null, null, 5, true),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'revenge', 'Revenge', 'A wronged character seeks payback.', null, null, 6, true),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'quest', 'Quest', 'A character pursues a specific object, person, place, or goal.', null, null, 7, true),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'journey_and_return', 'Journey and return', 'A character enters a strange world, is changed, and returns home.', null, null, 8, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'voyage_of_discovery', 'Voyage of discovery', 'The journey reveals truths about the world or self.', null, null, 9, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'overcoming_the_monster', 'Overcoming the monster', 'A hero confronts a dangerous external threat.', null, null, 10, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'underdog_victory', 'Underdog victory', 'A weaker character challenges a stronger opponent/system.', null, null, 11, true),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'tragedy', 'Tragedy', 'A character’s flaw, choice, or fate leads to ruin.', null, null, 12, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'comedy', 'Comedy', 'Confusion, conflict, and disorder resolve into harmony.', null, null, 13, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'rebirth', 'Rebirth', 'A character undergoes transformation after spiritual, emotional, or social death.', null, null, 14, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'forbidden_love', 'Forbidden love', 'Lovers face social, familial, moral, or practical barriers.', null, null, 15, true),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'star_crossed_lovers', 'Star-crossed lovers', 'Love is doomed by forces beyond the couple’s control.', null, null, 16, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'sacrifice', 'Sacrifice', 'A character gives up something precious for a greater good.', null, null, 17, true),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'temptation', 'Temptation', 'A character is lured away from values or duty.', null, null, 18, true),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'test_of_faith', 'Test of faith', 'A character’s beliefs are challenged.', null, null, 19, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'discovery_of_identity', 'Discovery of identity', 'A character learns who they really are.', null, null, 20, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'the_chosen_one', 'The chosen one', 'An ordinary person is revealed to have a special destiny.', null, null, 21, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'escape', 'Escape', 'A character must get out of captivity, danger, or oppression.', null, null, 22, true),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'survival', 'Survival', 'A character tries to stay alive against nature, violence, illness, or isolation.', null, null, 23, true),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'transformation', 'Transformation', 'A person, group, or society changes form, status, or worldview.', null, null, 24, true),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'mystery_investigation', 'Mystery / investigation', 'A hidden truth must be uncovered.', null, null, 25, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'conspiracy', 'Conspiracy', 'A character discovers a secret system of control.', null, null, 26, true),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'rescue', 'Rescue', 'A character must save someone from danger.', null, null, 27, true),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'heist', 'Heist', 'A team plans and executes a theft or impossible operation.', null, null, 28, true),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'war_battle', 'War / battle', 'Characters are tested by organized conflict.', null, null, 29, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'competition', 'Competition', 'Characters pursue victory in a contest, sport, election, game, or audition.', null, null, 30, true),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'rise_and_fall', 'Rise and fall', 'A character ascends, peaks, and collapses.', null, null, 31, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'fall_and_rise', 'Fall and rise', 'A character collapses, then rebuilds.', null, null, 32, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'love_triangle', 'Love triangle', 'Three people are emotionally entangled.', null, null, 33, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'fish_out_of_water', 'Fish out of water', 'A character is placed in an unfamiliar environment.', null, null, 34, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'stranger_comes_to_town', 'Stranger comes to town', 'An outsider disrupts a community.', null, null, 35, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'town_changes_the_stranger', 'Town changes the stranger', 'The outsider is transformed by the community.', null, null, 36, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'return_of_the_prodigal', 'Return of the prodigal', 'Someone comes home after absence, failure, exile, or betrayal.', null, null, 37, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'the_deal_with_the_devil', 'The deal with the devil', 'A character gains power at a moral cost.', null, null, 38, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'the_double_life', 'The double life', 'A character hides a second identity.', null, null, 39, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'the_impostor', 'The impostor', 'Someone pretends to be someone they are not.', null, null, 40, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'the_mistaken_identity', 'The mistaken identity', 'Characters are confused for others, causing escalating consequences.', null, null, 41, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'the_mentor_and_apprentice', 'The mentor and apprentice', 'A novice is shaped by a teacher.', null, null, 42, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'the_passing_of_the_torch', 'The passing of the torch', 'One generation hands responsibility to the next.', null, null, 43, false),
    ('plot_type', 'classic_macro_plots', 'Classic macro plots', 'the_last_chance', 'The last chance', 'A character has one final opportunity to succeed, love, confess, or survive.', null, null, 44, false),
    ('plot_type', 'status_plots', 'Status plots', 'social_climb', 'Social climb', 'A character tries to enter a higher class or elite circle.', null, null, 45, false),
    ('plot_type', 'status_plots', 'Status plots', 'power_grab', 'Power grab', 'A character seeks authority, office, control, or influence.', null, null, 46, false),
    ('plot_type', 'status_plots', 'Status plots', 'dynastic_succession', 'Dynastic succession', 'Characters fight over inheritance, throne, company, or legacy.', null, null, 47, false),
    ('plot_type', 'status_plots', 'Status plots', 'inheritance_battle', 'Inheritance battle', 'A death or gift triggers conflict over property or status.', null, null, 48, false),
    ('plot_type', 'status_plots', 'Status plots', 'disinheritance', 'Disinheritance', 'A character is cut off and must survive without privilege.', null, null, 49, false),
    ('plot_type', 'status_plots', 'Status plots', 'exile', 'Exile', 'A character is removed from home, family, nation, or group.', null, null, 50, true),
    ('plot_type', 'status_plots', 'Status plots', 'restoration', 'Restoration', 'A rightful leader, heir, family member, or truth is restored.', null, null, 51, true),
    ('plot_type', 'status_plots', 'Status plots', 'usurpation', 'Usurpation', 'Someone illegitimately takes power.', null, null, 52, false),
    ('plot_type', 'status_plots', 'Status plots', 'coup', 'Coup', 'A group attempts to overthrow authority.', null, null, 53, false),
    ('plot_type', 'status_plots', 'Status plots', 'revolution', 'Revolution', 'The oppressed rise against a system.', null, null, 54, false),
    ('plot_type', 'status_plots', 'Status plots', 'assimilation', 'Assimilation', 'A character tries to fit into a dominant culture.', null, null, 55, false),
    ('plot_type', 'status_plots', 'Status plots', 'outcast_acceptance', 'Outcast acceptance', 'A rejected character finds belonging.', null, null, 56, false),
    ('plot_type', 'status_plots', 'Status plots', 'reputation_repair', 'Reputation repair', 'A character must clear their name.', null, null, 57, false),
    ('plot_type', 'status_plots', 'Status plots', 'public_disgrace', 'Public disgrace', 'Private failure becomes public scandal.', null, null, 58, false),
    ('plot_type', 'status_plots', 'Status plots', 'fame_corrupts', 'Fame corrupts', 'Success changes a character for the worse.', null, null, 59, false),
    ('plot_type', 'status_plots', 'Status plots', 'fame_isolates', 'Fame isolates', 'Success separates a character from love, friends, or self.', null, null, 60, false),
    ('plot_type', 'status_plots', 'Status plots', 'selling_out', 'Selling out', 'A character compromises values for success.', null, null, 61, false),
    ('plot_type', 'status_plots', 'Status plots', 'keeping_integrity', 'Keeping integrity', 'A character refuses compromise despite pressure.', null, null, 62, false),
    ('plot_type', 'status_plots', 'Status plots', 'the_promotion', 'The promotion', 'A new role exposes hidden weakness or ambition.', null, null, 63, false),
    ('plot_type', 'status_plots', 'Status plots', 'the_demotion', 'The demotion', 'Loss of status reveals character.', null, null, 64, false),
    ('plot_type', 'status_plots', 'Status plots', 'class_reversal', 'Class reversal', 'The powerful become powerless, or vice versa.', null, null, 65, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'grief_journey', 'Grief journey', 'A character learns to live after loss.', null, null, 66, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'healing', 'Healing', 'A wounded character gradually becomes whole.', null, null, 67, true),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'trauma_recovery', 'Trauma recovery', 'A character confronts damage from the past.', null, null, 68, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'facing_fear', 'Facing fear', 'A character must confront their deepest fear.', null, null, 69, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'loss_of_innocence', 'Loss of innocence', 'A character discovers the world is darker than believed.', null, null, 70, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'cynic_learns_hope', 'Cynic learns hope', 'A hardened person regains belief.', null, null, 71, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'idealist_becomes_realist', 'Idealist becomes realist', 'A naive person learns complexity.', null, null, 72, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'realist_becomes_idealist', 'Realist becomes idealist', 'A practical person learns to believe in something bigger.', null, null, 73, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'self_acceptance', 'Self-acceptance', 'A character stops rejecting who they are.', null, null, 74, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'self_destruction', 'Self-destruction', 'A character spirals because of inner flaws.', null, null, 75, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'obsession', 'Obsession', 'A fixation consumes a character.', null, null, 76, true),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'addiction', 'Addiction', 'Desire becomes dependency and threatens life.', null, null, 77, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'madness_descent', 'Madness descent', 'A character loses grip on reality.', null, null, 78, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'paranoia', 'Paranoia', 'A character suspects hidden danger, perhaps correctly.', null, null, 79, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'guilt', 'Guilt', 'A character is haunted by what they did or failed to do.', null, null, 80, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'confession', 'Confession', 'A hidden truth must be admitted.', null, null, 81, true),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'forgiveness', 'Forgiveness', 'A character must forgive or be forgiven.', null, null, 82, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'shame', 'Shame', 'A character hides a perceived stain.', null, null, 83, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'envy', 'Envy', 'A character is consumed by another’s success.', null, null, 84, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'jealousy', 'Jealousy', 'Fear of losing love/status drives action.', null, null, 85, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'pride_before_fall', 'Pride before fall', 'Arrogance causes ruin.', null, null, 86, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'humbling', 'Humbling', 'A proud character is forced to grow.', null, null, 87, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'moral_awakening', 'Moral awakening', 'A character realizes they are complicit in harm.', null, null, 88, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'identity_crisis', 'Identity crisis', 'A character’s sense of self collapses.', null, null, 89, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'midlife_crisis', 'Midlife crisis', 'A character questions the life they built.', null, null, 90, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'existential_crisis', 'Existential crisis', 'A character confronts meaninglessness, mortality, or freedom.', null, null, 91, false),
    ('plot_type', 'emotional_psychological_plots', 'Emotional / psychological plots', 'second_chance_at_life', 'Second chance at life', 'A character gets a new beginning.', null, null, 92, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'enemies_to_lovers', 'Enemies to lovers', 'Hostility becomes romance.', null, null, 93, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'friends_to_lovers', 'Friends to lovers', 'Friendship becomes romance.', null, null, 94, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'lovers_to_enemies', 'Lovers to enemies', 'Romance turns into rivalry or hatred.', null, null, 95, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'marriage_under_strain', 'Marriage under strain', 'A couple faces pressures that reveal truth.', null, null, 96, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'divorce_separation', 'Divorce / separation', 'A relationship breaks and characters rebuild.', null, null, 97, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'reunion_romance', 'Reunion romance', 'Former lovers reconnect.', null, null, 98, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'fake_relationship', 'Fake relationship', 'Pretend romance becomes real or useful.', null, null, 99, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'arranged_marriage', 'Arranged marriage', 'Duty-based pairing becomes conflict or love.', null, null, 100, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'secret_affair', 'Secret affair', 'Hidden desire threatens existing bonds.', null, null, 101, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'forbidden_affair', 'Forbidden affair', 'Love violates rules, vows, class, law, or taboo.', null, null, 102, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'unrequited_love', 'Unrequited love', 'Love is not returned.', null, null, 103, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'love_vs_duty', 'Love vs duty', 'A character must choose between feeling and obligation.', null, null, 104, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'love_vs_ambition', 'Love vs ambition', 'Career/power conflicts with intimacy.', null, null, 105, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'parent_child_reconciliation', 'Parent-child reconciliation', 'Estranged family members repair connection.', null, null, 106, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'parent_child_conflict', 'Parent-child conflict', 'Generational values collide.', null, null, 107, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'sibling_rivalry', 'Sibling rivalry', 'Brothers/sisters compete for love, power, or identity.', null, null, 108, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'found_family', 'Found family', 'Misfits create a chosen family.', null, null, 109, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'betrayal_by_friend', 'Betrayal by friend', 'Trust is broken by someone close.', null, null, 110, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'friendship_tested', 'Friendship tested', 'A bond is strained by secrets, jealousy, danger, or growth.', null, null, 111, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'mentor_betrayal', 'Mentor betrayal', 'A trusted guide is corrupt or deceptive.', null, null, 112, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'student_surpasses_master', 'Student surpasses master', 'The apprentice exceeds the teacher.', null, null, 113, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'odd_couple', 'Odd couple', 'Two incompatible people must cooperate.', null, null, 114, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'buddy_journey', 'Buddy journey', 'Two companions change through shared adventure.', null, null, 115, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'team_formation', 'Team formation', 'Individuals become a functioning group.', null, null, 116, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'team_fracture', 'Team fracture', 'A group breaks under pressure.', null, null, 117, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'reconciliation', 'Reconciliation', 'Broken bonds are restored.', null, null, 118, false),
    ('plot_type', 'relationship_plots', 'Relationship plots', 'chosen_family_vs_blood_family', 'Chosen family vs blood family', 'A character chooses between inherited and self-made belonging.', null, null, 119, false),
    ('plot_type', 'moral_dilemma_plots', 'Moral dilemma plots', 'ends_justify_the_means', 'Ends justify the means', 'A character does wrong for a supposedly good goal.', null, null, 120, false),
    ('plot_type', 'moral_dilemma_plots', 'Moral dilemma plots', 'greater_good_sacrifice', 'Greater good sacrifice', 'One must suffer so many can be saved.', null, null, 121, false),
    ('plot_type', 'moral_dilemma_plots', 'Moral dilemma plots', 'truth_vs_loyalty', 'Truth vs loyalty', 'A character must choose honesty or allegiance.', null, null, 122, false),
    ('plot_type', 'moral_dilemma_plots', 'Moral dilemma plots', 'justice_vs_mercy', 'Justice vs mercy', 'Punishment conflicts with compassion.', null, null, 123, false),
    ('plot_type', 'moral_dilemma_plots', 'Moral dilemma plots', 'law_vs_morality', 'Law vs morality', 'Legal duty conflicts with ethical duty.', null, null, 124, false),
    ('plot_type', 'moral_dilemma_plots', 'Moral dilemma plots', 'duty_vs_desire', 'Duty vs desire', 'Responsibility conflicts with personal longing.', null, null, 125, false),
    ('plot_type', 'moral_dilemma_plots', 'Moral dilemma plots', 'family_vs_society', 'Family vs society', 'Protecting loved ones conflicts with public good.', null, null, 126, false),
    ('plot_type', 'moral_dilemma_plots', 'Moral dilemma plots', 'security_vs_freedom', 'Security vs freedom', 'Safety measures threaten liberty.', null, null, 127, false),
    ('plot_type', 'moral_dilemma_plots', 'Moral dilemma plots', 'ambition_vs_integrity', 'Ambition vs integrity', 'Success requires compromise.', null, null, 128, false),
    ('plot_type', 'moral_dilemma_plots', 'Moral dilemma plots', 'survival_vs_humanity', 'Survival vs humanity', 'Staying alive risks becoming cruel.', null, null, 129, false),
    ('plot_type', 'moral_dilemma_plots', 'Moral dilemma plots', 'revenge_vs_forgiveness', 'Revenge vs forgiveness', 'A character chooses payback or release.', null, null, 130, false),
    ('plot_type', 'moral_dilemma_plots', 'Moral dilemma plots', 'secrecy_vs_disclosure', 'Secrecy vs disclosure', 'Keeping a secret protects and harms.', null, null, 131, false),
    ('plot_type', 'moral_dilemma_plots', 'Moral dilemma plots', 'creation_vs_destruction', 'Creation vs destruction', 'A character’s invention or power may save or ruin.', null, null, 132, false),
    ('plot_type', 'moral_dilemma_plots', 'Moral dilemma plots', 'mercy_killing', 'Mercy killing', 'Compassion and death collide.', null, null, 133, false),
    ('plot_type', 'moral_dilemma_plots', 'Moral dilemma plots', 'whistleblower', 'Whistleblower', 'A character exposes corruption at personal cost.', null, null, 134, false),
    ('plot_type', 'moral_dilemma_plots', 'Moral dilemma plots', 'scapegoat', 'Scapegoat', 'One person is blamed to protect others.', null, null, 135, false),
    ('plot_type', 'moral_dilemma_plots', 'Moral dilemma plots', 'false_confession', 'False confession', 'Someone takes blame for another.', null, null, 136, false),
    ('plot_type', 'moral_dilemma_plots', 'Moral dilemma plots', 'trolley_problem', 'Trolley problem', 'A character must choose who lives or dies.', null, null, 137, false),
    ('plot_type', 'moral_dilemma_plots', 'Moral dilemma plots', 'the_corrupt_bargain', 'The corrupt bargain', 'A moral compromise brings temporary gain.', null, null, 138, false),
    ('plot_type', 'moral_dilemma_plots', 'Moral dilemma plots', 'the_necessary_lie', 'The necessary lie', 'A lie protects someone, but creates consequences.', null, null, 139, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'whodunit', 'Whodunit', 'Find the killer or culprit.', null, null, 140, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'howcatchem', 'Howcatchem', 'We know the culprit; the story is proving it.', null, null, 141, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'locked_room_mystery', 'Locked-room mystery', 'A crime seems physically impossible.', null, null, 142, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'cold_case', 'Cold case', 'An old mystery resurfaces.', null, null, 143, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'missing_person', 'Missing person', 'Someone disappears and must be found.', null, null, 144, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'false_accusation', 'False accusation', 'An innocent person must prove innocence.', null, null, 145, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'framed_protagonist', 'Framed protagonist', 'Someone is set up by a hidden enemy.', null, null, 146, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'wrong_man_wrong_woman', 'Wrong man / wrong woman', 'An ordinary person is mistaken for a criminal/spy.', null, null, 147, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'serial_killer_hunt', 'Serial killer hunt', 'A pattern of crimes must be stopped.', null, null, 148, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'cat_and_mouse', 'Cat and mouse', 'Hunter and hunted maneuver against each other.', null, null, 149, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'conspiracy_uncovering', 'Conspiracy uncovering', 'A vast hidden system is exposed.', null, null, 150, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'political_thriller', 'Political thriller', 'Power, secrecy, and danger intersect in politics.', null, null, 151, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'corporate_thriller', 'Corporate thriller', 'Business corruption becomes dangerous.', null, null, 152, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'legal_thriller', 'Legal thriller', 'Courtroom or legal process reveals danger/truth.', null, null, 153, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'medical_thriller', 'Medical thriller', 'Disease, experiment, or institution hides danger.', null, null, 154, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'techno_thriller', 'Techno-thriller', 'Technology creates or reveals threat.', null, null, 155, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'psychological_thriller', 'Psychological thriller', 'The mind itself becomes the battleground.', null, null, 156, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'home_invasion', 'Home invasion', 'Safety of home is violated.', null, null, 157, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'stalker_plot', 'Stalker plot', 'A character is pursued by obsession.', null, null, 158, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'kidnapping', 'Kidnapping', 'Captivity creates pressure and rescue stakes.', null, null, 159, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'blackmail', 'Blackmail', 'A secret is weaponized.', null, null, 160, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'witness_protection', 'Witness protection', 'A witness must hide from danger.', null, null, 161, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'undercover_operation', 'Undercover operation', 'A character infiltrates a group.', null, null, 162, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'double_agent', 'Double agent', 'Loyalty is uncertain.', null, null, 163, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'mole_hunt', 'Mole hunt', 'A group searches for the traitor within.', null, null, 164, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'heist_gone_wrong', 'Heist gone wrong', 'A plan collapses under pressure.', null, null, 165, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'perfect_crime_unraveling', 'Perfect crime unraveling', 'A brilliant crime contains one flaw.', null, null, 166, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'one_last_job', 'One last job', 'A criminal/professional returns for a final mission.', null, null, 167, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'prison_break', 'Prison break', 'Characters escape confinement.', null, null, 168, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'manhunt', 'Manhunt', 'A fugitive is pursued.', null, null, 169, false),
    ('plot_type', 'mystery_crime_thriller_plots', 'Mystery, crime, and thriller plots', 'trial_of_innocence', 'Trial of innocence', 'A court case reveals deeper truth.', null, null, 170, false),
    ('plot_type', 'adventure_action_plots', 'Adventure and action plots', 'treasure_hunt', 'Treasure hunt', 'Characters search for hidden riches or relics.', null, null, 171, false),
    ('plot_type', 'adventure_action_plots', 'Adventure and action plots', 'expedition', 'Expedition', 'A team enters dangerous terrain.', null, null, 172, false),
    ('plot_type', 'adventure_action_plots', 'Adventure and action plots', 'race_against_time', 'Race against time', 'A deadline creates urgency.', null, null, 173, false),
    ('plot_type', 'adventure_action_plots', 'Adventure and action plots', 'disaster_survival', 'Disaster survival', 'Characters survive catastrophe.', null, null, 174, false),
    ('plot_type', 'adventure_action_plots', 'Adventure and action plots', 'siege', 'Siege', 'A group defends a place against attack.', null, null, 175, false),
    ('plot_type', 'adventure_action_plots', 'Adventure and action plots', 'infiltration', 'Infiltration', 'Characters enter enemy territory.', null, null, 176, false),
    ('plot_type', 'adventure_action_plots', 'Adventure and action plots', 'extraction', 'Extraction', 'Characters remove someone from danger.', null, null, 177, false),
    ('plot_type', 'adventure_action_plots', 'Adventure and action plots', 'assassination_mission', 'Assassination mission', 'A target must be killed or protected.', null, null, 178, false),
    ('plot_type', 'adventure_action_plots', 'Adventure and action plots', 'bodyguard_plot', 'Bodyguard plot', 'A protector and protected person are forced together.', null, null, 179, false),
    ('plot_type', 'adventure_action_plots', 'Adventure and action plots', 'tournament', 'Tournament', 'Characters compete through escalating rounds.', null, null, 180, false),
    ('plot_type', 'adventure_action_plots', 'Adventure and action plots', 'training_arc', 'Training arc', 'A weak character becomes capable.', null, null, 181, false),
    ('plot_type', 'adventure_action_plots', 'Adventure and action plots', 'road_trip', 'Road trip', 'Travel forces transformation.', null, null, 182, false),
    ('plot_type', 'adventure_action_plots', 'Adventure and action plots', 'chase_story', 'Chase story', 'Movement and pursuit drive the plot.', null, null, 183, false),
    ('plot_type', 'adventure_action_plots', 'Adventure and action plots', 'lost_in_wilderness', 'Lost in wilderness', 'Survival in nature reveals character.', null, null, 184, false),
    ('plot_type', 'adventure_action_plots', 'Adventure and action plots', 'shipwreck_stranded', 'Shipwreck / stranded', 'Isolation forces new social order.', null, null, 185, false),
    ('plot_type', 'adventure_action_plots', 'Adventure and action plots', 'mutiny', 'Mutiny', 'Subordinates revolt against leadership.', null, null, 186, false),
    ('plot_type', 'adventure_action_plots', 'Adventure and action plots', 'bounty_hunt', 'Bounty hunt', 'A character pursues a person for reward or justice.', null, null, 187, false),
    ('plot_type', 'adventure_action_plots', 'Adventure and action plots', 'rescue_mission', 'Rescue mission', 'A person/group must be saved.', null, null, 188, false),
    ('plot_type', 'adventure_action_plots', 'Adventure and action plots', 'last_stand', 'Last stand', 'Characters face overwhelming odds.', null, null, 189, false),
    ('plot_type', 'adventure_action_plots', 'Adventure and action plots', 'escape_from_collapsing_world', 'Escape from collapsing world', 'A place or system is dying and must be fled.', null, null, 190, false),
    ('plot_type', 'adventure_action_plots', 'Adventure and action plots', 'quest_for_cure', 'Quest for cure', 'Characters seek medicine, magic, or solution.', null, null, 191, false),
    ('plot_type', 'fantasy_mythic_plots', 'Fantasy and mythic plots', 'heros_journey', 'Hero’s journey', 'Ordinary person enters adventure, transforms, returns.', null, null, 192, false),
    ('plot_type', 'fantasy_mythic_plots', 'Fantasy and mythic plots', 'chosen_one_prophecy', 'Chosen one prophecy', 'Destiny singles out a hero.', null, null, 193, false),
    ('plot_type', 'fantasy_mythic_plots', 'Fantasy and mythic plots', 'prophecy_misread', 'Prophecy misread', 'The predicted meaning is misunderstood.', null, null, 194, false),
    ('plot_type', 'fantasy_mythic_plots', 'Fantasy and mythic plots', 'dragon_slayer', 'Dragon slayer', 'A hero confronts a monstrous power.', null, null, 195, false),
    ('plot_type', 'fantasy_mythic_plots', 'Fantasy and mythic plots', 'dark_lord_rising', 'Dark lord rising', 'Evil returns and must be stopped.', null, null, 196, false),
    ('plot_type', 'fantasy_mythic_plots', 'Fantasy and mythic plots', 'lost_heir', 'Lost heir', 'A hidden royal or rightful leader is revealed.', null, null, 197, false),
    ('plot_type', 'fantasy_mythic_plots', 'Fantasy and mythic plots', 'magic_awakening', 'Magic awakening', 'A character discovers magical ability.', null, null, 198, false),
    ('plot_type', 'fantasy_mythic_plots', 'Fantasy and mythic plots', 'cursed_hero', 'Cursed hero', 'A curse shapes the quest.', null, null, 199, false),
    ('plot_type', 'fantasy_mythic_plots', 'Fantasy and mythic plots', 'breaking_the_curse', 'Breaking the curse', 'Characters seek liberation from enchantment/fate.', null, null, 200, false),
    ('plot_type', 'fantasy_mythic_plots', 'Fantasy and mythic plots', 'forbidden_magic', 'Forbidden magic', 'Power comes with moral/spiritual danger.', null, null, 201, false),
    ('plot_type', 'fantasy_mythic_plots', 'Fantasy and mythic plots', 'quest_for_artifact', 'Quest for artifact', 'A magical object must be found, used, or destroyed.', null, null, 202, false),
    ('plot_type', 'fantasy_mythic_plots', 'Fantasy and mythic plots', 'portal_fantasy', 'Portal fantasy', 'Characters enter another world.', null, null, 203, false),
    ('plot_type', 'fantasy_mythic_plots', 'Fantasy and mythic plots', 'hidden_magical_world', 'Hidden magical world', 'A secret realm exists within the ordinary world.', null, null, 204, false),
    ('plot_type', 'fantasy_mythic_plots', 'Fantasy and mythic plots', 'gods_among_humans', 'Gods among humans', 'Divine beings interfere with mortal life.', null, null, 205, false),
    ('plot_type', 'fantasy_mythic_plots', 'Fantasy and mythic plots', 'mortal_challenges_gods', 'Mortal challenges gods', 'Humans resist divine power.', null, null, 206, false),
    ('plot_type', 'fantasy_mythic_plots', 'Fantasy and mythic plots', 'beast_transformed', 'Beast transformed', 'A monster/person is changed by love, truth, or sacrifice.', null, null, 207, false),
    ('plot_type', 'fantasy_mythic_plots', 'Fantasy and mythic plots', 'deal_with_supernatural_being', 'Deal with supernatural being', 'A bargain creates magical consequences.', null, null, 208, false),
    ('plot_type', 'fantasy_mythic_plots', 'Fantasy and mythic plots', 'myth_retelling', 'Myth retelling', 'Ancient story is reimagined.', null, null, 209, false),
    ('plot_type', 'fantasy_mythic_plots', 'Fantasy and mythic plots', 'fall_of_kingdom', 'Fall of kingdom', 'A realm collapses through war, betrayal, or corruption.', null, null, 210, false),
    ('plot_type', 'fantasy_mythic_plots', 'Fantasy and mythic plots', 'restoration_of_kingdom', 'Restoration of kingdom', 'A broken land is healed.', null, null, 211, false),
    ('plot_type', 'fantasy_mythic_plots', 'Fantasy and mythic plots', 'apprentice_mage', 'Apprentice mage', 'A novice learns dangerous power.', null, null, 212, false),
    ('plot_type', 'fantasy_mythic_plots', 'Fantasy and mythic plots', 'monster_as_misunderstood', 'Monster as misunderstood', 'The apparent villain is humanized.', null, null, 213, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'first_contact', 'First contact', 'Humanity encounters alien life.', null, null, 214, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'alien_invasion', 'Alien invasion', 'External beings threaten Earth/society.', null, null, 215, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'alien_integration', 'Alien integration', 'Different species/cultures must coexist.', null, null, 216, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'colonization', 'Colonization', 'Humans settle a new world.', null, null, 217, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'generation_ship', 'Generation ship', 'Society evolves during long space travel.', null, null, 218, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'time_travel_correction', 'Time travel correction', 'Characters fix or cause timeline problems.', null, null, 219, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'time_loop', 'Time loop', 'Characters relive events until change occurs.', null, null, 220, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'alternate_history', 'Alternate history', 'One changed event creates a new world.', null, null, 221, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'parallel_universe', 'Parallel universe', 'Characters encounter alternate realities.', null, null, 222, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'simulation_reveal', 'Simulation reveal', 'Reality is discovered to be artificial.', null, null, 223, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'ai_awakening', 'AI awakening', 'Artificial intelligence becomes conscious or autonomous.', null, null, 224, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'robot_rebellion', 'Robot rebellion', 'Created beings revolt.', null, null, 225, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'human_machine_merger', 'Human-machine merger', 'Identity changes through technology.', null, null, 226, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'cloning_identity', 'Cloning identity', 'Copies challenge individuality.', null, null, 227, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'memory_manipulation', 'Memory manipulation', 'Identity is altered through erased/implanted memories.', null, null, 228, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'genetic_engineering', 'Genetic engineering', 'Designed life creates moral/social consequences.', null, null, 229, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'dystopian_rebellion', 'Dystopian rebellion', 'Characters resist oppressive future society.', null, null, 230, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'utopian_facade', 'Utopian facade', 'A perfect society hides horror.', null, null, 231, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'post_apocalyptic_survival', 'Post-apocalyptic survival', 'Life after collapse.', null, null, 232, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'rebuilding_civilization', 'Rebuilding civilization', 'Survivors create a new order.', null, null, 233, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'terraforming_conflict', 'Terraforming conflict', 'A planet is changed, with consequences.', null, null, 234, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'space_rescue', 'Space rescue', 'Characters survive or save others in space.', null, null, 235, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'scientific_hubris', 'Scientific hubris', 'Discovery outpaces wisdom.', null, null, 236, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'experiment_escapes_control', 'Experiment escapes control', 'A creation or test becomes dangerous.', null, null, 237, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'immortality_problem', 'Immortality problem', 'Eternal life creates unexpected costs.', null, null, 238, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'uploading_consciousness', 'Uploading consciousness', 'Mind and body separate.', null, null, 239, false),
    ('plot_type', 'science_fiction_plots', 'Science fiction plots', 'future_crime', 'Future crime', 'Technology changes justice, surveillance, or guilt.', null, null, 240, false),
    ('plot_type', 'horror_plots', 'Horror plots', 'haunted_house', 'Haunted house', 'A place contains supernatural evil or memory.', null, null, 241, false),
    ('plot_type', 'horror_plots', 'Horror plots', 'possession', 'Possession', 'A person is taken over by another force.', null, null, 242, false),
    ('plot_type', 'horror_plots', 'Horror plots', 'exorcism', 'Exorcism', 'Characters try to expel evil.', null, null, 243, false),
    ('plot_type', 'horror_plots', 'Horror plots', 'monster_in_the_dark', 'Monster in the dark', 'A creature hunts characters.', null, null, 244, false),
    ('plot_type', 'horror_plots', 'Horror plots', 'slasher', 'Slasher', 'A killer stalks victims.', null, null, 245, false),
    ('plot_type', 'horror_plots', 'Horror plots', 'folk_horror', 'Folk horror', 'Ancient rituals/community secrets create dread.', null, null, 246, false),
    ('plot_type', 'horror_plots', 'Horror plots', 'body_horror', 'Body horror', 'The body mutates, decays, or betrays.', null, null, 247, false),
    ('plot_type', 'horror_plots', 'Horror plots', 'cosmic_horror', 'Cosmic horror', 'Characters confront incomprehensible forces.', null, null, 248, false),
    ('plot_type', 'horror_plots', 'Horror plots', 'psychological_horror', 'Psychological horror', 'Fear comes from perception, guilt, or madness.', null, null, 249, false),
    ('plot_type', 'horror_plots', 'Horror plots', 'cursed_object', 'Cursed object', 'An item brings doom.', null, null, 250, false),
    ('plot_type', 'horror_plots', 'Horror plots', 'cursed_place', 'Cursed place', 'A location traps or corrupts.', null, null, 251, false),
    ('plot_type', 'horror_plots', 'Horror plots', 'family_secret_horror', 'Family secret horror', 'Inherited sin returns.', null, null, 252, false),
    ('plot_type', 'horror_plots', 'Horror plots', 'cult_horror', 'Cult horror', 'A group worships/serves a dark force.', null, null, 253, false),
    ('plot_type', 'horror_plots', 'Horror plots', 'creature_feature', 'Creature feature', 'Humans face a dangerous animal/monster.', null, null, 254, false),
    ('plot_type', 'horror_plots', 'Horror plots', 'infection_horror', 'Infection horror', 'Disease or transformation spreads.', null, null, 255, false),
    ('plot_type', 'horror_plots', 'Horror plots', 'doppelg_nger_horror', 'Doppelgänger horror', 'A double threatens identity.', null, null, 256, false),
    ('plot_type', 'horror_plots', 'Horror plots', 'home_horror', 'Home horror', 'Domestic life becomes terrifying.', null, null, 257, false),
    ('plot_type', 'horror_plots', 'Horror plots', 'child_horror', 'Child horror', 'A child is dangerous, haunted, or prophetic.', null, null, 258, false),
    ('plot_type', 'horror_plots', 'Horror plots', 'revenant_revenge', 'Revenant revenge', 'The dead return to punish.', null, null, 259, false),
    ('plot_type', 'horror_plots', 'Horror plots', 'curiosity_punished', 'Curiosity punished', 'Characters investigate what should stay hidden.', null, null, 260, false),
    ('plot_type', 'horror_plots', 'Horror plots', 'survival_horror', 'Survival horror', 'Escape from a horrifying environment.', null, null, 261, false),
    ('plot_type', 'comedy_plots', 'Comedy plots', 'mistaken_identity_farce', 'Mistaken identity farce', 'Misrecognition escalates chaos.', null, null, 262, false),
    ('plot_type', 'comedy_plots', 'Comedy plots', 'fish_out_of_water_comedy', 'Fish-out-of-water comedy', 'Incompatibility creates humor.', null, null, 263, false),
    ('plot_type', 'comedy_plots', 'Comedy plots', 'odd_couple_comedy', 'Odd couple comedy', 'Two mismatched people must coexist.', null, null, 264, false),
    ('plot_type', 'comedy_plots', 'Comedy plots', 'romantic_comedy', 'Romantic comedy', 'Love emerges through obstacles and misunderstandings.', null, null, 265, false),
    ('plot_type', 'comedy_plots', 'Comedy plots', 'remarriage_comedy', 'Remarriage comedy', 'A separated couple finds their way back.', null, null, 266, false),
    ('plot_type', 'comedy_plots', 'Comedy plots', 'workplace_comedy', 'Workplace comedy', 'Professional life creates absurd conflict.', null, null, 267, false),
    ('plot_type', 'comedy_plots', 'Comedy plots', 'family_chaos', 'Family chaos', 'Family dynamics spiral into comic disorder.', null, null, 268, false),
    ('plot_type', 'comedy_plots', 'Comedy plots', 'social_satire', 'Social satire', 'Society’s flaws are exaggerated.', null, null, 269, false),
    ('plot_type', 'comedy_plots', 'Comedy plots', 'political_satire', 'Political satire', 'Power and ideology are mocked.', null, null, 270, false),
    ('plot_type', 'comedy_plots', 'Comedy plots', 'manners_comedy', 'Manners comedy', 'Etiquette and class rules create conflict.', null, null, 271, false),
    ('plot_type', 'comedy_plots', 'Comedy plots', 'screwball_comedy', 'Screwball comedy', 'Fast, absurd romance/conflict between opposites.', null, null, 272, false),
    ('plot_type', 'comedy_plots', 'Comedy plots', 'buddy_comedy', 'Buddy comedy', 'Friendship and incompatibility drive humor.', null, null, 273, false),
    ('plot_type', 'comedy_plots', 'Comedy plots', 'coming_of_age_comedy', 'Coming-of-age comedy', 'Growing up is awkward and funny.', null, null, 274, false),
    ('plot_type', 'comedy_plots', 'Comedy plots', 'disaster_comedy', 'Disaster comedy', 'Everything goes wrong.', null, null, 275, false),
    ('plot_type', 'comedy_plots', 'Comedy plots', 'impostor_comedy', 'Impostor comedy', 'Fake identity creates escalating lies.', null, null, 276, false),
    ('plot_type', 'comedy_plots', 'Comedy plots', 'scheme_comedy', 'Scheme comedy', 'A foolish plan snowballs.', null, null, 277, false),
    ('plot_type', 'comedy_plots', 'Comedy plots', 'reversal_comedy', 'Reversal comedy', 'Roles/status are flipped.', null, null, 278, false),
    ('plot_type', 'comedy_plots', 'Comedy plots', 'meta_comedy', 'Meta comedy', 'The story jokes about storytelling itself.', null, null, 279, false),
    ('plot_type', 'family_community_social_plots', 'Family, community, and social plots', 'family_reunion', 'Family reunion', 'Gathering exposes buried conflict.', null, null, 280, false),
    ('plot_type', 'family_community_social_plots', 'Family, community, and social plots', 'holiday_gathering', 'Holiday gathering', 'Ritual occasion creates pressure.', null, null, 281, false),
    ('plot_type', 'family_community_social_plots', 'Family, community, and social plots', 'wedding_chaos', 'Wedding chaos', 'A ceremony brings secrets/conflict to surface.', null, null, 282, false),
    ('plot_type', 'family_community_social_plots', 'Family, community, and social plots', 'funeral_reckoning', 'Funeral reckoning', 'A death forces truth.', null, null, 283, false),
    ('plot_type', 'family_community_social_plots', 'Family, community, and social plots', 'small_town_secret', 'Small town secret', 'A community hides something.', null, null, 284, false),
    ('plot_type', 'family_community_social_plots', 'Family, community, and social plots', 'neighborhood_conflict', 'Neighborhood conflict', 'Local dispute reveals broader values.', null, null, 285, false),
    ('plot_type', 'family_community_social_plots', 'Family, community, and social plots', 'community_under_threat', 'Community under threat', 'A place/group must unite to survive.', null, null, 286, false),
    ('plot_type', 'family_community_social_plots', 'Family, community, and social plots', 'gentrification_story', 'Gentrification story', 'Change threatens identity and belonging.', null, null, 287, false),
    ('plot_type', 'family_community_social_plots', 'Family, community, and social plots', 'immigrant_story', 'Immigrant story', 'A character navigates cultural transition.', null, null, 288, false),
    ('plot_type', 'family_community_social_plots', 'Family, community, and social plots', 'generational_saga', 'Generational saga', 'Family history unfolds across time.', null, null, 289, false),
    ('plot_type', 'family_community_social_plots', 'Family, community, and social plots', 'inheritance_of_trauma', 'Inheritance of trauma', 'Past harm shapes descendants.', null, null, 290, false),
    ('plot_type', 'family_community_social_plots', 'Family, community, and social plots', 'tradition_vs_modernity', 'Tradition vs modernity', 'Old customs clash with new life.', null, null, 291, false),
    ('plot_type', 'family_community_social_plots', 'Family, community, and social plots', 'leaving_home', 'Leaving home', 'A character must depart to grow.', null, null, 292, false),
    ('plot_type', 'family_community_social_plots', 'Family, community, and social plots', 'returning_home', 'Returning home', 'A character comes back changed.', null, null, 293, false),
    ('plot_type', 'family_community_social_plots', 'Family, community, and social plots', 'founding_a_community', 'Founding a community', 'People build a new social order.', null, null, 294, false),
    ('plot_type', 'family_community_social_plots', 'Family, community, and social plots', 'community_corruption', 'Community corruption', 'A society’s rot is exposed.', null, null, 295, false),
    ('plot_type', 'family_community_social_plots', 'Family, community, and social plots', 'collective_healing', 'Collective healing', 'A group recovers after trauma/disaster.', null, null, 296, false),
    ('plot_type', 'professional_ambition_plots', 'Professional / ambition plots', 'making_the_masterpiece', 'Making the masterpiece', 'An artist struggles to create great work.', null, null, 297, false),
    ('plot_type', 'professional_ambition_plots', 'Professional / ambition plots', 'breaking_into_the_industry', 'Breaking into the industry', 'A newcomer fights for access.', null, null, 298, false),
    ('plot_type', 'professional_ambition_plots', 'Professional / ambition plots', 'the_big_audition', 'The big audition', 'A chance to be chosen defines the plot.', null, null, 299, false),
    ('plot_type', 'professional_ambition_plots', 'Professional / ambition plots', 'startup_rise', 'Startup rise', 'A company is built under pressure.', null, null, 300, false),
    ('plot_type', 'professional_ambition_plots', 'Professional / ambition plots', 'startup_collapse', 'Startup collapse', 'Ambition and hype destroy a company.', null, null, 301, false),
    ('plot_type', 'professional_ambition_plots', 'Professional / ambition plots', 'scientific_breakthrough', 'Scientific breakthrough', 'Discovery changes lives.', null, null, 302, false),
    ('plot_type', 'professional_ambition_plots', 'Professional / ambition plots', 'journalistic_investigation', 'Journalistic investigation', 'Reporter uncovers truth.', null, null, 303, false),
    ('plot_type', 'professional_ambition_plots', 'Professional / ambition plots', 'election_campaign', 'Election campaign', 'A candidate fights for office.', null, null, 304, false),
    ('plot_type', 'professional_ambition_plots', 'Professional / ambition plots', 'sports_championship', 'Sports championship', 'Team/athlete pursues victory.', null, null, 305, false),
    ('plot_type', 'professional_ambition_plots', 'Professional / ambition plots', 'military_command', 'Military command', 'Leadership is tested in war.', null, null, 306, false),
    ('plot_type', 'professional_ambition_plots', 'Professional / ambition plots', 'trial_lawyer_plot', 'Trial lawyer plot', 'A lawyer must win or reveal truth.', null, null, 307, false),
    ('plot_type', 'professional_ambition_plots', 'Professional / ambition plots', 'doctor_under_pressure', 'Doctor under pressure', 'Medicine creates moral/professional stakes.', null, null, 308, false),
    ('plot_type', 'professional_ambition_plots', 'Professional / ambition plots', 'chef_restaurant_plot', 'Chef/restaurant plot', 'Food, artistry, and pressure collide.', null, null, 309, false),
    ('plot_type', 'professional_ambition_plots', 'Professional / ambition plots', 'artist_vs_commerce', 'Artist vs commerce', 'Creativity conflicts with market demands.', null, null, 310, false),
    ('plot_type', 'professional_ambition_plots', 'Professional / ambition plots', 'workplace_rebellion', 'Workplace rebellion', 'Employees resist bosses/system.', null, null, 311, false),
    ('plot_type', 'professional_ambition_plots', 'Professional / ambition plots', 'corporate_takeover', 'Corporate takeover', 'A company’s future becomes battleground.', null, null, 312, false),
    ('plot_type', 'professional_ambition_plots', 'Professional / ambition plots', 'mentorship_career_plot', 'Mentorship career plot', 'A professional is shaped by a guide.', null, null, 313, false),
    ('plot_type', 'professional_ambition_plots', 'Professional / ambition plots', 'burnout_and_renewal', 'Burnout and renewal', 'A successful person loses and regains purpose.', null, null, 314, false),
    ('plot_type', 'political_societal_plots', 'Political and societal plots', 'rebellion_against_tyranny', 'Rebellion against tyranny', 'People resist oppressive rule.', null, null, 315, false),
    ('plot_type', 'political_societal_plots', 'Political and societal plots', 'insider_reform', 'Insider reform', 'A character tries to change a system from within.', null, null, 316, false),
    ('plot_type', 'political_societal_plots', 'Political and societal plots', 'corruption_exposure', 'Corruption exposure', 'Hidden abuse of power is revealed.', null, null, 317, true),
    ('plot_type', 'political_societal_plots', 'Political and societal plots', 'whistleblower_story', 'Whistleblower story', 'Truth-teller risks everything.', null, null, 318, false),
    ('plot_type', 'political_societal_plots', 'Political and societal plots', 'scandal', 'Scandal', 'Public revelation reshapes power.', null, null, 319, false),
    ('plot_type', 'political_societal_plots', 'Political and societal plots', 'election_drama', 'Election drama', 'Campaign reveals ideals and compromises.', null, null, 320, false),
    ('plot_type', 'political_societal_plots', 'Political and societal plots', 'regime_collapse', 'Regime collapse', 'A political order falls.', null, null, 321, false),
    ('plot_type', 'political_societal_plots', 'Political and societal plots', 'civil_war', 'Civil war', 'A society splits against itself.', null, null, 322, false),
    ('plot_type', 'political_societal_plots', 'Political and societal plots', 'propaganda_awakening', 'Propaganda awakening', 'A character realizes they were deceived.', null, null, 323, false),
    ('plot_type', 'political_societal_plots', 'Political and societal plots', 'resistance_movement', 'Resistance movement', 'Underground opposition fights power.', null, null, 324, false),
    ('plot_type', 'political_societal_plots', 'Political and societal plots', 'surveillance_state', 'Surveillance state', 'Privacy and freedom are threatened.', null, null, 325, false),
    ('plot_type', 'political_societal_plots', 'Political and societal plots', 'class_revolt', 'Class revolt', 'Economic injustice erupts.', null, null, 326, false),
    ('plot_type', 'political_societal_plots', 'Political and societal plots', 'colonial_resistance', 'Colonial resistance', 'Occupied/oppressed people seek liberation.', null, null, 327, false),
    ('plot_type', 'political_societal_plots', 'Political and societal plots', 'diplomatic_crisis', 'Diplomatic crisis', 'Negotiation may prevent disaster.', null, null, 328, false),
    ('plot_type', 'political_societal_plots', 'Political and societal plots', 'hostage_negotiation', 'Hostage negotiation', 'Lives depend on persuasion.', null, null, 329, false),
    ('plot_type', 'political_societal_plots', 'Political and societal plots', 'peace_process', 'Peace process', 'Former enemies must reconcile.', null, null, 330, false),
    ('plot_type', 'spiritual_philosophical_plots', 'Spiritual and philosophical plots', 'pilgrimage', 'Pilgrimage', 'A journey toward spiritual meaning.', null, null, 331, false),
    ('plot_type', 'spiritual_philosophical_plots', 'Spiritual and philosophical plots', 'crisis_of_faith', 'Crisis of faith', 'Belief is challenged by suffering or truth.', null, null, 332, false),
    ('plot_type', 'spiritual_philosophical_plots', 'Spiritual and philosophical plots', 'conversion', 'Conversion', 'A character changes worldview.', null, null, 333, false),
    ('plot_type', 'spiritual_philosophical_plots', 'Spiritual and philosophical plots', 'false_prophet', 'False prophet', 'A charismatic leader deceives followers.', null, null, 334, false),
    ('plot_type', 'spiritual_philosophical_plots', 'Spiritual and philosophical plots', 'messiah_figure', 'Messiah figure', 'A savior-like character transforms others.', null, null, 335, false),
    ('plot_type', 'spiritual_philosophical_plots', 'Spiritual and philosophical plots', 'martyrdom', 'Martyrdom', 'A character dies or suffers for belief.', null, null, 336, false),
    ('plot_type', 'spiritual_philosophical_plots', 'Spiritual and philosophical plots', 'temptation_by_power', 'Temptation by power', 'Spiritual integrity is tested.', null, null, 337, false),
    ('plot_type', 'spiritual_philosophical_plots', 'Spiritual and philosophical plots', 'search_for_meaning', 'Search for meaning', 'A character seeks purpose.', null, null, 338, false),
    ('plot_type', 'spiritual_philosophical_plots', 'Spiritual and philosophical plots', 'acceptance_of_mortality', 'Acceptance of mortality', 'Death becomes central teacher.', null, null, 339, false),
    ('plot_type', 'spiritual_philosophical_plots', 'Spiritual and philosophical plots', 'afterlife_journey', 'Afterlife journey', 'A character confronts judgment or eternity.', null, null, 340, false),
    ('plot_type', 'spiritual_philosophical_plots', 'Spiritual and philosophical plots', 'reincarnation_memory', 'Reincarnation memory', 'Past lives affect present identity.', null, null, 341, false),
    ('plot_type', 'spiritual_philosophical_plots', 'Spiritual and philosophical plots', 'soul_bargain', 'Soul bargain', 'The soul/self is traded or endangered.', null, null, 342, false),
    ('plot_type', 'spiritual_philosophical_plots', 'Spiritual and philosophical plots', 'miracle_or_fraud', 'Miracle or fraud', 'A supernatural claim may be real or fake.', null, null, 343, false),
    ('plot_type', 'spiritual_philosophical_plots', 'Spiritual and philosophical plots', 'saint_and_sinner', 'Saint and sinner', 'Moral extremes collide.', null, null, 344, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'single_day_story', 'Single-day story', 'Everything happens in one day/night.', null, null, 345, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'real_time_story', 'Real-time story', 'Story unfolds nearly minute-for-minute.', null, null, 346, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'countdown', 'Countdown', 'A deadline drives escalation.', null, null, 347, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'puzzle_box_story', 'Puzzle-box story', 'The audience pieces together nonlinear clues.', null, null, 348, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'rashomon_story', 'Rashomon story', 'Multiple accounts contradict each other.', null, null, 349, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'fractured_timeline', 'Fractured timeline', 'Events are shown out of order.', null, null, 350, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'frame_narrative', 'Frame narrative', 'A story is told inside another story.', null, null, 351, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'story_within_a_story', 'Story within a story', 'Embedded tale mirrors or alters main plot.', null, null, 352, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'parallel_lives', 'Parallel lives', 'Two or more characters’ arcs mirror each other.', null, null, 353, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'intersecting_strangers', 'Intersecting strangers', 'Separate lives collide around an event.', null, null, 354, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'ensemble_mosaic', 'Ensemble mosaic', 'Many characters reveal a larger system/theme.', null, null, 355, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'bottle_story', 'Bottle story', 'Characters are confined to one place.', null, null, 356, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'road_structure', 'Road structure', 'Each stop creates a new test.', null, null, 357, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'tournament_structure', 'Tournament structure', 'Successive rounds escalate.', null, null, 358, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'case_of_the_week', 'Case-of-the-week', 'Repeating external cases reveal character arcs.', null, null, 359, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'mission_of_the_week', 'Mission-of-the-week', 'Episodic objectives drive serial change.', null, null, 360, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'before_after_structure', 'Before/after structure', 'A life is split by a major event.', null, null, 361, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'rise_fall_rise', 'Rise-fall-rise', 'Collapse is followed by reinvention.', null, null, 362, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'false_victory', 'False victory', 'Apparent success reveals deeper problem.', null, null, 363, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'false_defeat', 'False defeat', 'Apparent loss sets up final reversal.', null, null, 364, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'twist_ending', 'Twist ending', 'Final revelation recontextualizes story.', null, null, 365, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'open_ending', 'Open ending', 'Resolution is deliberately incomplete.', null, null, 366, false),
    ('plot_type', 'structural_plot_patterns', 'Structural plot patterns', 'circular_ending', 'Circular ending', 'Story ends where it began, but changed.', null, null, 367, false),
    ('setting', 'time_settings', 'Time settings', 'prehistoric_past', 'Prehistoric past', 'Stone Age, Ice Age, early humans, lost ancient beasts', null, null, 368, false),
    ('setting', 'time_settings', 'Time settings', 'ancient_world', 'Ancient world', 'Egypt, Greece, Rome, Mesopotamia, ancient China, Maya', null, null, 369, false),
    ('setting', 'time_settings', 'Time settings', 'mythic_past', 'Mythic past', 'Gods, heroes, monsters, legendary kingdoms', null, null, 370, false),
    ('setting', 'time_settings', 'Time settings', 'medieval_world', 'Medieval world', 'Castles, knights, monasteries, feudal villages', null, null, 371, false),
    ('setting', 'time_settings', 'Time settings', 'renaissance_early_modern', 'Renaissance / early modern', 'Explorers, artists, plague cities, royal courts', null, null, 372, false),
    ('setting', 'time_settings', 'Time settings', 'age_of_sail', 'Age of sail', 'Pirates, naval empires, island colonies, sea voyages', null, null, 373, false),
    ('setting', 'time_settings', 'Time settings', 'industrial_age', 'Industrial age', 'Factories, railroads, labor movements, smoky cities', null, null, 374, false),
    ('setting', 'time_settings', 'Time settings', 'victorian_gothic_era', 'Victorian / Gothic era', 'Mansions, foggy streets, science, séances, social class', null, null, 375, false),
    ('setting', 'time_settings', 'Time settings', 'old_west_frontier', 'Old West / frontier', 'Lawless towns, ranches, railroads, gold rushes', null, null, 376, false),
    ('setting', 'time_settings', 'Time settings', 'world_war_era', 'World War era', 'Trenches, resistance cells, home fronts, spies', null, null, 377, false),
    ('setting', 'time_settings', 'Time settings', 'mid_century_modern', 'Mid-century modern', '1950s suburbia, Cold War labs, jazz clubs, diners', null, null, 378, false),
    ('setting', 'time_settings', 'Time settings', 'late_20th_century', 'Late 20th century', '1970s crime, 1980s malls, 1990s internet beginnings', null, null, 379, false),
    ('setting', 'time_settings', 'Time settings', 'recent_past', 'Recent past', '2000s, 2010s, pre-smartphone or early social media eras', null, null, 380, false),
    ('setting', 'time_settings', 'Time settings', 'present_day', 'Present day', 'Contemporary cities, families, schools, workplaces', null, null, 381, false),
    ('setting', 'time_settings', 'Time settings', 'near_future', 'Near future', '5–30 years ahead, recognizable world with new tech', null, null, 382, false),
    ('setting', 'time_settings', 'Time settings', 'far_future', 'Far future', 'Centuries or millennia ahead', null, null, 383, false),
    ('setting', 'time_settings', 'Time settings', 'post_human_future', 'Post-human future', 'Humanity transformed, extinct, uploaded, or replaced', null, null, 384, false),
    ('setting', 'time_settings', 'Time settings', 'end_of_time', 'End of time', 'Last days of the universe, final civilization', null, null, 385, false),
    ('setting', 'time_settings', 'Time settings', 'timeless_fairy_tale_time', 'Timeless / fairy-tale time', '“Once upon a time,” vague symbolic setting', null, null, 386, false),
    ('setting', 'time_settings', 'Time settings', 'alternate_history', 'Alternate history', 'A changed version of real history', null, null, 387, false),
    ('setting', 'time_settings', 'Time settings', 'parallel_present', 'Parallel present', 'A world like ours with one major difference', null, null, 388, false),
    ('setting', 'time_settings', 'Time settings', 'cyclical_time', 'Cyclical time', 'Time loops, repeating eras, eternal recurrence', null, null, 389, false),
    ('setting', 'time_settings', 'Time settings', 'nonlinear_time', 'Nonlinear time', 'Past, present, and future coexist or collapse', null, null, 390, false),
    ('setting', 'place_settings', 'Place settings', 'small_town', 'Small town', 'Close-knit community, secrets, gossip, tradition', null, null, 391, false),
    ('setting', 'place_settings', 'Place settings', 'big_city', 'Big city', 'Ambition, anonymity, crime, opportunity', null, null, 392, false),
    ('setting', 'place_settings', 'Place settings', 'suburbs', 'Suburbs', 'Family life, hidden tensions, conformity', null, null, 393, false),
    ('setting', 'place_settings', 'Place settings', 'rural_countryside', 'Rural countryside', 'Farms, isolation, tradition, nature', null, null, 394, false),
    ('setting', 'place_settings', 'Place settings', 'wilderness', 'Wilderness', 'Forest, mountain, desert, jungle, tundra', null, null, 395, false),
    ('setting', 'place_settings', 'Place settings', 'island', 'Island', 'Isolation, paradise, prison, mystery', null, null, 396, false),
    ('setting', 'place_settings', 'Place settings', 'coastal_town', 'Coastal town', 'Fishing village, resort, storms, tourism', null, null, 397, false),
    ('setting', 'place_settings', 'Place settings', 'border_town', 'Border town', 'Smuggling, cultural tension, law enforcement', null, null, 398, false),
    ('setting', 'place_settings', 'Place settings', 'capital_city', 'Capital city', 'Politics, power, palace/government intrigue', null, null, 399, false),
    ('setting', 'place_settings', 'Place settings', 'university_campus', 'University campus', 'Youth, ideas, rivalry, identity', null, null, 400, false),
    ('setting', 'place_settings', 'Place settings', 'school', 'School', 'Coming of age, hierarchy, friendship, bullying', null, null, 401, false),
    ('setting', 'place_settings', 'Place settings', 'hospital', 'Hospital', 'Life/death stakes, ethics, pressure', null, null, 402, false),
    ('setting', 'place_settings', 'Place settings', 'courtroom_law_office', 'Courtroom / law office', 'Justice, secrets, argument, guilt', null, null, 403, false),
    ('setting', 'place_settings', 'Place settings', 'police_station', 'Police station', 'Crime, corruption, investigation', null, null, 404, false),
    ('setting', 'place_settings', 'Place settings', 'prison', 'Prison', 'Survival, hierarchy, escape, redemption', null, null, 405, false),
    ('setting', 'place_settings', 'Place settings', 'military_base', 'Military base', 'Discipline, war, secrecy, loyalty', null, null, 406, false),
    ('setting', 'place_settings', 'Place settings', 'corporate_office', 'Corporate office', 'Ambition, politics, burnout, betrayal', null, null, 407, false),
    ('setting', 'place_settings', 'Place settings', 'factory_warehouse', 'Factory / warehouse', 'Labor, danger, class conflict', null, null, 408, false),
    ('setting', 'place_settings', 'Place settings', 'restaurant_kitchen', 'Restaurant / kitchen', 'Pressure, artistry, ego, teamwork', null, null, 409, false),
    ('setting', 'place_settings', 'Place settings', 'hotel', 'Hotel', 'Strangers intersect, secrets, temporary identities', null, null, 410, false),
    ('setting', 'place_settings', 'Place settings', 'airport_train_station', 'Airport / train station', 'Transitions, missed chances, strangers crossing', null, null, 411, false),
    ('setting', 'place_settings', 'Place settings', 'ship', 'Ship', 'Isolation, hierarchy, storms, mutiny', null, null, 412, false),
    ('setting', 'place_settings', 'Place settings', 'train', 'Train', 'Movement, class layers, mystery, confinement', null, null, 413, false),
    ('setting', 'place_settings', 'Place settings', 'road_highway', 'Road / highway', 'Journey, escape, freedom, transformation', null, null, 414, false),
    ('setting', 'place_settings', 'Place settings', 'theater_film_set', 'Theater / film set', 'Performance, ego, illusion, ambition', null, null, 415, false),
    ('setting', 'place_settings', 'Place settings', 'museum_library', 'Museum / library', 'History, secrets, knowledge, artifacts', null, null, 416, false),
    ('setting', 'place_settings', 'Place settings', 'church_temple_monastery', 'Church / temple / monastery', 'Faith, ritual, guilt, sanctuary', null, null, 417, false),
    ('setting', 'place_settings', 'Place settings', 'mansion_estate', 'Mansion / estate', 'Wealth, inheritance, secrets, class', null, null, 418, false),
    ('setting', 'place_settings', 'Place settings', 'apartment_building', 'Apartment building', 'Urban intimacy, neighbors, hidden lives', null, null, 419, false),
    ('setting', 'place_settings', 'Place settings', 'underground_tunnels', 'Underground tunnels', 'Secrets, danger, forgotten worlds', null, null, 420, false),
    ('setting', 'place_settings', 'Place settings', 'cave_mine', 'Cave / mine', 'Darkness, survival, buried truth', null, null, 421, false),
    ('setting', 'place_settings', 'Place settings', 'theme_park_carnival', 'Theme park / carnival', 'Wonder, artificiality, hidden danger', null, null, 422, false),
    ('setting', 'place_settings', 'Place settings', 'mall', 'Mall', 'Consumer culture, teen life, nostalgia', null, null, 423, false),
    ('setting', 'place_settings', 'Place settings', 'casino', 'Casino', 'Risk, greed, luck, deception', null, null, 424, false),
    ('setting', 'place_settings', 'Place settings', 'sports_arena', 'Sports arena', 'Competition, fame, crowd pressure', null, null, 425, false),
    ('setting', 'place_settings', 'Place settings', 'laboratory', 'Laboratory', 'Discovery, hubris, experiment gone wrong', null, null, 426, false),
    ('setting', 'place_settings', 'Place settings', 'server_farm_tech_campus', 'Server farm / tech campus', 'AI, surveillance, power, secrecy', null, null, 427, false),
    ('setting', 'place_settings', 'Place settings', 'space_station', 'Space station', 'Isolation, technical failure, politics', null, null, 428, false),
    ('setting', 'place_settings', 'Place settings', 'spaceship', 'Spaceship', 'Voyage, survival, hierarchy, unknown destination', null, null, 429, false),
    ('setting', 'place_settings', 'Place settings', 'colony_planet', 'Colony planet', 'Frontier, survival, terraforming, rebellion', null, null, 430, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'realistic_world', 'Realistic world', 'Our world, no supernatural elements', null, null, 431, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'heightened_reality', 'Heightened reality', 'Real world, but more stylized or exaggerated', null, null, 432, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'secret_world_within_ours', 'Secret world within ours', 'Hidden magic, spies, monsters, aliens, societies', null, null, 433, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'alternate_earth', 'Alternate Earth', 'Different geography, politics, technology, history', null, null, 434, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'distant_planet', 'Distant planet', 'Alien ecosystem, colony, lost civilization', null, null, 435, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'galactic_civilization', 'Galactic civilization', 'Empires, federations, trade routes, interstellar war', null, null, 436, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'multiverse', 'Multiverse', 'Infinite realities, variants, alternate selves', null, null, 437, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'dream_world', 'Dream world', 'Symbolic, unstable, subconscious logic', null, null, 438, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'afterlife', 'Afterlife', 'Heaven, hell, purgatory, reincarnation realm', null, null, 439, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'underworld', 'Underworld', 'Realm of the dead, criminal underworld, literal depths', null, null, 440, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'virtual_world', 'Virtual world', 'Simulation, game, metaverse, uploaded consciousness', null, null, 441, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'pocket_dimension', 'Pocket dimension', 'Small separate reality with its own rules', null, null, 442, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'distant_fantasy_world', 'Distant fantasy world', 'Invented kingdoms, magic systems, maps, races', null, null, 443, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'fairy_tale_kingdom', 'Fairy-tale kingdom', 'Castles, curses, forests, archetypes', null, null, 444, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'mythological_realm', 'Mythological realm', 'Olympus, Valhalla, Hades-like worlds', null, null, 445, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'post_apocalyptic_world', 'Post-apocalyptic world', 'Ruins after collapse', null, null, 446, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'dystopia', 'Dystopia', 'Oppressive society organized around control', null, null, 447, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'utopia_with_a_secret', 'Utopia with a secret', 'Perfect world hiding a dark truth', null, null, 448, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'solarpunk_world', 'Solarpunk world', 'Ecological, optimistic, advanced society', null, null, 449, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'cyberpunk_world', 'Cyberpunk world', 'High tech, low life, corporations, neon cities', null, null, 450, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'steampunk_world', 'Steampunk world', 'Victorian aesthetics plus advanced steam technology', null, null, 451, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'dieselpunk_world', 'Dieselpunk world', '1920s–1940s industrial militarized retrofuture', null, null, 452, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'biopunk_world', 'Biopunk world', 'Genetic engineering, body modification, biotech', null, null, 453, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'clockpunk_world', 'Clockpunk world', 'Renaissance/clockwork technology', null, null, 454, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'stonepunk_world', 'Stonepunk world', 'Prehistoric technology reimagined', null, null, 455, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'decopunk_world', 'Decopunk world', 'Art deco retrofuturism', null, null, 456, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'atompunk_world', 'Atompunk world', '1950s nuclear-age retrofuture', null, null, 457, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'cassette_futurism', 'Cassette futurism', '1970s/1980s analog future aesthetic', null, null, 458, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'solar_system_civilization', 'Solar system civilization', 'Mars, moons, asteroid colonies', null, null, 459, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'deep_space_civilization', 'Deep-space civilization', 'Generational travel, distant stars', null, null, 460, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'post_scarcity_society', 'Post-scarcity society', 'Material needs solved, new conflicts emerge', null, null, 461, false),
    ('setting', 'world_scale_settings', 'World-scale settings', 'post_human_society', 'Post-human society', 'Humans altered into something new', null, null, 462, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'desert', 'Desert', 'Survival, mirage, scarcity, ancient ruins', null, null, 463, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'forest', 'Forest', 'Mystery, transformation, predators, magic', null, null, 464, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'jungle', 'Jungle', 'Heat, hidden temples, disease, danger', null, null, 465, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'arctic_ice_world', 'Arctic / ice world', 'Isolation, cold, endurance, hidden things', null, null, 466, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'ocean', 'Ocean', 'Depth, storms, monsters, exploration', null, null, 467, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'underwater_city', 'Underwater city', 'Pressure, isolation, beauty, danger', null, null, 468, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'mountain', 'Mountain', 'Climb, pilgrimage, survival, isolation', null, null, 469, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'swamp_marsh', 'Swamp / marsh', 'Decay, secrets, hidden communities', null, null, 470, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'volcanic_land', 'Volcanic land', 'Destruction, rebirth, danger', null, null, 471, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'canyon_badlands', 'Canyon / badlands', 'Pursuit, frontier, exposure', null, null, 472, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'grasslands_plains', 'Grasslands / plains', 'Vastness, nomads, migration', null, null, 473, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'tropical_paradise', 'Tropical paradise', 'Beauty hiding danger', null, null, 474, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'ruined_city', 'Ruined city', 'Collapse, memory, scavenging', null, null, 475, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'mega_city', 'Mega-city', 'Density, inequality, anonymity', null, null, 476, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'floating_city', 'Floating city', 'Fragility, fantasy, engineering', null, null, 477, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'underground_city', 'Underground city', 'Secrecy, survival, oppression', null, null, 478, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'sky_city', 'Sky city', 'Class hierarchy, elevation, spectacle', null, null, 479, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'nomadic_world', 'Nomadic world', 'No fixed home, moving tribes/fleets', null, null, 480, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'toxic_wasteland', 'Toxic wasteland', 'Pollution, mutation, scarcity', null, null, 481, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'terraforming_world', 'Terraforming world', 'Environment being engineered', null, null, 482, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'living_planet', 'Living planet', 'The ecosystem itself is conscious', null, null, 483, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'artificial_habitat', 'Artificial habitat', 'Dome, ark, ringworld, orbital colony', null, null, 484, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'generation_ship_ecosystem', 'Generation ship ecosystem', 'Closed environment, inherited mission', null, null, 485, false),
    ('setting', 'environmental_settings', 'Environmental settings', 'city_inside_a_machine', 'City inside a machine', 'Mechanical world, maintenance society', null, null, 486, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'royal_court', 'Royal court', 'Intrigue, succession, betrayal', null, null, 487, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'noble_house', 'Noble house', 'Family power, marriage alliances, inheritance', null, null, 488, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'tribal_society', 'Tribal society', 'Kinship, ritual, survival, belonging', null, null, 489, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'nomadic_culture', 'Nomadic culture', 'Movement, oral tradition, resource conflict', null, null, 490, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'merchant_society', 'Merchant society', 'Trade, wealth, bargaining, guilds', null, null, 491, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'religious_society', 'Religious society', 'Faith, heresy, ritual, authority', null, null, 492, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'militarized_society', 'Militarized society', 'Duty, discipline, conquest', null, null, 493, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'corporate_society', 'Corporate society', 'Companies act like governments', null, null, 494, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'academic_society', 'Academic society', 'Knowledge, rivalry, prestige', null, null, 495, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'criminal_underworld', 'Criminal underworld', 'Codes, gangs, loyalty, betrayal', null, null, 496, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'artist_colony', 'Artist colony', 'Creativity, jealousy, freedom', null, null, 497, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'celebrity_culture', 'Celebrity culture', 'Fame, image, performance', null, null, 498, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'sports_culture', 'Sports culture', 'Competition, body, discipline, spectacle', null, null, 499, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'frontier_society', 'Frontier society', 'Lawlessness, settlement, reinvention', null, null, 500, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'colonial_society', 'Colonial society', 'Occupation, exploitation, resistance', null, null, 501, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'revolutionary_society', 'Revolutionary society', 'Ideology, danger, hope, paranoia', null, null, 502, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'refugee_society', 'Refugee society', 'Displacement, survival, memory', null, null, 503, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'caste_society', 'Caste society', 'Fixed hierarchy, oppression, rebellion', null, null, 504, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'surveillance_society', 'Surveillance society', 'Monitoring, conformity, hidden resistance', null, null, 505, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'post_truth_society', 'Post-truth society', 'Reality itself is contested', null, null, 506, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'ai_managed_society', 'AI-managed society', 'Algorithmic governance and dependence', null, null, 507, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'matriarchal_society', 'Matriarchal society', 'Women hold primary power', null, null, 508, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'patriarchal_society', 'Patriarchal society', 'Men hold primary power', null, null, 509, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'child_led_society', 'Child-led society', 'Adults absent, children govern', null, null, 510, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'elder_led_society', 'Elder-led society', 'Age and memory control authority', null, null, 511, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'immortal_society', 'Immortal society', 'Death is rare, status calcifies', null, null, 512, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'clone_society', 'Clone society', 'Identity and individuality are unstable', null, null, 513, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'hive_society', 'Hive society', 'Collective mind or extreme conformity', null, null, 514, false),
    ('setting', 'social_cultural_settings', 'Social / cultural settings', 'guild_society', 'Guild society', 'Profession defines identity and power', null, null, 515, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'noir_city', 'Noir city', 'Rain, crime, moral ambiguity, corruption', null, null, 516, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'gothic_mansion', 'Gothic mansion', 'Secrets, decay, ghosts, inheritance', null, null, 517, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'western_frontier', 'Western frontier', 'Law, land, revenge, survival', null, null, 518, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'pirate_world', 'Pirate world', 'Ships, treasure, betrayal, freedom', null, null, 519, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'spy_world', 'Spy world', 'Secrets, double agents, geopolitics', null, null, 520, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'war_zone', 'War zone', 'Survival, brotherhood, moral injury', null, null, 521, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'court_intrigue', 'Court intrigue', 'Alliances, marriages, poison, succession', null, null, 522, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'magical_academy', 'Magical academy', 'Training, rivalry, hidden danger', null, null, 523, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'monster_infested_world', 'Monster-infested world', 'Survival around supernatural threats', null, null, 524, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'zombie_apocalypse', 'Zombie apocalypse', 'Collapse, infection, human conflict', null, null, 525, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'superhero_city', 'Superhero city', 'Public danger, secret identities, power', null, null, 526, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'kaiju_world', 'Kaiju world', 'Giant monsters reshape civilization', null, null, 527, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'detective_city', 'Detective city', 'Mystery, corruption, clues', null, null, 528, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'high_fantasy_realm', 'High fantasy realm', 'Kingdoms, magic, war, ancient evil', null, null, 529, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'low_fantasy_village', 'Low fantasy village', 'Ordinary life touched by magic', null, null, 530, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'urban_fantasy_city', 'Urban fantasy city', 'Magic hidden in modern life', null, null, 531, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'space_opera_galaxy', 'Space opera galaxy', 'Empires, rebels, dynasties, aliens', null, null, 532, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'hard_sci_fi_setting', 'Hard sci-fi setting', 'Physics, engineering, realistic constraints', null, null, 533, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'cozy_village', 'Cozy village', 'Low-stakes mystery, community warmth', null, null, 534, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'dark_academia', 'Dark academia', 'Elite schools, secrets, obsession', null, null, 535, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'southern_gothic', 'Southern Gothic', 'Family decay, religion, heat, secrets', null, null, 536, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'folk_horror_village', 'Folk horror village', 'Rural ritual, isolation, old beliefs', null, null, 537, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'postwar_society', 'Postwar society', 'Trauma, rebuilding, moral reckoning', null, null, 538, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'roadside_americana', 'Roadside Americana', 'Motels, diners, highways, drift', null, null, 539, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'retro_suburbia', 'Retro suburbia', 'Conformity, hidden darkness, nostalgia', null, null, 540, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'one_house', 'One house', 'Family conflict, haunting, hostage, dinner party', null, null, 541, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'one_room', 'One room', 'Debate, interrogation, trial, confession', null, null, 542, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'elevator', 'Elevator', 'Forced proximity, pressure, danger', null, null, 543, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'lifeboat', 'Lifeboat', 'Survival, scarcity, moral choices', null, null, 544, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'bunker', 'Bunker', 'Apocalypse, paranoia, leadership conflict', null, null, 545, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'submarine', 'Submarine', 'Claustrophobia, pressure, command', null, null, 546, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'airplane', 'Airplane', 'Hijack, mystery, disaster', null, null, 547, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'train_car', 'Train car', 'Strangers, crime, escape', null, null, 548, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'space_capsule', 'Space capsule', 'Technical failure, isolation', null, null, 549, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'jury_room', 'Jury room', 'Moral debate, persuasion', null, null, 550, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'hospital_ward', 'Hospital ward', 'Life/death, waiting, grief', null, null, 551, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'diner_overnight', 'Diner overnight', 'Strangers collide in liminal space', null, null, 552, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'hotel_room', 'Hotel room', 'Affair, crime, confession, hidden past', null, null, 553, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'cabin_in_the_woods', 'Cabin in the woods', 'Isolation, horror, healing, retreat', null, null, 554, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'office_after_hours', 'Office after hours', 'Ambition, secrets, power', null, null, 555, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'school_during_lockdown', 'School during lockdown', 'Fear, social dynamics, survival', null, null, 556, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'prison_cell_block', 'Prison cell block', 'Hierarchy, escape, violence', null, null, 557, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'research_station', 'Research station', 'Isolation, discovery, contamination', null, null, 558, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'remote_lighthouse', 'Remote lighthouse', 'Madness, duty, storm, loneliness', null, null, 559, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'airport', 'Airport', 'Departures, missed chances, identity checks', null, null, 560, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'bus_station', 'Bus station', 'Escape, poverty, reinvention', null, null, 561, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'train_station', 'Train station', 'Crossroads, separation, reunion', null, null, 562, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'motel', 'Motel', 'Temporary lives, secrets, danger', null, null, 563, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'highway_rest_stop', 'Highway rest stop', 'Strangers, threat, drift', null, null, 564, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'bridge', 'Bridge', 'Crossing, choice, danger', null, null, 565, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'border_crossing', 'Border crossing', 'Law, identity, escape', null, null, 566, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'port', 'Port', 'Trade, departure, smuggling', null, null, 567, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'hospital_waiting_room', 'Hospital waiting room', 'Suspense, grief, hope', null, null, 568, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'funeral_home', 'Funeral home', 'Memory, family truth, mortality', null, null, 569, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'wedding_venue', 'Wedding venue', 'union, pressure, secrets', null, null, 570, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'graduation_day', 'Graduation day', 'transition, ambition, separation', null, null, 571, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'last_night_before_leaving', 'Last night before leaving', 'endings and confessions', null, null, 572, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'first_day_somewhere_new', 'First day somewhere new', 'identity reset', null, null, 573, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'evacuation_zone', 'Evacuation zone', 'urgency and loss', null, null, 574, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'checkpoint', 'Checkpoint', 'authority, fear, deception', null, null, 575, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'social_media_world', 'Social media world', 'Fame, identity, performance', null, null, 576, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'influencer_house', 'Influencer house', 'competition, intimacy, branding', null, null, 577, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'streaming_platform_content_studio', 'Streaming platform / content studio', 'algorithm, creativity, exploitation', null, null, 578, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'newsroom', 'Newsroom', 'deadlines, truth, politics', null, null, 579, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'film_set', 'Film set', 'illusion, ego, production chaos', null, null, 580, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'writers_room', 'Writers’ room', 'collaboration, credit, conflict', null, null, 581, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'game_studio', 'Game studio', 'crunch, creativity, fandom', null, null, 582, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'ai_lab', 'AI lab', 'invention, ethics, control', null, null, 583, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'startup_accelerator', 'Startup accelerator', 'ambition, funding, fraud', null, null, 584, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'hackerspace', 'Hackerspace', 'outsider tech, rebellion, invention', null, null, 585, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'virtual_reality_platform', 'Virtual reality platform', 'identity, addiction, escape', null, null, 586, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'online_forum_discord_community', 'Online forum / Discord community', 'anonymity, obsession, belonging', null, null, 587, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'esports_arena', 'Esports arena', 'competition, fame, youth culture', null, null, 588, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'surveillance_control_room', 'Surveillance control room', 'power through observation', null, null, 589, false),
    ('setting', 'genre_flavored_settings', 'Genre-flavored settings', 'data_center', 'Data center', 'hidden infrastructure, digital stakes', null, null, 590, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'heros_journey', 'Hero’s Journey', 'An ordinary person enters an extraordinary world, is tested, transformed, and returns changed.', null, null, 591, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'positive_change_arc', 'Positive change arc', 'A flawed person learns a truth and becomes better.', null, null, 592, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'negative_change_arc', 'Negative change arc', 'A person rejects truth, embraces a lie, and becomes worse.', null, null, 593, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'flat_arc', 'Flat arc', 'The character does not change much; instead, they change the world around them.', null, null, 594, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'fall_arc', 'Fall arc', 'A decent or powerful person is destroyed by their flaw.', null, null, 595, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'redemption_arc', 'Redemption arc', 'A morally compromised person becomes worthy again.', null, null, 596, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'corruption_arc', 'Corruption arc', 'A good or innocent person becomes morally compromised.', null, null, 597, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'disillusionment_arc', 'Disillusionment arc', 'A naive person learns the world is harsher than they believed.', null, null, 598, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'maturation_arc', 'Maturation arc', 'A young or immature person grows into responsibility.', null, null, 599, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'healing_arc', 'Healing arc', 'A wounded person learns to live again.', null, null, 600, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'self_acceptance_arc', 'Self-acceptance arc', 'A character stops rejecting who they are.', null, null, 601, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'identity_arc', 'Identity arc', 'A character discovers who they really are.', null, null, 602, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'empowerment_arc', 'Empowerment arc', 'A powerless character gains agency.', null, null, 603, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'humbling_arc', 'Humbling arc', 'An arrogant character is forced to become grounded.', null, null, 604, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'sacrifice_arc', 'Sacrifice arc', 'A character gives up something precious for love, duty, or a greater good.', null, null, 605, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'obsession_arc', 'Obsession arc', 'A character is consumed by desire, ambition, revenge, or perfection.', null, null, 606, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'faith_arc', 'Faith arc', 'A character loses, gains, or transforms belief.', null, null, 607, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'reconciliation_arc', 'Reconciliation arc', 'A character repairs a broken relationship.', null, null, 608, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'revenge_to_mercy_arc', 'Revenge-to-mercy arc', 'A character begins wanting payback and ends choosing forgiveness or justice.', null, null, 609, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'coward_to_hero_arc', 'Coward-to-hero arc', 'A fearful person learns courage.', null, null, 610, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'outsider_to_belonging_arc', 'Outsider-to-belonging arc', 'A lonely or rejected character finds community.', null, null, 611, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'leader_arc', 'Leader arc', 'A character learns to guide others.', null, null, 612, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'mentor_arc', 'Mentor arc', 'A teacher passes wisdom, then lets go.', null, null, 613, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'parent_arc', 'Parent arc', 'A character learns responsibility, protection, or release.', null, null, 614, false),
    ('character_arc', 'character_arcs', 'Character arcs', 'survivor_arc', 'Survivor arc', 'A character endures trauma and chooses life.', null, null, 615, false),
    ('structure', 'story_structures', 'Story structures', 'three_act_structure', 'Three-act structure', 'Setup → confrontation → resolution. Most common film structure.', null, null, 616, false),
    ('structure', 'story_structures', 'Story structures', 'five_act_structure', 'Five-act structure', 'Exposition → rising action → climax → falling action → resolution. Older dramatic model.', null, null, 617, false),
    ('structure', 'story_structures', 'Story structures', 'seven_point_structure', 'Seven-point structure', 'Hook, plot turn, pinch, midpoint, second pinch, second turn, resolution.', null, null, 618, false),
    ('structure', 'story_structures', 'Story structures', 'save_the_cat_beat_sheet', 'Save the Cat beat sheet', 'Commercial screenplay beats: opening image, theme, catalyst, midpoint, all-is-lost, finale, etc.', null, null, 619, false),
    ('structure', 'story_structures', 'Story structures', 'dan_harmon_story_circle', 'Dan Harmon story circle', 'Character wants something, enters unfamiliar situation, adapts, pays a price, returns changed.', null, null, 620, false),
    ('structure', 'story_structures', 'Story structures', 'freytag_pyramid', 'Freytag pyramid', 'Rising tension toward climax, then consequences.', null, null, 621, false),
    ('structure', 'story_structures', 'Story structures', 'mini_movie_method', 'Mini-movie method', 'A feature is broken into 8 sequences of roughly 10–15 minutes each.', null, null, 622, false),
    ('structure', 'story_structures', 'Story structures', 'quest_structure', 'Quest structure', 'Goal-oriented journey with obstacles and tests.', null, null, 623, false),
    ('structure', 'story_structures', 'Story structures', 'mystery_structure', 'Mystery structure', 'Clues, suspects, reveals, false leads, final truth.', null, null, 624, false),
    ('structure', 'story_structures', 'Story structures', 'heist_structure', 'Heist structure', 'Team assembly, plan, preparation, execution, complication, twist.', null, null, 625, false),
    ('structure', 'story_structures', 'Story structures', 'romance_structure', 'Romance structure', 'Meet, attraction, resistance, intimacy, breakup, reunion/choice.', null, null, 626, false),
    ('structure', 'story_structures', 'Story structures', 'sports_competition_structure', 'Sports/competition structure', 'Training, setbacks, rival, big contest, final test.', null, null, 627, false),
    ('structure', 'story_structures', 'Story structures', 'survival_structure', 'Survival structure', 'Disaster, adaptation, losses, final escape or endurance.', null, null, 628, false),
    ('structure', 'story_structures', 'Story structures', 'tragedy_structure', 'Tragedy structure', 'Flaw, temptation, bad choice, escalation, ruin.', null, null, 629, false),
    ('structure', 'story_structures', 'Story structures', 'redemption_structure', 'Redemption structure', 'Sin, denial, consequence, awakening, sacrifice/repair.', null, null, 630, false),
    ('structure', 'story_structures', 'Story structures', 'ensemble_structure', 'Ensemble structure', 'Multiple character arcs orbit one event, place, or theme.', null, null, 631, false),
    ('structure', 'story_structures', 'Story structures', 'nonlinear_structure', 'Nonlinear structure', 'Events are rearranged to create mystery, irony, or emotional impact.', null, null, 632, false),
    ('structure', 'story_structures', 'Story structures', 'rashomon_structure', 'Rashomon structure', 'Same event shown through conflicting viewpoints.', null, null, 633, false),
    ('structure', 'story_structures', 'Story structures', 'real_time_structure', 'Real-time structure', 'Story unfolds in nearly continuous time.', null, null, 634, false),
    ('structure', 'story_structures', 'Story structures', 'bottle_structure', 'Bottle structure', 'Story is confined to one place, forcing pressure through dialogue and character conflict.', null, null, 635, false),
    ('structure', 'story_structures', 'Story structures', 'road_movie_structure', 'Road movie structure', 'Each location creates a new test and reveals character.', null, null, 636, false),
    ('structure', 'story_structures', 'Story structures', 'coming_of_age_structure', 'Coming-of-age structure', 'Innocence, exposure, mistake, consequence, maturity.', null, null, 637, false),
    ('protagonist_piece', 'protagonist_pieces', 'Protagonist pieces', 'want', 'Want', 'What do they actively pursue?', null, null, 638, false),
    ('protagonist_piece', 'protagonist_pieces', 'Protagonist pieces', 'need', 'Need', 'What do they emotionally or morally need to learn?', null, null, 639, false),
    ('protagonist_piece', 'protagonist_pieces', 'Protagonist pieces', 'flaw', 'Flaw', 'What keeps hurting them?', null, null, 640, false),
    ('protagonist_piece', 'protagonist_pieces', 'Protagonist pieces', 'wound', 'Wound', 'What past pain shaped them?', null, null, 641, false),
    ('protagonist_piece', 'protagonist_pieces', 'Protagonist pieces', 'lie', 'Lie', 'What false belief controls them?', null, null, 642, false),
    ('protagonist_piece', 'protagonist_pieces', 'Protagonist pieces', 'truth', 'Truth', 'What must they understand by the end?', null, null, 643, false),
    ('protagonist_piece', 'protagonist_pieces', 'Protagonist pieces', 'choice', 'Choice', 'What final decision proves change?', null, null, 644, false),
    ('antagonist_type', 'antagonist_types', 'Antagonist types', 'person', 'Person', 'Villain, rival, parent, boss, criminal', null, null, 645, false),
    ('antagonist_type', 'antagonist_types', 'Antagonist types', 'institution', 'Institution', 'Government, corporation, school, court, church', null, null, 646, false),
    ('antagonist_type', 'antagonist_types', 'Antagonist types', 'nature', 'Nature', 'Storm, mountain, ocean, disease', null, null, 647, false),
    ('antagonist_type', 'antagonist_types', 'Antagonist types', 'society', 'Society', 'Class system, prejudice, tradition', null, null, 648, false),
    ('antagonist_type', 'antagonist_types', 'Antagonist types', 'self', 'Self', 'Addiction, fear, pride, guilt', null, null, 649, false),
    ('antagonist_type', 'antagonist_types', 'Antagonist types', 'technology', 'Technology', 'AI, machine, surveillance system', null, null, 650, false),
    ('antagonist_type', 'antagonist_types', 'Antagonist types', 'supernatural_force', 'Supernatural force', 'Curse, ghost, demon, fate', null, null, 651, false),
    ('conflict', 'conflict_types', 'Conflict types', 'person_vs_person', 'Person vs person', 'Hero vs villain', null, null, 652, false),
    ('conflict', 'conflict_types', 'Conflict types', 'person_vs_self', 'Person vs self', 'Fear, shame, addiction', null, null, 653, false),
    ('conflict', 'conflict_types', 'Conflict types', 'person_vs_society', 'Person vs society', 'Rebel vs system', null, null, 654, false),
    ('conflict', 'conflict_types', 'Conflict types', 'person_vs_nature', 'Person vs nature', 'Survival in wilderness', null, null, 655, false),
    ('conflict', 'conflict_types', 'Conflict types', 'person_vs_fate', 'Person vs fate', 'Prophecy, destiny, mortality', null, null, 656, false),
    ('conflict', 'conflict_types', 'Conflict types', 'person_vs_technology', 'Person vs technology', 'Human vs machine', null, null, 657, false),
    ('conflict', 'conflict_types', 'Conflict types', 'person_vs_god_supernatural', 'Person vs God/supernatural', 'Mortal vs divine or demonic force', null, null, 658, false),
    ('stakes', 'stakes_types', 'Stakes types', 'life_death', 'Life/death', 'Someone may die', null, null, 659, false),
    ('stakes', 'stakes_types', 'Stakes types', 'love', 'Love', 'Relationship may be lost', null, null, 660, false),
    ('stakes', 'stakes_types', 'Stakes types', 'identity', 'Identity', 'Character may lose who they are', null, null, 661, false),
    ('stakes', 'stakes_types', 'Stakes types', 'freedom', 'Freedom', 'Prison, oppression, control', null, null, 662, false),
    ('stakes', 'stakes_types', 'Stakes types', 'status', 'Status', 'Reputation, career, honor', null, null, 663, false),
    ('stakes', 'stakes_types', 'Stakes types', 'family', 'Family', 'Child, parent, sibling, marriage', null, null, 664, false),
    ('stakes', 'stakes_types', 'Stakes types', 'community', 'Community', 'Town, team, nation', null, null, 665, false),
    ('stakes', 'stakes_types', 'Stakes types', 'soul', 'Soul', 'Moral damnation, corruption', null, null, 666, false),
    ('stakes', 'stakes_types', 'Stakes types', 'world', 'World', 'Civilization, planet, universe', null, null, 667, false),
    ('theme', 'themes', 'Themes', 'ambition', 'Ambition', 'What does success cost?', null, null, 668, false),
    ('theme', 'themes', 'Themes', 'family', 'Family', 'What do we owe our family?', null, null, 669, false),
    ('theme', 'themes', 'Themes', 'identity', 'Identity', 'Who are we when old roles fall away?', null, null, 670, false),
    ('theme', 'themes', 'Themes', 'justice', 'Justice', 'Is punishment the same as justice?', null, null, 671, false),
    ('theme', 'themes', 'Themes', 'freedom', 'Freedom', 'What is freedom worth?', null, null, 672, false),
    ('theme', 'themes', 'Themes', 'love', 'Love', 'Is love possession, sacrifice, or choice?', null, null, 673, false),
    ('theme', 'themes', 'Themes', 'power', 'Power', 'Does power reveal or corrupt?', null, null, 674, false),
    ('theme', 'themes', 'Themes', 'truth', 'Truth', 'Is truth always worth exposing?', null, null, 675, false),
    ('theme', 'themes', 'Themes', 'mortality', 'Mortality', 'How should we live knowing we die?', null, null, 676, false),
    ('theme', 'themes', 'Themes', 'belonging', 'Belonging', 'What makes someone part of a community?', null, null, 677, false),
    ('genre', 'genres', 'Genres', 'action', 'Action', 'Danger, movement, courage', null, null, 678, false),
    ('genre', 'genres', 'Genres', 'comedy', 'Comedy', 'Disorder becomes funny and resolves', null, null, 679, false),
    ('genre', 'genres', 'Genres', 'drama', 'Drama', 'Emotional conflict and consequence', null, null, 680, false),
    ('genre', 'genres', 'Genres', 'horror', 'Horror', 'Fear, dread, survival', null, null, 681, false),
    ('genre', 'genres', 'Genres', 'thriller', 'Thriller', 'Suspense and pressure', null, null, 682, false),
    ('genre', 'genres', 'Genres', 'mystery', 'Mystery', 'Hidden truth revealed', null, null, 683, false),
    ('genre', 'genres', 'Genres', 'romance', 'Romance', 'Love tested and resolved', null, null, 684, false),
    ('genre', 'genres', 'Genres', 'sci_fi', 'Sci-fi', 'Technology/future changes human life', null, null, 685, false),
    ('genre', 'genres', 'Genres', 'fantasy', 'Fantasy', 'Wonder, magic, mythic conflict', null, null, 686, false),
    ('genre', 'genres', 'Genres', 'western', 'Western', 'Frontier justice, law, survival', null, null, 687, false),
    ('genre', 'genres', 'Genres', 'war', 'War', 'Duty, trauma, sacrifice', null, null, 688, false),
    ('genre', 'genres', 'Genres', 'crime', 'Crime', 'Law, morality, greed, power', null, null, 689, false),
    ('genre', 'genres', 'Genres', 'coming_of_age', 'Coming-of-age', 'Growth into maturity', null, null, 690, false),
    ('tone', 'tones', 'Tones', 'light', 'Light', 'Fun, warm, accessible', null, null, 691, false),
    ('tone', 'tones', 'Tones', 'dark', 'Dark', 'Serious, grim, morally heavy', null, null, 692, false),
    ('tone', 'tones', 'Tones', 'satirical', 'Satirical', 'Mocking, ironic, critical', null, null, 693, false),
    ('tone', 'tones', 'Tones', 'melancholic', 'Melancholic', 'Sad, reflective', null, null, 694, false),
    ('tone', 'tones', 'Tones', 'hopeful', 'Hopeful', 'Uplifting, redemptive', null, null, 695, false),
    ('tone', 'tones', 'Tones', 'bleak', 'Bleak', 'Little comfort or optimism', null, null, 696, false),
    ('tone', 'tones', 'Tones', 'absurd', 'Absurd', 'Strange, comic, irrational', null, null, 697, false),
    ('tone', 'tones', 'Tones', 'epic', 'Epic', 'Large-scale, grand, mythic', null, null, 698, false),
    ('tone', 'tones', 'Tones', 'intimate', 'Intimate', 'Small, personal, emotional', null, null, 699, false),
    ('tone', 'tones', 'Tones', 'gritty', 'Gritty', 'Harsh, realistic, grounded', null, null, 700, false),
    ('tone', 'tones', 'Tones', 'whimsical', 'Whimsical', 'Playful, magical, charming', null, null, 701, false),
    ('tone', 'tones', 'Tones', 'paranoid', 'Paranoid', 'Unstable, suspicious, tense', null, null, 702, false),
    ('pov', 'points_of_view', 'Points of view', 'single_protagonist', 'Single protagonist', 'Strong identification', null, null, 703, false),
    ('pov', 'points_of_view', 'Points of view', 'dual_protagonist', 'Dual protagonist', 'Two linked arcs', null, null, 704, false),
    ('pov', 'points_of_view', 'Points of view', 'ensemble', 'Ensemble', 'Many lives around one theme/event', null, null, 705, false),
    ('pov', 'points_of_view', 'Points of view', 'unreliable_pov', 'Unreliable POV', 'Audience doubts what they see', null, null, 706, false),
    ('pov', 'points_of_view', 'Points of view', 'villain_pov', 'Villain POV', 'We follow the antagonist’s logic', null, null, 707, false),
    ('pov', 'points_of_view', 'Points of view', 'child_pov', 'Child POV', 'Innocence, misunderstanding, wonder', null, null, 708, false),
    ('pov', 'points_of_view', 'Points of view', 'observer_pov', 'Observer POV', 'Main character watches someone else change', null, null, 709, false),
    ('pov', 'points_of_view', 'Points of view', 'multiple_pov', 'Multiple POV', 'Broader world and conflicting truths', null, null, 710, false),
    ('belief_shift', 'lie_truth_pairs', 'Lie/truth belief shifts', 'i_am_not_worthy', 'I am not worthy.', 'I have value.', null, null, 711, false),
    ('belief_shift', 'lie_truth_pairs', 'Lie/truth belief shifts', 'power_will_make_me_safe', 'Power will make me safe.', 'Power without love destroys me.', null, null, 712, false),
    ('belief_shift', 'lie_truth_pairs', 'Lie/truth belief shifts', 'i_dont_need_anyone', 'I don’t need anyone.', 'Connection is strength.', null, null, 713, false),
    ('belief_shift', 'lie_truth_pairs', 'Lie/truth belief shifts', 'revenge_will_heal_me', 'Revenge will heal me.', 'Revenge keeps me trapped.', null, null, 714, false),
    ('belief_shift', 'lie_truth_pairs', 'Lie/truth belief shifts', 'success_will_make_me_whole', 'Success will make me whole.', 'Success cannot replace identity.', null, null, 715, false),
    ('belief_shift', 'lie_truth_pairs', 'Lie/truth belief shifts', 'the_world_is_simple', 'The world is simple.', 'The world is morally complicated.', null, null, 716, false),
    ('belief_shift', 'lie_truth_pairs', 'Lie/truth belief shifts', 'i_must_control_everything', 'I must control everything.', 'I have to trust others.', null, null, 717, false)
)
insert into public.story_elements (
  category_id, group_slug, group_name, slug, name, core_idea, audience_promise, story_question, sort_order, is_featured
)
select
  c.id, s.group_slug, s.group_name, s.slug, s.name, s.core_idea, s.audience_promise, s.story_question, s.sort_order, s.is_featured
from seed s
join public.story_element_categories c on c.slug = s.category_slug
on conflict (category_id, slug) do update set
  group_slug = excluded.group_slug,
  group_name = excluded.group_name,
  name = excluded.name,
  core_idea = excluded.core_idea,
  audience_promise = excluded.audience_promise,
  story_question = excluded.story_question,
  sort_order = excluded.sort_order,
  is_featured = excluded.is_featured;
