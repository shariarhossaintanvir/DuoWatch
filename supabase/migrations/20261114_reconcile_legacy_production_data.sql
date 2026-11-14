-- ============================================================================
-- DuoWatch Production Database Reconciliation Script (Non-Destructive)
-- Target: duowatch-private-cinema (Supabase PostgreSQL)
-- Purpose: Safely reconcile legacy active rooms and duplicate participant roles
--          WITHOUT dropping tables, deleting historical rooms, or losing data.
-- ============================================================================

BEGIN;

-- 1. Create Archive Table for Historical Participant Deduplication
-- Preserves 100% of historical participant data before removing duplicates from active table
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

-- 2. Archive and Reconcile Duplicate (room_id, role) Records
-- Keeps the most recent participant entry (highest last_seen, joined_at) in duowatch_participants
-- Moves any older duplicate entries into duowatch_participants_archive
WITH ranked_dupes AS (
    SELECT *,
           ROW_NUMBER() OVER (
               PARTITION BY room_id, role 
               ORDER BY last_seen DESC, joined_at DESC
           ) AS rnk
    FROM public.duowatch_participants
)
INSERT INTO public.duowatch_participants_archive (
    id, room_id, participant_id, user_id, session_token_hash, 
    display_name, role, last_seen, joined_at, archived_at, archive_reason
)
SELECT id, room_id, participant_id, user_id, session_token_hash, 
       display_name, role, last_seen, joined_at, pg_catalog.now(), 'legacy_duplicate_role_reconciliation'
FROM ranked_dupes
WHERE rnk > 1
ON CONFLICT (id) DO NOTHING;

-- Safely delete only the archived duplicate rows from the active table
WITH ranked_dupes AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY room_id, role 
               ORDER BY last_seen DESC, joined_at DESC
           ) AS rnk
    FROM public.duowatch_participants
)
DELETE FROM public.duowatch_participants
WHERE id IN (
    SELECT id FROM ranked_dupes WHERE rnk > 1
);

-- 3. Non-Destructive Room Deactivation: Expired Rooms
-- Deactivate rooms whose 24-hour expiration timestamp has passed (expires_at <= NOW())
-- Preserves all room rows, metadata, room codes, and timestamps in place
UPDATE public.duowatch_rooms
SET is_active = false
WHERE is_active = true
  AND expires_at <= pg_catalog.now();

-- 4. Non-Destructive Room Deactivation: Abandoned Sessions
-- Deactivate rooms that have NO active participants with a heartbeat in the last 90 seconds
-- Any genuinely active session with fresh heartbeats will NOT be touched
UPDATE public.duowatch_rooms
SET is_active = false
WHERE is_active = true
  AND NOT EXISTS (
      SELECT 1 
      FROM public.duowatch_participants p
      WHERE p.room_id = duowatch_rooms.id
        AND p.last_seen >= (pg_catalog.now() - INTERVAL '90 seconds')
  );

-- 5. Validation Check: Ensure database is clean for Phase 21 migration
DO $$
DECLARE
    v_active_room_count INT;
    v_duplicate_roles INT;
BEGIN
    SELECT count(*) INTO v_active_room_count
    FROM public.duowatch_rooms
    WHERE is_active = true;

    IF v_active_room_count > 1 THEN
        RAISE EXCEPTION 'RECONCILIATION_FAILED: Still detected % active rooms after reconciliation.', v_active_room_count;
    END IF;

    SELECT count(*) INTO v_duplicate_roles
    FROM (
        SELECT room_id, role FROM public.duowatch_participants
        GROUP BY room_id, role
        HAVING count(*) > 1
    ) all_dupes;

    IF v_duplicate_roles > 0 THEN
        RAISE EXCEPTION 'RECONCILIATION_FAILED: Still detected % duplicate (room_id, role) groups.', v_duplicate_roles;
    END IF;

    RAISE NOTICE 'SUCCESS: Database successfully reconciled. Active rooms: %. Duplicate roles: 0. Ready for Phase 21 migration.', v_active_room_count;
END $$;

COMMIT;
