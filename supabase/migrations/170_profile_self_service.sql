-- =====================================================================
-- 167_profile_self_service.sql
-- "Upload your onboarding documents" clears when you upload them
--
-- NO SCHEMA CHANGE. One function replaced, same signature, same twelve
-- checks, same sentences. Safe to run twice. OPTIONAL — the profile works
-- without it; see "If this is not run" below.
--
-- WHY
--
-- 091's profile_completeness() ticks the documents item only when a row in
-- employee_documents has status = 'verified'. Two things made that item
-- impossible for an employee to clear:
--
--   1. The profile now lets an employee upload documents (My Details ->
--      Documents). Uploads are recorded as 'uploaded' for HR to verify, and
--      nothing in the app verifies employee_documents yet — so the item
--      stayed open however many documents were uploaded, while its own text
--      says "Upload your onboarding documents".
--
--   2. Documents collected by the onboarding portal live in
--      onboarding_documents (linked through onboarding_candidates.employee_id),
--      not employee_documents. Somebody whose Aadhaar and PAN HR already
--      verified during onboarding was still told to upload them.
--
-- WHAT CHANGES
--
-- The documents item now counts as done when EITHER
--   * the employee has at least one employee_documents row that is uploaded,
--     pending or verified (not rejected, expired or superseded), OR
--   * HR verified at least one of their onboarding documents.
--
-- Every other check is byte-for-byte 091's.
--
-- IF THIS IS NOT RUN
--
-- Nothing breaks. The documents item simply stays on the list until HR marks
-- a document verified, and the Documents panel already shows each upload as
-- "With HR for verification".
-- =====================================================================

create or replace function profile_completeness(p_employee_id uuid)
returns table (score int, pending text[])
language plpgsql stable as $$
declare e record; miss text[] := '{}'; total int := 12; got int := 0;
begin
  select * into e from employees where id = p_employee_id;
  if not found then return; end if;

  if e.photo_path is not null then got := got + 1;
    else miss := array_append(miss, 'Upload a passport size photo'); end if;
  if e.pan_number is not null then got := got + 1;
    else miss := array_append(miss, 'Add your PAN'); end if;
  if coalesce(e.aadhar_last4, '') <> '' then got := got + 1;
    else miss := array_append(miss, 'Add your Aadhaar'); end if;
  if e.uan_number is not null then got := got + 1;
    else miss := array_append(miss, 'Add your UAN'); end if;
  if e.bank_account_last4 is not null then got := got + 1;
    else miss := array_append(miss, 'Add your salary account'); end if;
  if e.res_address1 is not null then got := got + 1;
    else miss := array_append(miss, 'Add your present address'); end if;
  if e.perm_address1 is not null then got := got + 1;
    else miss := array_append(miss, 'Add your permanent address'); end if;
  if e.emergency_contact_1 is not null then got := got + 1;
    else miss := array_append(miss, 'Add an emergency contact'); end if;
  if e.blood_group is not null then got := got + 1;
    else miss := array_append(miss, 'Add your blood group'); end if;

  if exists (select 1 from employee_nominations
              where employee_id = p_employee_id and scheme = 'pf')
    then got := got + 1; else miss := array_append(miss, 'Add a provident fund nominee'); end if;
  if exists (select 1 from employee_nominations
              where employee_id = p_employee_id and scheme = 'gratuity')
    then got := got + 1;
    else miss := array_append(miss, 'Add a gratuity nominee — the shares must total 100%'); end if;

  -- The one change. See the header.
  if exists (select 1 from employee_documents
              where employee_id = p_employee_id
                and status in ('uploaded', 'pending', 'verified'))
     or exists (select 1 from onboarding_documents od
                  join onboarding_candidates oc on oc.id = od.onboarding_id
                 where oc.employee_id = p_employee_id and od.hr_verified)
    then got := got + 1; else miss := array_append(miss, 'Upload your onboarding documents'); end if;

  score := floor(got::numeric / total * 100);
  pending := miss;
  return next;
end $$;

-- Read it back for one employee (replace the code). Expect the documents
-- sentence to be absent for anyone who has uploaded a document.
-- select * from profile_completeness((select id from employees where emp_code = 'STC9073'));
