# Near miss: a restore instruction that named the wrong person

**Date:** 7 September 2026
**Written by:** Tushar
**For:** Nayan Ahuja
**Status:** caught before anything was run. Corrected files are in
`~/Desktop/HRMS/pending-data-scripts.zip`.

Nothing here is outstanding except the backup restore in step 4. This is
written down because the failure mode is one that would have looked correct
right up until it did damage, and it can happen again to either of us.

---

## What happened, in order

**1. I overwrote a live column without reading it first.**

Verifying migration 104 end to end meant exercising the direct-edit path
against the real database. I sent:

```
action: edit   key: personal_email   value: manoj.sharma@example.com
```

and only afterwards realised I had never captured what was there before.
There is no audit trigger on `employees`, so the previous value now exists
only in a backup. That is the one item still open.

**2. I wrote the cleanup instruction naming him by code — and used the
wrong code.**

The handover said:

```
employee : 6dab412f-bbc6-469a-abbf-c8ea2657875b  (Manoj Kumar Sharma, SRS0001)
column   : personal_email
```

The uuid is right. **SRS0001 is not his code — it is aadhar's.**

**3. Why that is worse than an ordinary typo.**

There are three people named Manoj in the directory:

| code | name |
|---|---|
| **SRS0003** | **Manoj Kumar Sharma** — the actual subject |
| SRS9005 | Manoj Patel |
| SRS9012 | Manoj Bose |

So "Manoj Kumar Sharma, SRS0001" is internally inconsistent in a way that
does not announce itself. Anyone resolving that row by code — the natural
thing to do when a document offers one — would have landed on **aadhar**, who
has nothing to do with any of this, and written a stranger's address into
their `personal_email`. The uuid and the code pointed at two different people
and only one of them was correct.

The instruction would have executed cleanly. No constraint violation, no
error, one wrong row silently updated.

**4. How it surfaced.**

Not by review. I was checking whether
`docs/fix/grant-manoj-board-operator.sql` still held up before handing it
over, and that script identifies him as **SRS0003**. That contradicted my own
cleanup file, so I resolved both codes against live data and found aadhar
sitting on SRS0001.

It was luck that two documents about the same person disagreed. Had I written
only the cleanup file, nothing would have contradicted it.

---

## What was corrected

- `cleanup-104-verification.sql` and `cleanup-105-verification.sql` now say
  SRS0003, and both still parse clean.
- The bundle README states plainly: **restore by uuid, not by name or code**,
  and lists the three Manojs so the ambiguity is visible rather than implied.

## What is still open

The restore itself. It needs a snapshot from before 7 September 2026:

```sql
update employees
   set personal_email = '<value from backup>'
 where id = '6dab412f-bbc6-469a-abbf-c8ea2657875b';
```

If the backup shows the column was empty, set it to null with the same filter.
**Please do not substitute a plausible-looking address** — a wrong personal
email is worse than a blank one, because nothing downstream will ever flag it.

---

## What I am changing about how I write these

1. **Read before writing.** Any test that mutates a live column captures the
   old value first, in the same run, or it uses a path that writes nothing —
   reject and cancel prove just as much as approve does. The 105 verification
   was done this way: `is_disabled` was restored through a second full
   approval cycle, and the other runs ended in reject and cancel, so no
   employee value was left changed.
2. **Identify people by uuid.** A uuid resolves to one row or none. A code is
   a human-readable convenience that can be wrong while still selecting a
   valid, real, entirely different person — which is the whole failure above.
   Codes stay in these documents as a cross-check, never as the selector.
3. **Two identifiers must agree before I hand a document over.** The cost of
   checking is one query. The cost of not checking is a silent write to
   somebody else's record.

---

## The wider point

The dangerous instruction is not the one that errors. It is the one that runs
successfully against the wrong target. Every guard in this codebase that has
bitten us has the same shape — `x <> null` reading as "not blocked",
`REVOKE ... FROM anon` leaving the `PUBLIC` grant in place, an RLS denial
returning an empty set instead of an error. This was the same shape in prose:
a document that reads as authoritative, executes without complaint, and is
pointed at the wrong row.
