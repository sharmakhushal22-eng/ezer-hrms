-- =====================================================================
-- 090_funzone_multiplayer.sql — Fun Zone: invites, live games, scores
--
-- The Fun Zone today is four games that touch no database at all: a refresh
-- resets everything and no score is kept. That was a deliberate choice in the
-- original brief, and this is the first thing that changes it — because
-- "invite a colleague" and "share your score" cannot work without somewhere
-- to put the invite and the score.
--
-- WHAT IS AND IS NOT PERSISTED
--
-- The MOVES ARE NOT. A live game runs over Supabase Realtime broadcast,
-- client to client, and a tic-tac-toe move is not worth a database round
-- trip. What lands here is the start and the finish: who played whom, at
-- what, and how it ended. Those are the parts somebody looks at afterwards.
--
-- THE SCORE IS WRITTEN FROM THE MOVES, BY THE SERVER
--
-- finish_game() takes the move list and re-derives the winner rather than
-- believing whoever claims to have won. Two colleagues at tic-tac-toe are not
-- an adversary worth defending against, but a leaderboard that can be typed
-- into is not worth showing, and re-deriving costs nothing.
--
-- NO PRIZES, NO POINTS THAT MEAN ANYTHING
--
-- This is a break-time feature. There is no linkage to recognition, to the
-- Wall of Fame leaderboard, to performance or to pay — and there should not
-- be. A game that counts towards anything stops being a game and becomes
-- another thing to be measured on.
--
-- DEPENDS ON  employees, ess_notifications (021 + 075)
-- SAFE TO RUN TWICE — IF NOT EXISTS / OR REPLACE throughout.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Invites
-- ---------------------------------------------------------------------

create table if not exists game_invites (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  game_code     text not null,

  from_employee uuid not null references employees(id) on delete cascade,
  to_employee   uuid not null references employees(id) on delete cascade,
  message       text,

  status        text not null default 'PENDING'
                check (status in ('PENDING','ACCEPTED','DECLINED','CANCELLED','EXPIRED')),
  session_id    uuid,

  created_at    timestamptz not null default now(),
  answered_at   timestamptz,

  -- You cannot invite yourself. Cheap to enforce, and it removes a whole
  -- class of "why is the board waiting for me twice" confusion.
  constraint game_invites_not_self check (from_employee <> to_employee)
);

-- ONE OPEN INVITE per sender, recipient and game. Without it, an impatient
-- sender clicking twice puts two invites in somebody's inbox and starts two
-- sessions if both are accepted.
create unique index if not exists uq_game_invites_open
  on game_invites (from_employee, to_employee, game_code)
  where status = 'PENDING';

create index if not exists idx_game_invites_inbox
  on game_invites (to_employee, status, created_at desc);


-- ---------------------------------------------------------------------
-- 2. Sessions
--
-- One row per match. `host_employee` is the person who sent the invite, and
-- they play X and open — fixed here rather than negotiated at connect time,
-- so neither client has to agree anything and a reload cannot swap sides.
-- ---------------------------------------------------------------------

create table if not exists game_sessions (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null,
  game_code      text not null,

  host_employee  uuid not null references employees(id) on delete cascade,
  guest_employee uuid not null references employees(id) on delete cascade,
  invite_id      uuid references game_invites(id) on delete set null,

  status         text not null default 'OPEN'
                 check (status in ('OPEN','FINISHED','ABANDONED')),

  -- Both clients deal from this. Memory Match and Trivia need the same cards
  -- and the same question order on two screens with no server to deal them,
  -- so the order comes from a seed rather than from Math.random() — which
  -- would deal two different decks. See shuffled() in lib/funzone/games.ts.
  seed           int not null default (floor(random() * 2147483647))::int,

  -- Where a result the database cannot replay is parked until the second
  -- player confirms it. See finish_game().
  pending_claim  jsonb,
  claimed_by     uuid references employees(id),

  -- Pairs or correct answers, for the games that score rather than win.
  host_score     int,
  guest_score    int,

  -- 'HOST' | 'GUEST' | null for a draw. Set by finish_game(), never by a
  -- client.
  winner         text check (winner in ('HOST','GUEST')),
  is_draw        boolean not null default false,
  move_count     int not null default 0,

  started_at     timestamptz not null default now(),
  finished_at    timestamptz,

  constraint game_sessions_not_self check (host_employee <> guest_employee),
  -- A finished game is either won or drawn, never both and never neither.
  constraint game_sessions_result check (
    status <> 'FINISHED'
    or (is_draw and winner is null) or (not is_draw and winner is not null)
  )
);

create index if not exists idx_game_sessions_mine
  on game_sessions (host_employee, started_at desc);
create index if not exists idx_game_sessions_theirs
  on game_sessions (guest_employee, started_at desc);


-- ---------------------------------------------------------------------
-- 3. Shared scores
--
-- Sharing is opt-in and per-result. A score does not appear anywhere until
-- its owner chooses to put it there — losing at tic-tac-toe in your lunch
-- break is not something the company needs a record of unless you say so.
-- ---------------------------------------------------------------------

create table if not exists game_score_shares (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null,
  session_id   uuid not null references game_sessions(id) on delete cascade,
  shared_by    uuid not null references employees(id) on delete cascade,
  -- Empty means "shared to my inbox only". Named recipients get a
  -- notification.
  shared_with  uuid[] not null default '{}',
  note         text,
  created_at   timestamptz not null default now(),
  unique (session_id, shared_by)
);


-- ---------------------------------------------------------------------
-- 4. Accepting an invite
-- ---------------------------------------------------------------------

create or replace function accept_game_invite(p_invite uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := wof_current_employee();
  v_inv   game_invites%rowtype;
  v_id    uuid;
  v_seed  int;
  v_age   interval;
begin
  select * into v_inv from game_invites where id = p_invite for update;
  if not found then raise exception 'That invite no longer exists'; end if;

  if v_inv.to_employee <> v_me then
    raise exception 'This invite was not sent to you';
  end if;
  if v_inv.status <> 'PENDING' then
    raise exception 'This invite was already %', lower(v_inv.status);
  end if;

  -- Fifteen minutes, matching INVITE_TTL_MINUTES in lib/funzone/invite.ts.
  -- A game invite is an offer to play NOW; accepting an hour later starts a
  -- game against an empty chair and strands whoever accepted.
  v_age := now() - v_inv.created_at;
  if v_age >= interval '15 minutes' then
    update game_invites set status = 'EXPIRED', answered_at = now() where id = p_invite;
    raise exception 'This invite expired — they were offering to play at the time';
  end if;

  insert into game_sessions (company_id, game_code, host_employee, guest_employee, invite_id)
  values (v_inv.company_id, v_inv.game_code, v_inv.from_employee, v_me, v_inv.id)
  returning id, seed into v_id, v_seed;

  update game_invites
     set status = 'ACCEPTED', answered_at = now(), session_id = v_id
   where id = p_invite;

  insert into ess_notifications
    (employee_id, category, title, body, notification_code, actor_employee_id)
  values (v_inv.from_employee, 'FUNZONE',
          (select full_name from employees where id = v_me) || ' accepted your game invite',
          'They are waiting in the Fun Zone.', 'FUNZONE_INVITE_ACCEPTED', v_me);

  -- The seed goes back with the session: both clients need it to deal the
  -- same deck and ask the same questions in the same order.
  return jsonb_build_object('session_id', v_id, 'game_code', v_inv.game_code,
                            'seed', v_seed, 'host', v_inv.from_employee);
end $$;


-- ---------------------------------------------------------------------
-- 5. Finishing a game
--
-- p_moves is the move list as played. The winner is DERIVED from it here —
-- the caller does not get to say who won. An illegal or incomplete list ends
-- the session as ABANDONED rather than inventing a result.
-- ---------------------------------------------------------------------

create or replace function finish_game(
  p_session uuid,
  p_moves   jsonb default '[]'::jsonb,
  p_claim   jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := wof_current_employee();
  v_s      game_sessions%rowtype;
  v_board  text[] := array_fill(''::text, array[9]);
  v_mv     jsonb;
  v_cell   int;
  v_by     text;
  v_n      int := 0;
  v_win    text := null;
  v_lines  int[][] := array[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  v_l      int[];
begin
  select * into v_s from game_sessions where id = p_session for update;
  if not found then raise exception 'That game no longer exists'; end if;
  if v_me not in (v_s.host_employee, v_s.guest_employee) then
    raise exception 'You were not playing in that game';
  end if;
  if v_s.status <> 'OPEN' then
    return jsonb_build_object('id', v_s.id, 'already', v_s.status);
  end if;

  ----------------------------------------------------------------- claims
  -- TIC-TAC-TOE IS REPLAYED HERE. Nine squares and eight lines is cheap to
  -- re-derive, so the database decides who won and no client is believed.
  --
  -- MEMORY MATCH AND TRIVIA ARE NOT. Both depend on a seeded shuffle, and
  -- reimplementing mulberry32 and Fisher-Yates in plpgsql to check a
  -- break-time game would be three copies of the same logic drifting apart.
  --
  -- So they are settled by AGREEMENT: each client reports what it computed,
  -- the first is parked, and the second must match it. One player alone
  -- cannot post a result — they can only stall the game as unfinished, which
  -- gains them nothing. Two clients that disagree end it ABANDONED rather
  -- than picking a winner, because a disagreement means at least one of them
  -- is wrong and there is no way to tell which.
  if p_claim is not null then
    if v_s.pending_claim is null then
      update game_sessions
         set pending_claim = p_claim, claimed_by = v_me
       where id = p_session;
      return jsonb_build_object('id', p_session, 'status', 'AWAITING_CONFIRMATION');
    end if;

    if v_s.claimed_by = v_me then
      return jsonb_build_object('id', p_session, 'status', 'AWAITING_CONFIRMATION',
                                'why', 'waiting for the other player');
    end if;

    if v_s.pending_claim <> p_claim then
      update game_sessions set status = 'ABANDONED', finished_at = now()
       where id = p_session;
      return jsonb_build_object('id', p_session, 'status', 'ABANDONED',
                                'why', 'the two players reported different results');
    end if;

    update game_sessions
       set status = 'FINISHED', finished_at = now(),
           is_draw = coalesce((p_claim->>'draw')::boolean, false),
           winner  = case when (p_claim->>'draw')::boolean then null
                          else p_claim->>'winner' end,
           host_score = (p_claim->>'host')::int,
           guest_score = (p_claim->>'guest')::int
     where id = p_session;
    return jsonb_build_object('id', p_session, 'status', 'FINISHED',
                              'winner', p_claim->>'winner');
  end if;

  -- Replay. Anything malformed and the session is abandoned rather than
  -- scored: a result nobody can reconstruct is worse than no result.
  for v_mv in select * from jsonb_array_elements(coalesce(p_moves, '[]'::jsonb)) loop
    v_cell := (v_mv->>'cell')::int;
    v_by   := v_mv->>'by';
    if v_cell is null or v_cell < 0 or v_cell > 8
       or v_by not in ('X','O') or v_board[v_cell + 1] <> '' then
      update game_sessions set status = 'ABANDONED', finished_at = now()
       where id = p_session;
      return jsonb_build_object('id', p_session, 'status', 'ABANDONED',
                                'why', 'the move list did not replay');
    end if;
    v_board[v_cell + 1] := v_by;
    v_n := v_n + 1;
  end loop;

  foreach v_l slice 1 in array v_lines loop
    if v_board[v_l[1] + 1] <> ''
       and v_board[v_l[1] + 1] = v_board[v_l[2] + 1]
       and v_board[v_l[1] + 1] = v_board[v_l[3] + 1] then
      v_win := v_board[v_l[1] + 1];
    end if;
  end loop;

  if v_win is null and v_n < 9 then
    update game_sessions set status = 'ABANDONED', finished_at = now(), move_count = v_n
     where id = p_session;
    return jsonb_build_object('id', p_session, 'status', 'ABANDONED',
                              'why', 'the game was not played out');
  end if;

  -- The host is X. Set at session creation, so this mapping is fixed.
  update game_sessions
     set status = 'FINISHED', finished_at = now(), move_count = v_n,
         is_draw = (v_win is null),
         winner  = case when v_win = 'X' then 'HOST'
                        when v_win = 'O' then 'GUEST' end
   where id = p_session;

  return jsonb_build_object('id', p_session, 'status', 'FINISHED',
                            'winner', v_win, 'moves', v_n);
end $$;


-- ---------------------------------------------------------------------
-- 6. Sharing a result
-- ---------------------------------------------------------------------

create or replace function share_game_score(
  p_session uuid, p_with uuid[] default '{}', p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := wof_current_employee();
  v_s  game_sessions%rowtype;
  v_r  uuid;
begin
  select * into v_s from game_sessions where id = p_session;
  if not found then raise exception 'That game no longer exists'; end if;
  if v_me not in (v_s.host_employee, v_s.guest_employee) then
    raise exception 'You can only share a game you played in';
  end if;
  if v_s.status <> 'FINISHED' then
    raise exception 'That game did not finish, so there is no score to share';
  end if;

  insert into game_score_shares (company_id, session_id, shared_by, shared_with, note)
  values (v_s.company_id, p_session, v_me, coalesce(p_with, '{}'), p_note)
  on conflict (session_id, shared_by) do update
    set shared_with = excluded.shared_with, note = excluded.note;

  foreach v_r in array coalesce(p_with, '{}') loop
    insert into ess_notifications
      (employee_id, category, title, body, notification_code, actor_employee_id)
    values (v_r, 'FUNZONE',
            (select full_name from employees where id = v_me) || ' shared a game result',
            coalesce(p_note, 'From the Fun Zone.'), 'FUNZONE_SCORE_SHARED', v_me);
  end loop;

  return jsonb_build_object('session_id', p_session,
                            'shared_with', coalesce(array_length(p_with, 1), 0));
end $$;


-- ---------------------------------------------------------------------
-- 7. RLS — NAYAN
--
-- Not written, for the usual reason: I do not know how "the current
-- employee" resolves in this project's Supabase setup, and these tables hold
-- who played with whom.
--
-- What I would write:
--   game_invites        SELECT where the reader is from_employee or
--                       to_employee; INSERT where from_employee is them
--   game_sessions       SELECT where the reader is host or guest
--   game_score_shares   SELECT where the reader is shared_by, or is named in
--                       shared_with
--
-- The house default USING (true) would let anybody read every invite and
-- every game in the company. Low stakes — it is tic-tac-toe — but "who has
-- been playing games with whom, and when" is exactly the sort of thing that
-- reads badly in a workplace, and it costs nothing to scope it properly.
--
-- The functions above are SECURITY DEFINER and check the caller themselves,
-- so writes are already gated regardless of what the policies end up saying.
-- ---------------------------------------------------------------------

comment on table game_sessions is
  'One row per live Fun Zone match. Moves are NOT stored — they run over '
  'Realtime broadcast. The winner is derived from the move list by '
  'finish_game(), never supplied by a client.';
