-- ============================================================
-- 023_mrf_fk_on_delete.sql
-- Make every foreign key that references manpower_requisitions
-- "ON DELETE SET NULL" so an MRF can be deleted (children are just
-- detached, not blocked). Covers job_openings, offer_approval_requests,
-- recruitment_audit_logs, document_collection_links, and any others.
-- Idempotent. HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- ============================================================
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname,
           cl.relname  AS tbl,
           att.attname AS col
    FROM pg_constraint con
    JOIN pg_class cl     ON cl.oid  = con.conrelid
    JOIN pg_class ref    ON ref.oid = con.confrelid
    JOIN pg_namespace ns ON ns.oid  = cl.relnamespace
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    WHERE ref.relname = 'manpower_requisitions'
      AND con.contype = 'f'
      AND ns.nspname  = 'public'
  LOOP
    -- allow NULL (required for SET NULL), drop the old FK, recreate as SET NULL
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', r.tbl, r.col);
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, r.conname);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.manpower_requisitions(id) ON DELETE SET NULL', r.tbl, r.conname, r.col);
  END LOOP;
END $$;

notify pgrst, 'reload schema';
