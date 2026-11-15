-- ============================================================================
-- DuoWatch Production Database Reconciliation Script (Hardened & Non-Destructive)
-- Target: duowatch-private-cinema (Supabase PostgreSQL)
-- Purpose: Safely reconcile legacy active rooms and duplicate participant roles
--          WITHOUT dropping tables, deleting historical rooms, or exposing data.
-- Security: Implements admission freeze, private schema archive, and strict RLS.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- STEP 1: ADMISSION FREEZE (Prevent race conditions during migration window)
-- ----------------------------------------------------------------------------
-- Immediately revoke execution of legacy RPCs so no new unconstrained rooms or
-- participants can be created while reconciliation is in progress.
REVOKE EXECUTE ON FUNCTION public.duowatch_create_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.duowatch_join_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.duowatch_join_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon, authenticated;

-- Install a safe fail-closed maintenance stub for legacy create_room
CREATE OR REPLACE FUNCTION public.duowatch_create_room(
    p_room_code VARCHAR,
    p_room_name VARCHAR,
    p_owner_token_hash VARCHAR,
    p_guest_passcode_hash VARCHAR,
    p_initial_mode VARCHAR DEFAULT 'youtube'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN pg_catalog.jsonb_build_object(
        'success', false,
        'error', 'CINEMA_MAINTENANCE_IN_PROGRESS',
        'message', 'The cinema is undergoing scheduled database upgrade. Room admission is temporarily paused.'
    );
END;
$$;

-- Acquire transaction-level table locks to guarantee atomic reconciliation
LOCK TABLE public.duowatch_rooms IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.duowatch_participants IN ACCESS EXCLUSIVE MODE;

-- ----------------------------------------------------------------------------
-- STEP 2: CREATE PRIVATE ARCHIVE SCHEMA AND SECURE TABLE
-- ----------------------------------------------------------------------------
-- Uses a dedicated private schema (unexposed to PostgREST/anon/authenticated)
CREATE SCHEMA IF NOT EXISTS duowatch_private;
REVOKE ALL ON SCHEMA duowatch_private FROM PUBLIC, anon, authenticated;
GRANT ALL ON SCHEMA duowatch_private TO postgres, service_role;

-- If duowatch_participants_archive was previously created in public, relocate it
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_tables 
        WHERE schemaname = 'public' AND tablename = 'duowatch_participants_archive'
    ) THEN
        ALTER TABLE public.duowatch_participants_archive SET SCHEMA duowatch_private;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS duowatch_private.duowatch_participants_archive (
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

-- Strict Access Control: RLS enabled + direct grants revoked from public APIs
ALTER TABLE duowatch_private.duowatch_participants_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON duowatch_private.duowatch_participants_archive FROM PUBLIC, anon, authenticated;
GRANT ALL ON duowatch_private.duowatch_participants_archive TO postgres, service_role;

-- ----------------------------------------------------------------------------
-- STEP 3: ATOMIC DEDUPLICATION AND HISTORICAL ARCHIVING
-- ----------------------------------------------------------------------------
-- Preserves 100% of historical participant data before removing duplicates from active table.
-- Atomicity guarantee: The DELETE only removes IDs that were successfully written to the archive.
WITH ranked_dupes AS (
    SELECT *,
           ROW_NUMBER() OVER (
               PARTITION BY room_id, role 
               ORDER BY last_seen DESC, joined_at DESC
           ) AS rnk
    FROM public.duowatch_participants
),
dupes_to_archive AS (
    SELECT id, room_id, participant_id, user_id, session_token_hash, 
           display_name, role, last_seen, joined_at, pg_catalog.now() AS archived_at,
           'legacy_duplicate_role_reconciliation'::varchar(64) AS archive_reason
    FROM ranked_dupes
    WHERE rnk > 1
),
archived_rows AS (
    INSERT INTO duowatch_private.duowatch_participants_archive (
        id, room_id, participant_id, user_id, session_token_hash, 
        display_name, role, last_seen, joined_at, archived_at, archive_reason
    )
    SELECT id, room_id, participant_id, user_id, session_token_hash, 
           display_name, role, last_seen, joined_at, archived_at, archive_reason
    FROM dupes_to_archive
    ON CONFLICT (id) DO UPDATE SET archived_at = EXCLUDED.archived_at
    RETURNING id
)
DELETE FROM public.duowatch_participants
WHERE id IN (SELECT id FROM archived_rows);

-- ----------------------------------------------------------------------------
-- STEP 4: NON-DESTRUCTIVE ROOM DEACTIVATION (Expired & Abandoned)
-- ----------------------------------------------------------------------------
-- 4.1 Deactivate rooms whose 24-hour expiration timestamp has passed
UPDATE public.duowatch_rooms
SET is_active = false
WHERE is_active = true
  AND expires_at <= pg_catalog.now();

-- 4.2 Deactivate rooms that have NO active participants with a heartbeat in the last 90 seconds
UPDATE public.duowatch_rooms
SET is_active = false
WHERE is_active = true
  AND NOT EXISTS (
      SELECT 1 
      FROM public.duowatch_participants p
      WHERE p.room_id = duowatch_rooms.id
        AND p.last_seen >= (pg_catalog.now() - INTERVAL '90 seconds')
  );

-- 4.3 If more than 1 room is genuinely active, retain only the single most recently active one
UPDATE public.duowatch_rooms
SET is_active = false
WHERE is_active = true
  AND id != (
      SELECT r.id FROM public.duowatch_rooms r
      LEFT JOIN public.duowatch_participants p ON p.room_id = r.id
      WHERE r.is_active = true
      ORDER BY COALESCE(p.last_seen, r.created_at) DESC, r.created_at DESC
      LIMIT 1
  );

-- ----------------------------------------------------------------------------
-- STEP 5: INTEGRITY VALIDATION & SAFE ABORT
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_active_room_count INT;
    v_duplicate_roles INT;
    v_archive_count INT;
BEGIN
    SELECT count(*) INTO v_archive_count FROM duowatch_private.duowatch_participants_archive;

    -- Verify no duplicate (room_id, role) combinations remain
    SELECT count(*) INTO v_duplicate_roles
    FROM (
        SELECT room_id, role FROM public.duowatch_participants
        GROUP BY room_id, role
        HAVING count(*) > 1
    ) all_dupes;

    IF v_duplicate_roles > 0 THEN
        RAISE EXCEPTION 'RECONCILIATION_ABORT: Detected % unresolved duplicate (room_id, role) groups in public.duowatch_participants.', v_duplicate_roles;
    END IF;

    -- Verify active room count is at most 1
    SELECT count(*) INTO v_active_room_count
    FROM public.duowatch_rooms
    WHERE is_active = true;

    IF v_active_room_count > 1 THEN
        RAISE EXCEPTION 'RECONCILIATION_ABORT: Detected % active rooms after reconciliation (expected <= 1).', v_active_room_count;
    END IF;

    RAISE NOTICE 'SUCCESS: Database successfully reconciled. Active rooms: %. Archived rows: %. Ready for Phase 21.', v_active_room_count, v_archive_count;
END $$;

COMMIT;

-- ============================================================================
-- READ-ONLY POST-RECONCILIATION VERIFICATION QUERIES (Run to verify state)
-- ============================================================================
-- Query 1: Verify exactly 0 or 1 active room remains
-- SELECT count(*) AS active_room_count FROM public.duowatch_rooms WHERE is_active = true;

-- Query 2: Verify zero duplicate (room_id, role) entries in active participants
-- SELECT room_id, role, count(*) FROM public.duowatch_participants GROUP BY room_id, role HAVING count(*) > 1;

-- Query 3: Verify archived historical records are safely retained in private schema
-- SELECT count(*) AS archived_participant_count FROM duowatch_private.duowatch_participants_archive;

-- Query 4: Verify private schema is NOT accessible to anon/authenticated
-- SELECT has_table_privilege('anon', 'duowatch_private.duowatch_participants_archive', 'select') AS anon_can_select,
--        has_table_privilege('authenticated', 'duowatch_private.duowatch_participants_archive', 'select') AS auth_can_select;
-- (Expected result: false, false)
