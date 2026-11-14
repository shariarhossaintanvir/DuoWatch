-- ============================================================================
-- DuoWatch Phase 21: Public Watch Party with Strict Global Two-Participant Capacity
-- Migration: 20261114_global_two_participant_capacity.sql
-- Budget: Zero-Cost ($0) Supabase Free Tier Compliant
--
-- Strict Invariants Enforced Server-Authoritatively:
--   1. GLOBAL_ACTIVE_ROOMS <= 1
--   2. GLOBAL_ACTIVE_PARTICIPANTS <= 2 (At most 1 Host + 1 Partner globally)
--   3. Singleton serializing lock table (duowatch_global_state) preventing race conditions
--   4. Partial unique index on duowatch_rooms (is_active) preventing multiple active rooms
--   5. Unique constraint on duowatch_participants (room_id, role)
--   6. Server-authoritative lease expiry (90s timeout) and automatic reclamation
--   7. Sanitized public availability check with zero sensitive leaks
--   8. Hardened SECURITY DEFINER functions with SET search_path = ''
--   9. Least-privilege EXECUTE permissions: REVOKED from anon, GRANTED to authenticated
-- ============================================================================

-- 0. Decommission legacy active rooms and participants to guarantee clean constraint creation
UPDATE public.duowatch_rooms SET is_active = false WHERE is_active = true;
DELETE FROM public.duowatch_participants;

-- 1. Singleton Global State Table for Concurrency Serialization
CREATE TABLE IF NOT EXISTS public.duowatch_global_state (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    active_room_id UUID REFERENCES public.duowatch_rooms(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed singleton row if absent
INSERT INTO public.duowatch_global_state (id, active_room_id, updated_at)
VALUES (1, NULL, NOW())
ON CONFLICT (id) DO NOTHING;

-- Enable RLS on global state table & deny direct table operations
ALTER TABLE public.duowatch_global_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny direct table operations on global state" ON public.duowatch_global_state;
CREATE POLICY "Deny direct table operations on global state"
    ON public.duowatch_global_state
    FOR ALL
    TO public
    USING (false)
    WITH CHECK (false);

-- 2. Database Constraint: Storage-Engine Level Single Active Room
-- Guarantees PostgreSQL will reject any transaction attempting to activate a second room
DROP INDEX IF EXISTS public.idx_duowatch_single_active_room;
CREATE UNIQUE INDEX idx_duowatch_single_active_room 
ON public.duowatch_rooms (is_active) 
WHERE is_active = true;

-- 3. Database Constraint: Exactly at most ONE Host and at most ONE Partner per room
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint 
        WHERE conname = 'uq_duowatch_participants_room_role'
    ) THEN
        ALTER TABLE public.duowatch_participants 
        ADD CONSTRAINT uq_duowatch_participants_room_role UNIQUE (room_id, role);
    END IF;
END $$;

-- 4. Internal Helper: Reconcile Stale Rooms and Expired Leases
-- Must be invoked inside a transaction holding FOR UPDATE lock on duowatch_global_state
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
    -- Locate current active room
    SELECT * INTO v_active_room FROM public.duowatch_rooms 
    WHERE is_active = true
    FOR UPDATE;

    IF FOUND THEN
        -- Check if room expired by wall clock
        IF v_active_room.expires_at <= pg_catalog.now() THEN
            UPDATE public.duowatch_rooms SET is_active = false WHERE id = v_active_room.id;
            DELETE FROM public.duowatch_participants WHERE room_id = v_active_room.id;
            UPDATE public.duowatch_global_state SET active_room_id = NULL, updated_at = pg_catalog.now() WHERE id = 1;
            RETURN;
        END IF;

        -- Check if Host participant lease expired (> 90 seconds without heartbeat)
        SELECT pg_catalog.count(*) INTO v_host_count
        FROM public.duowatch_participants
        WHERE room_id = v_active_room.id 
          AND role = 'owner'
          AND last_seen >= (pg_catalog.now() - INTERVAL '90 seconds');

        -- If Host has abandoned room (and room is older than 30s creation grace period), terminate room safely
        IF v_host_count = 0 AND v_active_room.created_at < (pg_catalog.now() - INTERVAL '30 seconds') THEN
            UPDATE public.duowatch_rooms SET is_active = false WHERE id = v_active_room.id;
            DELETE FROM public.duowatch_participants WHERE room_id = v_active_room.id;
            UPDATE public.duowatch_global_state SET active_room_id = NULL, updated_at = pg_catalog.now() WHERE id = 1;
            RETURN;
        END IF;

        -- Purge stale Partner if partner hasn't sent heartbeat in > 90 seconds
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

-- 5. RPC: Public Platform Availability Check
-- Sanitized public endpoint returning minimal platform status without leaking private data
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
    -- Acquire serialization lock on global state
    PERFORM 1 FROM public.duowatch_global_state WHERE id = 1 FOR UPDATE;

    -- Reconcile expired leases
    PERFORM public.duowatch_internal_reconcile();

    -- Check if active room exists
    SELECT id INTO v_active_room_id FROM public.duowatch_rooms WHERE is_active = true;

    IF v_active_room_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'isAvailable', true,
            'status', 'available',
            'activeParticipants', 0
        );
    END IF;

    -- Count active participants in the active room (within fresh 90s lease)
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

-- 6. RPC: Create Global Session (Strict GLOBAL_ACTIVE_ROOMS <= 1 Invariant)
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
DECLARE
    v_creator_uid UUID;
    v_existing_active_id UUID;
    v_room public.duowatch_rooms%ROWTYPE;
BEGIN
    -- 1. Caller authentication verification
    v_creator_uid := (SELECT auth.uid());
    IF v_creator_uid IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED');
    END IF;

    -- 2. Input validation
    IF p_room_code IS NULL OR pg_catalog.length(p_room_code) < 6 OR pg_catalog.length(p_room_code) > 32 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_ROOM_CODE_FORMAT');
    END IF;

    IF p_owner_token_hash IS NULL OR pg_catalog.length(p_owner_token_hash) != 64 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_OWNER_TOKEN_HASH');
    END IF;

    IF p_guest_passcode_hash IS NULL OR pg_catalog.length(p_guest_passcode_hash) != 64 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_GUEST_PASSCODE_HASH');
    END IF;

    IF p_initial_mode IS NOT NULL AND p_initial_mode NOT IN ('youtube', 'local', 'screen') THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_MEDIA_MODE');
    END IF;

    -- 3. Acquire atomic serialization lock on global state
    PERFORM 1 FROM public.duowatch_global_state WHERE id = 1 FOR UPDATE;

    -- 4. Reconcile any abandoned or expired rooms
    PERFORM public.duowatch_internal_reconcile();

    -- 5. Enforce GLOBAL_ACTIVE_ROOMS <= 1
    SELECT id INTO v_existing_active_id FROM public.duowatch_rooms WHERE is_active = true;
    IF v_existing_active_id IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'PLATFORM_OCCUPIED');
    END IF;

    -- 6. Insert new single active room
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

    -- 7. Update global state pointer
    UPDATE public.duowatch_global_state 
    SET active_room_id = v_room.id, updated_at = pg_catalog.now() 
    WHERE id = 1;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'roomId', v_room.id,
        'roomCode', v_room.room_code,
        'roomName', v_room.room_name,
        'expiresAt', v_room.expires_at
    );
EXCEPTION 
    WHEN unique_violation THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'PLATFORM_OCCUPIED');
END;
$$;

-- 7. RPC: Join Room (Strict GLOBAL_ACTIVE_PARTICIPANTS <= 2 Invariant)
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
    -- 1. Caller authentication verification
    v_caller_uid := (SELECT auth.uid());
    IF v_caller_uid IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED');
    END IF;

    -- 2. Input validation
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

    -- 3. Acquire atomic serialization lock on global state
    PERFORM 1 FROM public.duowatch_global_state WHERE id = 1 FOR UPDATE;

    -- 4. Reconcile stale participants and expired rooms
    PERFORM public.duowatch_internal_reconcile();

    -- 5. Lock active room row
    SELECT * INTO v_room FROM public.duowatch_rooms 
    WHERE room_code = p_room_code AND is_active = true AND expires_at > pg_catalog.now()
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'ROOM_NOT_FOUND_OR_EXPIRED');
    END IF;

    -- 6. Verify credentials
    IF p_role = 'owner' THEN
        IF v_room.owner_token_hash != p_token_hash THEN
            RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_OWNER_TOKEN');
        END IF;
    ELSIF p_role = 'partner' THEN
        IF v_room.guest_passcode_hash != p_token_hash THEN
            RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_GUEST_PASSCODE');
        END IF;
    END IF;

    -- 7. Check if participant is already registered (reconnection)
    SELECT * INTO v_existing_participant FROM public.duowatch_participants
    WHERE room_id = v_room.id AND participant_id = p_participant_id;

    IF FOUND THEN
        -- Identity binding: caller auth.uid() must match registered user_id
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

    -- 8. Capacity checks for new participant admission
    -- Check total participants: cannot exceed 2
    SELECT pg_catalog.count(*) INTO v_participant_count 
    FROM public.duowatch_participants
    WHERE room_id = v_room.id;

    IF v_participant_count >= 2 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'ROOM_FULL');
    END IF;

    -- Check role occupancy: exactly 1 owner, exactly 1 partner allowed
    SELECT pg_catalog.count(*) INTO v_existing_role_count
    FROM public.duowatch_participants
    WHERE room_id = v_room.id AND role = p_role;

    IF v_existing_role_count >= 1 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'ROOM_FULL');
    END IF;

    -- 9. Insert verified participant atomically
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
        COALESCE(NULLIF(p_display_name, ''), CASE WHEN p_role = 'owner' THEN 'Host' ELSE 'Partner' END), 
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

-- 8. RPC: Heartbeat (Strict participant lease renewal)
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
    v_caller_uid UUID;
    v_updated_count INT;
BEGIN
    v_caller_uid := (SELECT auth.uid());
    IF v_caller_uid IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED');
    END IF;

    IF p_session_token_hash IS NULL OR pg_catalog.length(p_session_token_hash) != 64 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_SESSION_CREDENTIAL');
    END IF;

    SELECT id INTO v_room_id FROM public.duowatch_rooms 
    WHERE room_code = p_room_code AND is_active = true AND expires_at > pg_catalog.now();

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'ROOM_NOT_FOUND_OR_EXPIRED');
    END IF;

    UPDATE public.duowatch_participants
    SET last_seen = pg_catalog.now()
    WHERE room_id = v_room_id 
      AND participant_id = p_participant_id 
      AND session_token_hash = p_session_token_hash
      AND user_id = v_caller_uid;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    IF v_updated_count = 0 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'UNAUTHORIZED_SESSION');
    END IF;

    RETURN pg_catalog.jsonb_build_object('success', true);
END;
$$;

-- 9. RPC: Leave Room (Partner departure releases partner slot; Host departure terminates room)
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
    v_room public.duowatch_rooms%ROWTYPE;
    v_caller_uid UUID;
    v_participant public.duowatch_participants%ROWTYPE;
BEGIN
    v_caller_uid := (SELECT auth.uid());
    IF v_caller_uid IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED');
    END IF;

    IF p_session_token_hash IS NULL OR pg_catalog.length(p_session_token_hash) != 64 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_SESSION_CREDENTIAL');
    END IF;

    -- Acquire serialization lock
    PERFORM 1 FROM public.duowatch_global_state WHERE id = 1 FOR UPDATE;

    SELECT * INTO v_room FROM public.duowatch_rooms WHERE room_code = p_room_code FOR UPDATE;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'ROOM_NOT_FOUND');
    END IF;

    SELECT * INTO v_participant FROM public.duowatch_participants
    WHERE room_id = v_room.id
      AND participant_id = p_participant_id
      AND session_token_hash = p_session_token_hash
      AND user_id = v_caller_uid;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'UNAUTHORIZED_SESSION');
    END IF;

    IF v_participant.role = 'owner' THEN
        -- Host departure terminates room and frees the platform
        UPDATE public.duowatch_rooms SET is_active = false WHERE id = v_room.id;
        DELETE FROM public.duowatch_participants WHERE room_id = v_room.id;
        UPDATE public.duowatch_global_state SET active_room_id = NULL, updated_at = pg_catalog.now() WHERE id = 1;
    ELSE
        -- Partner departure releases Partner slot
        DELETE FROM public.duowatch_participants WHERE id = v_participant.id;
    END IF;

    RETURN pg_catalog.jsonb_build_object('success', true);
END;
$$;

-- 10. RPC: Explicit End Room (Host Only: releases both slots immediately)
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
    v_room public.duowatch_rooms%ROWTYPE;
    v_caller_uid UUID;
    v_participant public.duowatch_participants%ROWTYPE;
BEGIN
    v_caller_uid := (SELECT auth.uid());
    IF v_caller_uid IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED');
    END IF;

    IF p_session_token_hash IS NULL OR pg_catalog.length(p_session_token_hash) != 64 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_SESSION_CREDENTIAL');
    END IF;

    -- Acquire serialization lock
    PERFORM 1 FROM public.duowatch_global_state WHERE id = 1 FOR UPDATE;

    SELECT * INTO v_room FROM public.duowatch_rooms WHERE room_code = p_room_code FOR UPDATE;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'ROOM_NOT_FOUND');
    END IF;

    SELECT * INTO v_participant FROM public.duowatch_participants
    WHERE room_id = v_room.id
      AND participant_id = p_participant_id
      AND session_token_hash = p_session_token_hash
      AND user_id = v_caller_uid
      AND role = 'owner';

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'UNAUTHORIZED_NOT_HOST');
    END IF;

    -- Deactivate room and delete participants
    UPDATE public.duowatch_rooms SET is_active = false WHERE id = v_room.id;
    DELETE FROM public.duowatch_participants WHERE room_id = v_room.id;
    UPDATE public.duowatch_global_state SET active_room_id = NULL, updated_at = pg_catalog.now() WHERE id = 1;

    RETURN pg_catalog.jsonb_build_object('success', true);
END;
$$;

-- 11. Minimal Hardened SECURITY DEFINER Realtime Access Authorization
-- Only allows active participants with a fresh heartbeat (<= 90s) in an active room to subscribe
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

-- 12. Least-Privilege Execution Permissions
REVOKE ALL ON FUNCTION public.duowatch_get_platform_availability() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.duowatch_create_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.duowatch_join_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.duowatch_heartbeat(VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.duowatch_leave_room(VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.duowatch_end_room(VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.duowatch_can_access_channel(TEXT) FROM PUBLIC, anon;

-- Public availability check is granted to anon and authenticated (contains zero sensitive data)
GRANT EXECUTE ON FUNCTION public.duowatch_get_platform_availability() TO anon, authenticated;

-- All room creation, join, and mutation operations remain strictly authenticated-only
GRANT EXECUTE ON FUNCTION public.duowatch_create_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duowatch_join_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duowatch_heartbeat(VARCHAR, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duowatch_leave_room(VARCHAR, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duowatch_end_room(VARCHAR, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duowatch_can_access_channel(TEXT) TO authenticated;
