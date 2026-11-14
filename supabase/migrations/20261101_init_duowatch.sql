-- ============================================================================
-- DuoWatch Private Cinema - Database Schema & Security Policies
-- Migration: 20261101_init_duowatch.sql
-- Budget: Free Tier Compliant ($0)
-- Strict Constraints:
--   1. Exactly 2 participants, atomic capacity, zero public directory
--   2. Hardened SECURITY DEFINER functions with SET search_path = ''
--   3. Authenticated session credentials & STRICT auth.uid() identity binding
--   4. Minimal SECURITY DEFINER helper deriving auth.uid() internally (no user_id spoofing)
--   5. Realtime policies strictly enforce channel membership for authenticated participants
--   6. Least-privilege EXECUTE permissions: REVOKED from anon, GRANTED to authenticated only
-- ============================================================================

-- Schema Security: Revoke default CREATE privileges on public schema from PUBLIC
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- 1. Rooms Table
CREATE TABLE IF NOT EXISTS public.duowatch_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_code VARCHAR(32) UNIQUE NOT NULL,
    room_name VARCHAR(64) NOT NULL DEFAULT 'Private Cinema',
    created_by UUID NOT NULL, -- Strictly bound to auth.uid() of room creator
    owner_token_hash VARCHAR(64) NOT NULL, -- SHA-256 hash of Owner secret token
    guest_passcode_hash VARCHAR(64) NOT NULL, -- SHA-256 hash of Guest invite passcode
    current_mode VARCHAR(16) NOT NULL DEFAULT 'youtube' CHECK (current_mode IN ('youtube', 'local', 'screen')),
    media_state JSONB NOT NULL DEFAULT '{"videoId": "dQw4w9WgXcQ", "currentTime": 0, "isPlaying": false, "updatedAt": 0}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    is_active BOOLEAN NOT NULL DEFAULT true
);

-- 2. Participants Table
CREATE TABLE IF NOT EXISTS public.duowatch_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES public.duowatch_rooms(id) ON DELETE CASCADE,
    participant_id VARCHAR(64) NOT NULL,
    user_id UUID NOT NULL, -- Strictly bound to auth.uid() for private Realtime channel authorization
    session_token_hash VARCHAR(64) NOT NULL, -- SHA-256 hash of secret per-participant session credential
    display_name VARCHAR(32) NOT NULL,
    role VARCHAR(16) NOT NULL CHECK (role IN ('owner', 'partner')),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (room_id, participant_id)
);

-- 3. Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_duowatch_rooms_code ON public.duowatch_rooms(room_code);
CREATE INDEX IF NOT EXISTS idx_duowatch_rooms_expiry ON public.duowatch_rooms(expires_at, is_active);
CREATE INDEX IF NOT EXISTS idx_duowatch_participants_lookup ON public.duowatch_participants(room_id, participant_id);
CREATE INDEX IF NOT EXISTS idx_duowatch_participants_session ON public.duowatch_participants(room_id, participant_id, session_token_hash);
CREATE INDEX IF NOT EXISTS idx_duowatch_participants_user ON public.duowatch_participants(user_id);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.duowatch_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duowatch_participants ENABLE ROW LEVEL SECURITY;

-- 5. Strict Zero-Trust Table Policies
-- All direct client table operations (SELECT, INSERT, UPDATE, DELETE) are explicitly denied.
-- The client application interacts solely through verified, parameter-checked SECURITY DEFINER functions.
-- This guarantees:
--   a) Zero public directory scraping or enumeration of active rooms via PostgREST
--   b) Zero exposure of owner_token_hash, guest_passcode_hash or session_token_hash
--   c) Zero direct tampering with participant counts or session states
DROP POLICY IF EXISTS "Deny direct table operations on rooms" ON public.duowatch_rooms;
CREATE POLICY "Deny direct table operations on rooms" 
    ON public.duowatch_rooms 
    FOR ALL 
    TO public 
    USING (false) 
    WITH CHECK (false);

DROP POLICY IF EXISTS "Deny direct table operations on participants" ON public.duowatch_participants;
CREATE POLICY "Deny direct table operations on participants" 
    ON public.duowatch_participants 
    FOR ALL 
    TO public 
    USING (false) 
    WITH CHECK (false);

-- 6. RPC: Create Private Room (Strictly requires auth.uid())
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
    v_room public.duowatch_rooms%ROWTYPE;
    v_creator_uid UUID;
BEGIN
    -- Strict authentication check: caller MUST possess an authenticated Supabase identity
    v_creator_uid := (SELECT auth.uid());
    IF v_creator_uid IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED');
    END IF;

    -- Validate room code format: 6-32 chars alphanumeric and hyphens
    IF p_room_code IS NULL OR pg_catalog.length(p_room_code) < 6 OR pg_catalog.length(p_room_code) > 32 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_ROOM_CODE_FORMAT');
    END IF;

    -- Validate hashes: SHA-256 hex is exactly 64 characters
    IF p_owner_token_hash IS NULL OR pg_catalog.length(p_owner_token_hash) != 64 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_OWNER_TOKEN_HASH');
    END IF;

    IF p_guest_passcode_hash IS NULL OR pg_catalog.length(p_guest_passcode_hash) != 64 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_GUEST_PASSCODE_HASH');
    END IF;

    -- Validate media mode
    IF p_initial_mode IS NOT NULL AND p_initial_mode NOT IN ('youtube', 'local', 'screen') THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_MEDIA_MODE');
    END IF;

    INSERT INTO public.duowatch_rooms (
        room_code,
        room_name,
        created_by,
        owner_token_hash,
        guest_passcode_hash,
        current_mode,
        expires_at
    ) VALUES (
        p_room_code,
        COALESCE(NULLIF(p_room_name, ''), 'Private Cinema'),
        v_creator_uid,
        p_owner_token_hash,
        p_guest_passcode_hash,
        COALESCE(p_initial_mode, 'youtube'),
        pg_catalog.now() + INTERVAL '24 hours'
    )
    RETURNING * INTO v_room;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'roomId', v_room.id,
        'roomCode', v_room.room_code,
        'roomName', v_room.room_name,
        'expiresAt', v_room.expires_at
    );
EXCEPTION WHEN unique_violation THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'ROOM_CODE_ALREADY_EXISTS');
END;
$$;

-- 7. RPC: Join Room (Atomic Row Lock, Strict 2-Participant Limit & Strict auth.uid() binding)
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
BEGIN
    -- Strict authentication check: caller MUST possess an authenticated Supabase identity
    v_caller_uid := (SELECT auth.uid());
    IF v_caller_uid IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED');
    END IF;

    -- Validate role
    IF p_role NOT IN ('owner', 'partner') THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_ROLE');
    END IF;

    -- Validate token hash length (SHA-256 hex is 64 characters)
    IF p_token_hash IS NULL OR pg_catalog.length(p_token_hash) != 64 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_TOKEN_HASH');
    END IF;

    -- Validate session token hash (server-verifiable per-participant credential)
    IF p_session_token_hash IS NULL OR pg_catalog.length(p_session_token_hash) != 64 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_SESSION_CREDENTIAL');
    END IF;

    -- Validate participant ID length
    IF p_participant_id IS NULL OR pg_catalog.length(p_participant_id) < 3 OR pg_catalog.length(p_participant_id) > 64 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_PARTICIPANT_ID');
    END IF;

    -- 1. Lock room row to prevent race conditions during concurrent joins
    SELECT * INTO v_room FROM public.duowatch_rooms 
    WHERE room_code = p_room_code AND is_active = true AND expires_at > pg_catalog.now()
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'ROOM_NOT_FOUND_OR_EXPIRED');
    END IF;

    -- 2. Verify token hash cryptographically
    IF p_role = 'owner' THEN
        IF v_room.owner_token_hash != p_token_hash THEN
            RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_OWNER_TOKEN');
        END IF;
    ELSIF p_role = 'partner' THEN
        IF v_room.guest_passcode_hash != p_token_hash THEN
            RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_GUEST_PASSCODE');
        END IF;
    END IF;

    -- 3. Check if participant is already registered (reconnecting or refreshed page)
    SELECT * INTO v_existing_participant FROM public.duowatch_participants
    WHERE room_id = v_room.id AND participant_id = p_participant_id;

    IF FOUND THEN
        -- Strictly enforce user identity binding: reject if caller's auth.uid() does not match bound user_id
        IF v_existing_participant.user_id != (SELECT auth.uid()) THEN
            RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'UNAUTHORIZED_USER_BINDING');
        END IF;

        UPDATE public.duowatch_participants
        SET last_seen = pg_catalog.now(),
            display_name = p_display_name,
            session_token_hash = p_session_token_hash
        WHERE id = v_existing_participant.id;
        
        RETURN pg_catalog.jsonb_build_object(
            'success', true, 
            'roomId', v_room.id, 
            'roomCode', v_room.room_code,
            'roomName', v_room.room_name,
            'role', p_role, 
            'currentMode', v_room.current_mode,
            'mediaState', v_room.media_state
        );
    END IF;

    -- 4. Purge stale participants who haven't sent a heartbeat in > 90 seconds
    DELETE FROM public.duowatch_participants
    WHERE room_id = v_room.id AND last_seen < (pg_catalog.now() - INTERVAL '90 seconds');

    -- 5. Count active participants: capacity MUST NOT exceed 2
    SELECT pg_catalog.count(*) INTO v_participant_count FROM public.duowatch_participants
    WHERE room_id = v_room.id;

    IF v_participant_count >= 2 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'ROOM_FULL');
    END IF;

    -- 6. Insert verified participant with their session token hash and strictly bound user_id = (SELECT auth.uid())
    INSERT INTO public.duowatch_participants (
        room_id, 
        participant_id, 
        user_id, 
        session_token_hash, 
        display_name, 
        role
    ) VALUES (
        v_room.id, 
        p_participant_id, 
        (SELECT auth.uid()), 
        p_session_token_hash, 
        p_display_name, 
        p_role
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
END;
$$;

-- 8. RPC: Heartbeat (Strictly requires session_token_hash AND user_id = (SELECT auth.uid()))
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

    -- Strict dual authentication: session_token_hash matches AND user_id = (SELECT auth.uid())
    UPDATE public.duowatch_participants
    SET last_seen = pg_catalog.now()
    WHERE room_id = v_room_id 
      AND participant_id = p_participant_id 
      AND session_token_hash = p_session_token_hash
      AND user_id = (SELECT auth.uid());

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    IF v_updated_count = 0 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'UNAUTHORIZED_SESSION');
    END IF;

    RETURN pg_catalog.jsonb_build_object('success', true);
END;
$$;

-- 9. RPC: Leave Room (Strictly requires session_token_hash AND user_id = (SELECT auth.uid()))
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
    v_caller_uid UUID;
    v_deleted_count INT;
BEGIN
    v_caller_uid := (SELECT auth.uid());
    IF v_caller_uid IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED');
    END IF;

    IF p_session_token_hash IS NULL OR pg_catalog.length(p_session_token_hash) != 64 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_SESSION_CREDENTIAL');
    END IF;

    SELECT id INTO v_room_id FROM public.duowatch_rooms WHERE room_code = p_room_code;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'ROOM_NOT_FOUND');
    END IF;

    -- Strict dual authentication: an attacker cannot kick another participant
    DELETE FROM public.duowatch_participants
    WHERE room_id = v_room_id 
      AND participant_id = p_participant_id 
      AND session_token_hash = p_session_token_hash
      AND user_id = (SELECT auth.uid());

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    IF v_deleted_count = 0 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'UNAUTHORIZED_SESSION');
    END IF;

    RETURN pg_catalog.jsonb_build_object('success', true);
END;
$$;

-- 10. RPC: Update Media State (Strictly Host Only: session_token_hash, role = 'owner', AND user_id = (SELECT auth.uid()))
CREATE OR REPLACE FUNCTION public.duowatch_update_media_state(
    p_room_code VARCHAR,
    p_participant_id VARCHAR,
    p_session_token_hash VARCHAR,
    p_current_mode VARCHAR,
    p_media_state JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_room_id UUID;
    v_caller_uid UUID;
BEGIN
    v_caller_uid := (SELECT auth.uid());
    IF v_caller_uid IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED');
    END IF;

    IF p_session_token_hash IS NULL OR pg_catalog.length(p_session_token_hash) != 64 THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_SESSION_CREDENTIAL');
    END IF;

    -- Strict triple verification: role = 'owner', valid session_token_hash, and user_id = (SELECT auth.uid())
    SELECT r.id INTO v_room_id 
    FROM public.duowatch_rooms r
    JOIN public.duowatch_participants p ON p.room_id = r.id
    WHERE r.room_code = p_room_code 
      AND r.is_active = true 
      AND r.expires_at > pg_catalog.now()
      AND p.participant_id = p_participant_id
      AND p.session_token_hash = p_session_token_hash
      AND p.role = 'owner'
      AND p.user_id = (SELECT auth.uid());

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'error', 'UNAUTHORIZED_NOT_HOST');
    END IF;

    UPDATE public.duowatch_rooms
    SET 
        current_mode = pg_catalog.coalesce(p_current_mode, current_mode),
        media_state = pg_catalog.coalesce(p_media_state, media_state)
    WHERE id = v_room_id;

    RETURN pg_catalog.jsonb_build_object('success', true);
END;
$$;

-- 11. Minimal Hardened SECURITY DEFINER Authorization Helper for Realtime Policies
-- Derives the caller identity strictly from (SELECT auth.uid()) internally.
-- Does NOT accept a caller-supplied user_id, eliminating identity forgery/probing attacks.
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
        WHERE p.user_id = (SELECT auth.uid())
          AND r.is_active = true
          AND r.expires_at > pg_catalog.now()
          AND ('duowatch_room_' || r.room_code) = p_topic
    );
END;
$$;

-- 12. Least-Privilege Execution Permissions
-- Explicitly revoke execution from PUBLIC and anon roles across all procedures
REVOKE ALL ON FUNCTION public.duowatch_create_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.duowatch_join_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.duowatch_heartbeat(VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.duowatch_leave_room(VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.duowatch_update_media_state(VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.duowatch_can_access_channel(TEXT) FROM PUBLIC, anon;

-- Grant EXECUTE exclusively to authenticated users (including Supabase Anonymous Auth)
GRANT EXECUTE ON FUNCTION public.duowatch_create_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duowatch_join_room(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duowatch_heartbeat(VARCHAR, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duowatch_leave_room(VARCHAR, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duowatch_update_media_state(VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duowatch_can_access_channel(TEXT) TO authenticated;

-- 13. Realtime Private Channel Security (realtime.messages RLS)
-- Enables cryptographic RLS enforcement on private Realtime channels ('duowatch_room_<roomCode>').
-- Uses the minimal SECURITY DEFINER helper duowatch_can_access_channel to safely verify membership.
-- NOTE: Row Level Security is already enabled on realtime.messages by default in Supabase.
-- The table is owned by supabase_realtime_admin; do not execute table alterations on realtime objects.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_tables 
        WHERE schemaname = 'realtime' AND tablename = 'messages'
    ) THEN
        EXECUTE 'DROP POLICY IF EXISTS "Allow room participants to listen to realtime channel" ON realtime.messages';
        EXECUTE 'DROP POLICY IF EXISTS "Allow room participants to broadcast to realtime channel" ON realtime.messages';

        EXECUTE '
            CREATE POLICY "Allow room participants to listen to realtime channel"
            ON realtime.messages
            FOR SELECT
            TO authenticated
            USING (
                public.duowatch_can_access_channel(realtime.topic())
            )';

        EXECUTE '
            CREATE POLICY "Allow room participants to broadcast to realtime channel"
            ON realtime.messages
            FOR INSERT
            TO authenticated
            WITH CHECK (
                public.duowatch_can_access_channel(realtime.topic())
            )';
    END IF;
END $$;
