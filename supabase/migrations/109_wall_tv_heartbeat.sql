-- =====================================================================
-- 109_wall_tv_heartbeat.sql
-- A television is not an employee. Two trigger functions.
--
-- FOR: Nayan Ahuja. NO SCHEMA CHANGE. SAFE TO RUN TWICE.
--
-- THE SYMPTOM
--
--     select get_board_payload('<a real pair code>');
--     ERROR:  Wall of Fame: no acting employee in session.
--             Set app.current_employee_id.                         [42501]
--
-- 108 fixed the volatility, so the function now reaches its last statement:
--
--     update board_screens set last_seen_at = now() where id = s.id;
--
-- and that fires trg_guard_screens -> enforce_wall_admin(), which demands an
-- acting employee. There is none, and there never can be: a board is an
-- anonymous public display authenticated by its pair code alone. Nobody is
-- signed in to a TV in a reception area.
--
-- THE SECOND HALF, WHICH IS WORSE
--
-- board_screens also carries trg_audit_screens -> wall_audit(), AFTER INSERT
-- OR UPDATE OR DELETE, writing a row with full before/after JSON. Had the
-- guard simply been bypassed, every poll would have filed an audit row. At
-- rotate_seconds = 10 that is roughly 8,600 rows per screen per day, each
-- carrying two copies of the screen record — an audit log that grows without
-- bound and buries the events somebody would actually go looking for.
--
-- So the heartbeat is exempted from BOTH triggers, not just the one that
-- raised.
--
-- HOW THE EXEMPTION IS KEPT HONEST
--
-- It does not trust the caller and does not test a flag. It proves nothing
-- else changed:
--
--     (to_jsonb(NEW) - 'last_seen_at' - 'last_seen_ip')
--   = (to_jsonb(OLD) - 'last_seen_at' - 'last_seen_ip')
--
-- Strip the two heartbeat columns from both rows and require the remainder to
-- be identical. An update that also renames the screen, moves it, widens its
-- scope or flips is_active fails that equality and takes the normal path —
-- actor required, permission checked, audit written. There is no way to smuggle
-- a real change through it, because the check is the change itself.
--
-- Both function bodies are 084's, byte for byte, with that one block inserted.
--
-- DEPENDS ON 084, 106, 107, 108.
-- =====================================================================

create or replace function enforce_wall_admin()
returns trigger language plpgsql as $$
declare
  v_actor uuid := wof_current_employee();
  v_company uuid;
  v_perm text := coalesce(TG_ARGV[0], 'wof.configure');
begin
  v_company := coalesce(
    (case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end ->> 'company_id')::uuid
  );

  -- A screen calling home is not a person acting. get_board_payload stamps
  -- last_seen_at on every poll so the Screens panel can show when a TV was
  -- last alive — and a TV has no employee behind it, only a pair code. This
  -- recognises that one update by proving nothing ELSE changed: strip the two
  -- heartbeat columns from both sides and require the remainder to be equal.
  -- Anything that touches a real column takes the normal path below.
  if TG_OP = 'UPDATE' and TG_TABLE_NAME = 'board_screens'
     and (to_jsonb(NEW) - 'last_seen_at' - 'last_seen_ip')
       = (to_jsonb(OLD) - 'last_seen_at' - 'last_seen_ip') then
    return NEW;
  end if;

  -- allow migrations, seeds and service jobs to run without a session actor
  if v_actor is null then
    if current_setting('app.service_context', true) = 'true' then
      return case when TG_OP = 'DELETE' then OLD else NEW end;
    end if;
    raise exception 'Wall of Fame: no acting employee in session. Set app.current_employee_id.'
      using errcode = '42501';
  end if;

  if not wof_can(v_actor, v_perm, v_company) then
    raise exception 'Wall of Fame: % is not permitted to change %. %',
      v_actor, TG_TABLE_NAME, wof_explain_access(v_actor, v_perm, v_company)
      using errcode = '42501';
  end if;

  return case when TG_OP = 'DELETE' then OLD else NEW end;
end $$;


create or replace function wall_audit()
returns trigger language plpgsql as $$
declare v_company uuid;
begin
  -- A screen calling home is not a person acting. get_board_payload stamps
  -- last_seen_at on every poll so the Screens panel can show when a TV was
  -- last alive — and a TV has no employee behind it, only a pair code. This
  -- recognises that one update by proving nothing ELSE changed: strip the two
  -- heartbeat columns from both sides and require the remainder to be equal.
  -- Anything that touches a real column takes the normal path below.
  if TG_OP = 'UPDATE' and TG_TABLE_NAME = 'board_screens'
     and (to_jsonb(NEW) - 'last_seen_at' - 'last_seen_ip')
       = (to_jsonb(OLD) - 'last_seen_at' - 'last_seen_ip') then
    return NEW;
  end if;

  v_company := (case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end ->> 'company_id')::uuid;
  insert into wall_audit_log (company_id, actor_id, action, entity, entity_id, before_state, after_state)
  values (
    v_company,
    wof_current_employee(),
    lower(TG_TABLE_NAME) || '.' || lower(TG_OP),
    TG_TABLE_NAME,
    (case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end ->> 'id')::uuid,
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) end,
    case when TG_OP in ('INSERT','UPDATE') then to_jsonb(NEW) end
  );
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end $$;

notify pgrst, 'reload schema';
