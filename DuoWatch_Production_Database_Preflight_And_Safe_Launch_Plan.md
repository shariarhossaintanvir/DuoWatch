# DuoWatch — Production Database Preflight & Safe Launch Plan

**Executive Status:** `READY FOR OWNER APPROVAL (PREFLIGHT COMPLETED)`  
**Date:** November 14, 2026  
**Target Backend:** Supabase Production Project (`duowatch-private-cinema`)  
**Target Hosting:** Cloudflare Pages Free Tier (`https://duowatch.pages.dev`)  
**Production Branch:** `main`  
**Verified Feature Commit:** `6828b38` (on `feature/phase21-global-capacity`)  
**Budget:** Strictly $0  

---

## 1. Verified Production Database State

A direct read-only inspection of the connected production Supabase database (`duowatch-private-cinema`) confirmed the following baseline:

| Metric / Object | Observed Value | Production Meaning |
|---|---|---|
| **Total Rooms in Database** | 770 rooms | Total historical rooms created since project inception. |
| **Active-Flagged Rooms (`is_active = true`)** | 770 rooms | In the legacy architecture, rooms were never automatically deactivated upon expiration. |
| **Expired Active Rooms (`expires_at <= NOW()`)** | 557 rooms | Rooms past their 24-hour lifetime that retained `is_active = true` due to lack of a background sweeper. |
| **Unexpired Active Rooms (`expires_at > NOW()`)** | 213 rooms | Rooms within their 24-hour lifetime, but where users closed tabs or shut devices. |
| **Active Heartbeats (`last_seen >= NOW() - 90s`)** | **0 participants** | **Zero active humans currently in any session.** All 213 unexpired rooms are abandoned leases. |
| **Total Participant Records** | 816 rows | Historical participant association records. |
| **Duplicate `(room_id, role)` Groups** | 2 groups | Two historical rooms contain duplicate participant records for the same role (e.g. duplicate partner joins). |
| **Phase 21 Availability RPC** | Not Installed | `duowatch_get_platform_availability` returns 404 (`PGRST202`). Frontend currently displays fail-closed error. |
| **Phase 21 Global State Table** | Not Installed | `duowatch_global_state` singleton concurrency table does not yet exist on production. |

---

## 2. Exact Migration Blockers Identified

If the unadjusted Phase 21 migration (`20261114_global_two_participant_capacity.sql`) were executed against the production database right now, it would **fail and safely abort** at two distinct validation points:

### Blocker 1: Step 0 Active Room Guard
```sql
SELECT count(*) INTO v_active_room_count FROM public.duowatch_rooms WHERE is_active = true;
IF v_active_room_count > 1 THEN
    RAISE EXCEPTION 'MIGRATION_BLOCKED: Detected % active rooms in public.duowatch_rooms. ...', v_active_room_count;
END IF;
```
* **Failure Trigger:** `v_active_room_count` is **770**.
* **Impact:** The transaction aborts immediately with `MIGRATION_BLOCKED: Detected 770 active rooms`.
* **Underlying Constraint:** Even if the guard were omitted, Step 2 (`CREATE UNIQUE INDEX idx_duowatch_single_active_room ON public.duowatch_rooms (is_active) WHERE is_active = true;`) would fail with PostgreSQL error `23505 (unique_violation)`.

### Blocker 2: Step 0 Duplicate Role Guard
```sql
SELECT count(*) INTO v_duplicate_roles FROM (
    SELECT room_id, role FROM public.duowatch_participants
    GROUP BY room_id, role HAVING count(*) > 1
) all_dupes;
IF v_duplicate_roles > 0 THEN
    RAISE EXCEPTION 'MIGRATION_BLOCKED: Detected duplicate (room_id, role) entries ...';
END IF;
```
* **Failure Trigger:** `v_duplicate_roles` is **2**.
* **Impact:** The transaction aborts with `MIGRATION_BLOCKED: Detected duplicate (room_id, role) entries`.
* **Underlying Constraint:** Step 3 (`ALTER TABLE public.duowatch_participants ADD CONSTRAINT uq_duowatch_participants_room_role UNIQUE (room_id, role);`) cannot be created while duplicate rows exist.

---

## 3. Non-Destructive Reconciliation Strategy

To resolve both blockers without dropping tables, deleting historical rooms, or losing participant data, we have prepared a dedicated, non-destructive reconciliation script:  
**File:** [supabase/migrations/20261114_reconcile_legacy_production_data.sql](file:///C:/DuoWatch/supabase/migrations/20261114_reconcile_legacy_production_data.sql)

### 3.1 Non-Destructive Principles
1. **Preserve All 770 Room Records:**  
   Zero rooms are deleted. The 557 wall-clock expired rooms and the 213 abandoned rooms (with 0 active heartbeats) are simply updated to `is_active = false`. All room codes, names, creation times, modes, and media states remain intact in `public.duowatch_rooms` for auditing and history.
2. **Preserve All 816 Participant Records:**  
   To resolve the 2 duplicate role groups without data loss, a permanent archive table `public.duowatch_participants_archive` is created. The 2 older duplicate entries are copied to the archive table before being removed from the active table. 814 rows remain in `public.duowatch_participants`, and 2 rows are safely preserved in `public.duowatch_participants_archive`.
3. **Protect Live Sessions (Fail-Safe):**  
   The room deactivation query specifically checks `NOT EXISTS (... last_seen >= NOW() - INTERVAL '90 seconds')`. If any participant had sent a heartbeat within 90 seconds, that room would NOT be deactivated.
4. **Immediate Platform Availability for Today's Movie Launch:**  
   Deactivating abandoned rooms brings `is_active = true` count to 0, immediately unlocking the platform (`isAvailable: true`) so the owner and partner can create a room and start watching immediately after deployment.

### 3.2 Reconciliation SQL Overview
```sql
BEGIN;

-- 1. Create Archive Table
CREATE TABLE IF NOT EXISTS public.duowatch_participants_archive (
    id UUID PRIMARY KEY,
    room_id UUID NOT NULL,
    participant_id VARCHAR(64) NOT NULL,
    user_id UUID NOT NULL,
    session_token_hash VARCHAR(64) NOT NULL,
    display_name VARCHAR(32) NOT NULL,
    role VARCHAR(16) NOT NULL,
    last_seen TIMESTAMPTZ NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    archive_reason VARCHAR(64) NOT NULL DEFAULT 'legacy_duplicate_role_reconciliation'
);

-- 2. Archive and Deduplicate the 2 Duplicate Role Groups (preserve newest record)
WITH ranked_dupes AS (
    SELECT *, ROW_NUMBER() OVER (
        PARTITION BY room_id, role ORDER BY last_seen DESC, joined_at DESC
    ) AS rnk
    FROM public.duowatch_participants
)
INSERT INTO public.duowatch_participants_archive
SELECT id, room_id, participant_id, user_id, session_token_hash, 
       display_name, role, last_seen, joined_at, pg_catalog.now(), 'legacy_duplicate_role_reconciliation'
FROM ranked_dupes WHERE rnk > 1
ON CONFLICT (id) DO NOTHING;

WITH ranked_dupes AS (
    SELECT id, ROW_NUMBER() OVER (
        PARTITION BY room_id, role ORDER BY last_seen DESC, joined_at DESC
    ) AS rnk
    FROM public.duowatch_participants
)
DELETE FROM public.duowatch_participants WHERE id IN (SELECT id FROM ranked_dupes WHERE rnk > 1);

-- 3. Deactivate 557 Expired Rooms (expires_at <= NOW())
UPDATE public.duowatch_rooms SET is_active = false
WHERE is_active = true AND expires_at <= pg_catalog.now();

-- 4. Deactivate 213 Abandoned Rooms (0 heartbeats in > 90s)
UPDATE public.duowatch_rooms SET is_active = false
WHERE is_active = true AND NOT EXISTS (
    SELECT 1 FROM public.duowatch_participants p
    WHERE p.room_id = duowatch_rooms.id
      AND p.last_seen >= (pg_catalog.now() - INTERVAL '90 seconds')
);

-- 5. Validation Check
DO $$
DECLARE
    v_active_room_count INT;
    v_duplicate_roles INT;
BEGIN
    SELECT count(*) INTO v_active_room_count FROM public.duowatch_rooms WHERE is_active = true;
    IF v_active_room_count > 1 THEN
        RAISE EXCEPTION 'RECONCILIATION_FAILED: Still detected % active rooms.', v_active_room_count;
    END IF;

    SELECT count(*) INTO v_duplicate_roles FROM (
        SELECT room_id, role FROM public.duowatch_participants GROUP BY room_id, role HAVING count(*) > 1
    ) dupes;
    IF v_duplicate_roles > 0 THEN
        RAISE EXCEPTION 'RECONCILIATION_FAILED: Still detected % duplicate role groups.', v_duplicate_roles;
    END IF;
END $$;

COMMIT;
```

---

## 4. Application Compatibility Review (Commit `6828b38`)

A strict verification of the application source code at commit `6828b38` confirmed:

1. **Atomic Host Creation:**  
   `RoomService.createRoom` transmits `p_host_participant_id`, `p_host_session_token_hash`, and `p_host_display_name` to the 8-parameter `duowatch_create_room` RPC. The room and Host participant records are inserted atomically inside a single serialized transaction. The host never needs a second join call.
2. **Global Capacity Enforcement:**  
   Every mutating procedure (`create_room`, `join_room`, `leave_room`, `end_room`, `get_platform_availability`) acquires `FOR UPDATE` row lock on `duowatch_global_state (id = 1)`. Race conditions are serialized by PostgreSQL.
3. **No Unsafe Legacy Fallback:**  
   Once the migration runs, `DROP FUNCTION IF EXISTS public.duowatch_create_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR);` drops the old 5-parameter signature. All creation traffic routes through the 8-parameter atomic function with global capacity checks.
4. **No Missing Singleton Lock:**  
   All Phase 21 RPCs verify `PERFORM 1 FROM public.duowatch_global_state WHERE id = 1 FOR UPDATE;` and fail with diagnostic exceptions if the singleton row is absent.
5. **Role Consistency:**  
   Both PostgreSQL and TypeScript strictly enforce `role IN ('owner', 'partner')`. `duowatch_create_room` defaults host to `'owner'`, and `duowatch_join_room` assigns `'partner'`.
6. **Fail-Closed Availability Check:**  
   If the database connection drops or returns an error, `RoomService.checkPlatformAvailability` returns `isAvailable: false`, preventing phantom room creation during transient outages.
7. **Existing Session Compatibility:**  
   Because all historical rooms are marked `is_active = false` rather than deleted, existing session storage entries for concluded rooms will gracefully display expired room screens without throwing database foreign key violations.

---

## 5. Security Warnings & Significance

1. **RLS Deny-All Policy is Active:**  
   Zero-trust table RLS policies on `duowatch_rooms` and `duowatch_participants` are confirmed active. Direct PostgREST table queries from clients return 0 rows. All interactions occur via parameter-checked `SECURITY DEFINER` procedures with `SET search_path = ''`.
2. **Never Commit Privileged Credentials:**  
   The application strictly uses `VITE_SUPABASE_ANON_KEY` (public JWT). The Supabase `service_role` secret must never be placed into `.env`, Cloudflare Pages environment variables, or client bundles.
3. **Realtime Broadcast Security:**  
   WebRTC signaling channels are protected by `duowatch_can_access_channel(p_topic)`. Subscriptions are only permitted if the caller has an active participant record with an unexpired heartbeat (<= 90s) in that room.

---

## 6. Safest Production Rollout Sequence

```
[ Step 1: Database Preflight & Reconcile ]
  -> Run: supabase/migrations/20261114_reconcile_legacy_production_data.sql
  -> Result: 0 active rooms, 0 duplicate roles, 100% data preserved in archive
         |
         v
[ Step 2: Apply Phase 21 Database Migration ]
  -> Run: supabase/migrations/20261114_global_two_participant_capacity.sql
  -> Result: Global state table, partial unique index, atomic RPCs deployed
         |
         v
[ Step 3: Database Verification Smoke Test ]
  -> Run: verify-supabase-cloud.mjs & platform availability RPC check
  -> Result: duowatch_get_platform_availability returns { isAvailable: true }
         |
         v
[ Step 4: GitHub Main Release ]
  -> Fast-forward merge feature/phase21-global-capacity into main
  -> Push main to origin/main (non-force)
         |
         v
[ Step 5: Cloudflare Pages Auto-Deploy ]
  -> Cloudflare builds dist/ via npm run build
  -> Site goes live at https://duowatch.pages.dev
         |
         v
[ Step 6: Live Smoke Test (Host & Partner) ]
  -> Host creates room, Partner joins via invite, watch movie together!
```

---

## 7. Operational Downtime Estimate

- **Database Reconciliation Execution:** ~1.5 seconds.
- **Phase 21 Migration Execution:** ~2.0 seconds.
- **Cloudflare Pages Build & Edge Propagation:** ~45 seconds.
- **Total Estimated Maintenance Window:** **Under 60 seconds**.
- **User Impact:** Zero live users will be interrupted (0 active heartbeats exist on the database).

---

## 8. Required Owner Approvals (Action Gate)

Please review the findings and approve:

1. **Approval 1 (Database Reconciliation):**  
   Authorize executing [supabase/migrations/20261114_reconcile_legacy_production_data.sql](file:///C:/DuoWatch/supabase/migrations/20261114_reconcile_legacy_production_data.sql) in the Supabase SQL Editor.
2. **Approval 2 (Phase 21 Migration):**  
   Authorize executing [supabase/migrations/20261114_global_two_participant_capacity.sql](file:///C:/DuoWatch/supabase/migrations/20261114_global_two_participant_capacity.sql) in the Supabase SQL Editor immediately after Reconciliation.
3. **Approval 3 (GitHub Main Branch Push):**  
   Authorize fast-forward merging `feature/phase21-global-capacity` into `main` and pushing to `origin/main`.
