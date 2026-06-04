#!/usr/bin/env bash
# Verifies the live Supabase schema has every column the recruitment page writes.
# Run AFTER applying supabase/migrations/0001_align_recruitment_schema.sql.
# Usage: bash scripts/check-recruitment-schema.sh
set -euo pipefail
cd "$(dirname "$0")/.."

URL=$(grep NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2 | tr -d ' "')
KEY=$(grep NEXT_PUBLIC_SUPABASE_ANON_KEY .env.local | cut -d= -f2 | tr -d ' "')

check() {
  local table=$1 cols=$2
  local code
  code=$(curl -s -o /tmp/_schema_resp.json -w "%{http_code}" \
    "$URL/rest/v1/$table?select=$cols&limit=1" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY")
  if [ "$code" = "200" ]; then
    echo "✅ $table"
  else
    echo "❌ $table ($code): $(python3 -c "import json;print(json.load(open('/tmp/_schema_resp.json')).get('message',''))" 2>/dev/null)"
  fi
}

echo "Checking recruitment schema against $URL"
check manpower_requisitions "mrf_number,company_id,location_id,department_id,designation,no_of_openings,experience_required,budget_min,budget_max,employment_type,job_description,urgency,reason_for_hire,status,assigned_recruiter,approved_at"
check candidates "mrf_id,company_id,full_name,mobile,email,source,current_company,designation,experience_years,current_ctc,expected_ctc,notice_period_days,stage,ai_score,ai_match_tag,ai_reasoning,ai_questions,interview_notes,doj"
check mrf_approvals "mrf_id,company_id,status,assigned_recruiter_email,rejection_reason"
check offer_letters "candidate_id,company_id,letter_content,to_email,cc_emails,status,sent_at"
check ctc_negotiations "candidate_id,company_id,offered_ctc,variable_pct,basic_monthly,hra_monthly,epf_monthly,net_monthly,tds_new_regime,current_ctc,hike_pct,previous_company"
check preonboarding_links "candidate_id,company_id,doj,status,sent_at,link_token,opened_at,submitted_at"
echo "Done. All ✅ = the page's reads/writes will resolve."
