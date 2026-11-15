-- ============================================================================
-- DuoWatch Zero-Downtime Atomic Phase 21 Production Migration
-- Target: duowatch-private-cinema (Supabase PostgreSQL)
-- Description: Executes reconciliation, schema hardening, and Phase 21
--              global 2-participant capacity in ONE SINGLE ATOMIC TRANSACTION.
-- Safety: Access exclusive table locks, admission freeze, private schema archive,
--         zero data loss, fail-closed rollback on any error.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- STEP 1: ADMISSION FREEZE & CONCURRENCY LOCK
-- ----------------------------------------------------------------------------
-- Revoke legacy room creation immediately to prevent unconstrained admissions
REVOKE EXECUTE ON FUNCTION public.duowatch_create_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.duowatch_join_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.duowatch_join_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon, authenticated;

-- Fail-closed maintenance stub in case a legacy client calls create_room during migration
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

-- Table locks prevent any concurrent client transaction from reading or mutating state during migration
LOCK TABLE public.duowatch_rooms IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.duowatch_participants IN ACCESS EXCLUSIVE MODE;

-- ----------------------------------------------------------------------------
-- STEP 2: PRIVATE ARCHIVE SCHEMA & RESTRICTIVE ACCESS MODEL
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS duowatch_private;
REVOKE ALL ON SCHEMA duowatch_private FROM PUBLIC, anon, authenticated;
GRANT ALL ON SCHEMA duowatch_private TO postgres, service_role;

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

ALTER TABLE duowatch_private.duowatch_participants_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON duowatch_private.duowatch_participants_archive FROM PUBLIC, anon, authenticated;
GRANT ALL ON duowatch_private.duowatch_participants_archive TO postgres, service_role;

-- ----------------------------------------------------------------------------
-- STEP 3: ATOMIC DEDUPLICATION & ARCHIVE
-- ----------------------------------------------------------------------------
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
-- STEP 4: NON-DESTRUCTIVE ROOM DEACTIVATION
-- ----------------------------------------------------------------------------
-- Deactivate expired rooms
UPDATE public.duowatch_rooms
SET is_active = false
WHERE is_active = true
  AND expires_at <= pg_catalog.now();

-- Deactivate abandoned rooms (>90s without heartbeat)
UPDATE public.duowatch_rooms
SET is_active = false
WHERE is_active = true
  AND NOT EXISTS (
      SELECT 1 
      FROM public.duowatch_participants p
      WHERE p.room_id = duowatch_rooms.id
        AND p.last_seen >= (pg_catalog.now() - INTERVAL '90 seconds')
  );

-- Retain at most 1 active room if multiple rooms had recent heartbeats
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
-- STEP 5: INSTALL PHASE 21 GLOBAL STATE & CONSTRAINT INVARIANTS
-- ----------------------------------------------------------------------------
-- 5.1 Enforce single active room at the database level
CREATE UNIQUE INDEX IF NOT EXISTS duowatch_rooms_single_active_idx 
ON public.duowatch_rooms ((1)) 
WHERE (is_active = true);

-- 5.2 Create global state singleton table
CREATE TABLE IF NOT EXISTS public.duowatch_global_state (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    active_room_id UUID REFERENCES public.duowatch_rooms(id) ON DELETE SET NULL,
    max_global_active_rooms INT NOT NULL DEFAULT 1 CHECK (max_global_active_rooms = 1),
    max_room_participants INT NOT NULL DEFAULT 2 CHECK (max_room_participants = 2),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE public.duowatch_global_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.duowatch_global_state FROM PUBLIC, anon, authenticated;

-- Initialize global state pointing to currently active room (if any)
INSERT INTO public.duowatch_global_state (id, active_room_id, updated_at)
VALUES (1, (SELECT id FROM public.duowatch_rooms WHERE is_active = true LIMIT 1), pg_catalog.now())
ON CONFLICT (id) DO UPDATE 
SET active_room_id = (SELECT id FROM public.duowatch_rooms WHERE is_active = true LIMIT 1),
    updated_at = pg_catalog.now();

-- 5.3 Enforce single participant role per room
CREATE UNIQUE INDEX IF NOT EXISTS duowatch_participants_room_role_idx
ON public.duowatch_participants (room_id, role);

-- ----------------------------------------------------------------------------
-- STEP 6: STORED PROCEDURES (Hardened & Atomic)
-- ----------------------------------------------------------------------------
-- 6.1 Internal reconcile
CREATE OR REPLACE FUNCTION public.duowatch_internal_reconcile()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_active_room public.duowatch_rooms%ROWTYPE;
    v_host_count INT;
BEGIN
    SELECT * INTO v_active_room FROM public.duowatch_rooms 
    WHERE is_active = true
    FOR UPDATE;

    IF FOUND THEN
        IF v_active_room.expires_at <= pg_catalog.now() THEN
            UPDATE public.duowatch_rooms SET is_active = false WHERE id = v_active_room.id;
            DELETE FROM public.duowatch_participants WHERE room_id = v_active_room.id;
            UPDATE public.duowatch_global_state SET active_room_id = NULL, updated_at = pg_catalog.now() WHERE id = 1;
            RETURN;
        END IF;

        SELECT pg_catalog.count(*) INTO v_host_count
        FROM public.duowatch_participants
        WHERE room_id = v_active_room.id 
          AND role = 'owner'
          AND last_seen >= (pg_catalog.now() - INTERVAL '90 seconds');

        IF v_host_count = 0 THEN
            UPDATE public.duowatch_rooms SET is_active = false WHERE id = v_active_room.id;
            DELETE FROM public.duowatch_participants WHERE room_id = v_active_room.id;
            UPDATE public.duowatch_global_state SET active_room_id = NULL, updated_at = pg_catalog.now() WHERE id = 1;
            RETURN;
        END IF;

        DELETE FROM public.duowatch_participants
        WHERE room_id = v_active_room.id
          AND role = 'partner'
          AND last_seen < (pg_catalog.now() - INTERVAL '90 seconds');

        UPDATE public.duowatch_global_state SET active_room_id = v_active_room.id, updated_at = pg_catalog.now() WHERE id = 1;
    ELSE
        UPDATE public.duowatch_global_state SET active_room_id = NULL, updated_at = pg_catalog.now() WHERE id = 1;
    END IF;
END;
$$;

-- 6.2 Public availability check
CREATE OR REPLACE FUNCTION public.duowatch_get_platform_availability()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_active_room_id UUID;
    v_participant_count INT;
BEGIN
    PERFORM 1 FROM public.duowatch_global_state WHERE id = 1 FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CRITICAL: duowatch_global_state singleton row missing. Concurrency lock failed.';
    END IF;

    PERFORM public.duowatch_internal_reconcile();

    SELECT id INTO v_active_room_id FROM public.duowatch_rooms WHERE is_active = true;

    IF v_active_room_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'isAvailable', true,
            'status', 'available',
            'activeParticipants', 0
        );
    END IF;

    SELECT pg_catalog.count(*) INTO v_participant_count
    FROM public.duowatch_participants
    WHERE room_id = v_active_room_id
      AND last_seen >= (pg_catalog.now() - INTERVAL '90 seconds');

    IF v_participant_count <= 1 THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'isAvailable', false,
            'status', 'waiting_partner',
            'activeParticipants', v_participant_count
        );
    ELSE
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'isAvailable', false,
            'status', 'occupied',
            'activeParticipants', 2
        );
    END IF;
END;
$$;

-- 6.3 Create room with mandatory atomic host credentials
DROP FUNCTION IF EXISTS public.duowatch_create_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS public.duowatch_create_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR);
CREATE OR REPLACE FUNCTION public.duowatch_create_room(
    p_room_code VARCHAR,
    p_room_name VARCHAR,
    p_owner_token_hash VARCHAR,
    p_guest_passcode_hash VARCHAR,
    p_initial_mode VARCHAR,
    p_host_participant_id VARCHAR,
    p_host_session_token_hash VARCHAR,
    p_host_display_name VARCHAR DEFAULT 'Host'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_creator_uid UUID;
    v_existing_active_id UUID;
    v_room public.duowatch_rooms%ROWTYPE;
BEGIN
    v_creator_uid := (SELECT auth.uid());
    IF v_creator_uid IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED');
    END IF;

    IF p_room_code IS NULL OR pg_catalog.length(p_room_code) < 6 OR pg_catalog.length(p_room_code) > 32 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_ROOM_CODE_FORMAT');
    END IF;

    IF p_owner_token_hash IS NULL OR pg_catalog.length(p_owner_token_hash) != 64 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_OWNER_TOKEN_HASH');
    END IF;

    IF p_guest_passcode_hash IS NULL OR pg_catalog.length(p_guest_passcode_hash) != 64 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_GUEST_PASSCODE_HASH');
    END IF;

    IF p_host_participant_id IS NULL OR pg_catalog.length(p_host_participant_id) < 3 OR pg_catalog.length(p_host_participant_id) > 64 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'MISSING_OR_INVALID_HOST_PARTICIPANT_ID');
    END IF;

    IF p_host_session_token_hash IS NULL OR pg_catalog.length(p_host_session_token_hash) != 64 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'MISSING_OR_INVALID_HOST_SESSION_TOKEN_HASH');
    END IF;

    IF p_initial_mode IS NOT NULL AND p_initial_mode NOT IN ('youtube', 'local', 'screen') THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_MEDIA_MODE');
    END IF;

    PERFORM 1 FROM public.duowatch_global_state WHERE id = 1 FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CRITICAL: duowatch_global_state singleton row missing. Concurrency lock failed.';
    END IF;

    PERFORM public.duowatch_internal_reconcile();

    SELECT id INTO v_existing_active_id FROM public.duowatch_rooms WHERE is_active = true;
    IF v_existing_active_id IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'PLATFORM_OCCUPIED');
    END IF;

    INSERT INTO public.duowatch_rooms (
        room_code,
        room_name,
        created_by,
        owner_token_hash,
        guest_passcode_hash,
        current_mode,
        is_active,
        expires_at
    ) VALUES (
        p_room_code,
        COALESCE(NULLIF(p_room_name, ''), 'Private Cinema'),
        v_creator_uid,
        p_owner_token_hash,
        p_guest_passcode_hash,
        COALESCE(p_initial_mode, 'youtube'),
        true,
        pg_catalog.now() + INTERVAL '24 hours'
    )
    RETURNING * INTO v_room;

    INSERT INTO public.duowatch_participants (
        room_id,
        participant_id,
        user_id,
        session_token_hash,
        display_name,
        role,
        last_seen,
        joined_at
    ) VALUES (
        v_room.id,
        p_host_participant_id,
        v_creator_uid,
        p_host_session_token_hash,
        COALESCE(NULLIF(p_host_display_name, ''), 'Host'),
        'owner',
        pg_catalog.now(),
        pg_catalog.now()
    );

    UPDATE public.duowatch_global_state 
    SET active_room_id = v_room.id, updated_at = pg_catalog.now() 
    WHERE id = 1;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'roomId', v_room.id,
        'roomCode', v_room.room_code,
        'roomName', v_room.room_name,
        'role', 'owner',
        'participantId', p_host_participant_id,
        'currentMode', v_room.current_mode,
        'mediaState', v_room.media_state,
        'expiresAt', v_room.expires_at
    );
EXCEPTION 
    WHEN unique_violation THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'PLATFORM_OCCUPIED');
END;
$$;

-- 6.4 Join room
CREATE OR REPLACE FUNCTION public.duowatch_join_room(
    p_room_code VARCHAR,
    p_participant_id VARCHAR,
    p_display_name VARCHAR,
    p_token_hash VARCHAR,
    p_session_token_hash VARCHAR,
    p_role VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_room public.duowatch_rooms%ROWTYPE;
    v_participant_count INT;
    v_existing_participant public.duowatch_participants%ROWTYPE;
    v_caller_uid UUID;
    v_existing_role_count INT;
BEGIN
    v_caller_uid := (SELECT auth.uid());
    IF v_caller_uid IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED');
    END IF;

    IF p_role NOT IN ('owner', 'partner') THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_ROLE');
    END IF;

    IF p_token_hash IS NULL OR pg_catalog.length(p_token_hash) != 64 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_TOKEN_HASH');
    END IF;

    IF p_session_token_hash IS NULL OR pg_catalog.length(p_session_token_hash) != 64 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_SESSION_CREDENTIAL');
    END IF;

    IF p_participant_id IS NULL OR pg_catalog.length(p_participant_id) < 3 OR pg_catalog.length(p_participant_id) > 64 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_PARTICIPANT_ID');
    END IF;

    PERFORM 1 FROM public.duowatch_global_state WHERE id = 1 FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CRITICAL: duowatch_global_state singleton row missing. Concurrency lock failed.';
    END IF;

    PERFORM public.duowatch_internal_reconcile();

    SELECT * INTO v_room FROM public.duowatch_rooms 
    WHERE room_code = p_room_code AND is_active = true AND expires_at > pg_catalog.now()
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'ROOM_NOT_FOUND_OR_EXPIRED');
    END IF;

    IF p_role = 'owner' THEN
        IF v_room.owner_token_hash != p_token_hash THEN
            RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_OWNER_TOKEN');
        END IF;
    ELSIF p_role = 'partner' THEN
        IF v_room.guest_passcode_hash != p_token_hash THEN
            RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_GUEST_PASSCODE');
        END IF;
    END IF;

    SELECT * INTO v_existing_participant FROM public.duowatch_participants
    WHERE room_id = v_room.id AND participant_id = p_participant_id;

    IF FOUND THEN
        IF v_existing_participant.user_id != v_caller_uid THEN
            RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'UNAUTHORIZED_USER_BINDING');
        END IF;

        UPDATE public.duowatch_participants
        SET last_seen = pg_catalog.now(),
            display_name = COALESCE(NULLIF(p_display_name, ''), display_name),
            session_token_hash = p_session_token_hash
        WHERE id = v_existing_participant.id;
        
        RETURN pg_catalog.jsonb_build_object(
            'success', true, 
            'roomId', v_room.id, 
            'roomCode', v_room.room_code,
            'roomName', v_room.room_name,
            'role', v_existing_participant.role, 
            'currentMode', v_room.current_mode,
            'mediaState', v_room.media_state
        );
    END IF;

    SELECT pg_catalog.count(*) INTO v_participant_count 
    FROM public.duowatch_participants
    WHERE room_id = v_room.id;

    IF v_participant_count >= 2 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'ROOM_FULL');
    END IF;

    SELECT pg_catalog.count(*) INTO v_existing_role_count
    FROM public.duowatch_participants
    WHERE room_id = v_room.id AND role = p_role;

    IF v_existing_role_count >= 1 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'ROOM_FULL');
    END IF;

    INSERT INTO public.duowatch_participants (
        room_id, 
        participant_id, 
        user_id, 
        session_token_hash, 
        display_name, 
        role,
        last_seen,
        joined_at
    ) VALUES (
        v_room.id, 
        p_participant_id, 
        v_caller_uid, 
        p_session_token_hash, 
        COALESCE(NULLIF(p_display_name, ''), 'Partner'), 
        p_role,
        pg_catalog.now(),
        pg_catalog.now()
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true, 
        'roomId', v_room.id, 
        'roomCode', v_room.room_code,
        'roomName', v_room.room_name,
        'role', p_role, 
        'currentMode', v_room.current_mode,
        'mediaState', v_room.media_state
    );
EXCEPTION 
    WHEN unique_violation THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'ROOM_FULL');
END;
$$;

-- 6.5 Heartbeat
CREATE OR REPLACE FUNCTION public.duowatch_heartbeat(
    p_room_code VARCHAR,
    p_participant_id VARCHAR,
    p_session_token_hash VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_room_id UUID;
    v_rows_updated INT;
BEGIN
    SELECT id INTO v_room_id FROM public.duowatch_rooms
    WHERE room_code = p_room_code AND is_active = true AND expires_at > pg_catalog.now();

    IF v_room_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'ROOM_NOT_FOUND_OR_EXPIRED');
    END IF;

    UPDATE public.duowatch_participants
    SET last_seen = pg_catalog.now()
    WHERE room_id = v_room_id
      AND participant_id = p_participant_id
      AND session_token_hash = p_session_token_hash
      AND user_id = (SELECT auth.uid());

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

    IF v_rows_updated = 0 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'UNAUTHORIZED_OR_PARTICIPANT_NOT_FOUND');
    END IF;

    RETURN pg_catalog.jsonb_build_object('success', true);
END;
$$;

-- 6.6 Leave room
CREATE OR REPLACE FUNCTION public.duowatch_leave_room(
    p_room_code VARCHAR,
    p_participant_id VARCHAR,
    p_session_token_hash VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_room_id UUID;
    v_role VARCHAR;
BEGIN
    PERFORM 1 FROM public.duowatch_global_state WHERE id = 1 FOR UPDATE;

    SELECT id INTO v_room_id FROM public.duowatch_rooms
    WHERE room_code = p_room_code AND is_active = true;

    IF v_room_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'ROOM_NOT_FOUND');
    END IF;

    SELECT role INTO v_role FROM public.duowatch_participants
    WHERE room_id = v_room_id
      AND participant_id = p_participant_id
      AND session_token_hash = p_session_token_hash
      AND user_id = (SELECT auth.uid());

    IF v_role IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'UNAUTHORIZED_OR_NOT_FOUND');
    END IF;

    IF v_role = 'owner' THEN
        UPDATE public.duowatch_rooms SET is_active = false WHERE id = v_room_id;
        DELETE FROM public.duowatch_participants WHERE room_id = v_room_id;
        UPDATE public.duowatch_global_state SET active_room_id = NULL, updated_at = pg_catalog.now() WHERE id = 1;
    ELSE
        DELETE FROM public.duowatch_participants 
        WHERE room_id = v_room_id 
          AND participant_id = p_participant_id
          AND session_token_hash = p_session_token_hash
          AND user_id = (SELECT auth.uid());
    END IF;

    RETURN pg_catalog.jsonb_build_object('success', true);
END;
$$;

-- 6.7 End room
CREATE OR REPLACE FUNCTION public.duowatch_end_room(
    p_room_code VARCHAR,
    p_participant_id VARCHAR,
    p_session_token_hash VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_room_id UUID;
    v_role VARCHAR;
BEGIN
    PERFORM 1 FROM public.duowatch_global_state WHERE id = 1 FOR UPDATE;

    SELECT id INTO v_room_id FROM public.duowatch_rooms
    WHERE room_code = p_room_code AND is_active = true;

    IF v_room_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'ROOM_NOT_FOUND');
    END IF;

    SELECT role INTO v_role FROM public.duowatch_participants
    WHERE room_id = v_room_id
      AND participant_id = p_participant_id
      AND session_token_hash = p_session_token_hash
      AND user_id = (SELECT auth.uid());

    IF v_role IS NULL OR v_role != 'owner' THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'UNAUTHORIZED_NOT_HOST');
    END IF;

    UPDATE public.duowatch_rooms SET is_active = false WHERE id = v_room_id;
    DELETE FROM public.duowatch_participants WHERE room_id = v_room_id;
    UPDATE public.duowatch_global_state SET active_room_id = NULL, updated_at = pg_catalog.now() WHERE id = 1;

    RETURN pg_catalog.jsonb_build_object('success', true);
END;
$$;

-- 6.8 Realtime channel check
CREATE OR REPLACE FUNCTION public.duowatch_can_access_channel(
    p_topic TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL OR p_topic IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM public.duowatch_participants p
        JOIN public.duowatch_rooms r ON p.room_id = r.id
        WHERE p.user_id = v_uid
          AND r.is_active = true
          AND r.expires_at > pg_catalog.now()
          AND p.last_seen >= (pg_catalog.now() - INTERVAL '90 seconds')
          AND ('duowatch_room_' || r.room_code) = p_topic
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- STEP 7: LEAST-PRIVILEGE PERMISSION GRANTS
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.duowatch_internal_reconcile() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.duowatch_internal_reconcile() TO postgres, service_role;

REVOKE ALL ON FUNCTION public.duowatch_get_platform_availability() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.duowatch_create_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.duowatch_join_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.duowatch_heartbeat(VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.duowatch_leave_room(VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.duowatch_end_room(VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.duowatch_can_access_channel(TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.duowatch_get_platform_availability() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.duowatch_create_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duowatch_join_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duowatch_heartbeat(VARCHAR, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duowatch_leave_room(VARCHAR, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duowatch_end_room(VARCHAR, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duowatch_can_access_channel(TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- STEP 8: FINAL INTEGRITY VALIDATION & SAFE COMMIT
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_active_room_count INT;
    v_duplicate_roles INT;
    v_singleton_count INT;
BEGIN
    SELECT count(*) INTO v_singleton_count FROM public.duowatch_global_state WHERE id = 1;
    IF v_singleton_count != 1 THEN
        RAISE EXCEPTION 'MIGRATION_ABORT: duowatch_global_state singleton row missing or invalid.';
    END IF;

    SELECT count(*) INTO v_duplicate_roles
    FROM (
        SELECT room_id, role FROM public.duowatch_participants
        GROUP BY room_id, role
        HAVING count(*) > 1
    ) all_dupes;

    IF v_duplicate_roles > 0 THEN
        RAISE EXCEPTION 'MIGRATION_ABORT: % duplicate roles remain in duowatch_participants.', v_duplicate_roles;
    END IF;

    SELECT count(*) INTO v_active_room_count FROM public.duowatch_rooms WHERE is_active = true;
    IF v_active_room_count > 1 THEN
        RAISE EXCEPTION 'MIGRATION_ABORT: % active rooms remain (must be <= 1).', v_active_room_count;
    END IF;

    RAISE NOTICE 'SUCCESS: Phase 21 zero-downtime migration completed atomically. Active rooms: %.', v_active_room_count;
END $$;

COMMIT;
