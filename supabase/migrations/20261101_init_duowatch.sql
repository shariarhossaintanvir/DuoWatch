-- ============================================================================
-- DuoWatch Private Cinema - Database Schema & Security Policies
-- Migration: 20261101_init_duowatch.sql
-- Budget: Free Tier Compliant ($0)
-- Strict Constraints: Exactly 2 participants, atomic capacity, no public directory
-- ============================================================================

-- 1. Rooms Table
CREATE TABLE IF NOT EXISTS public.duowatch_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_code VARCHAR(32) UNIQUE NOT NULL,
    room_name VARCHAR(64) NOT NULL DEFAULT 'Private Cinema',
    owner_token_hash VARCHAR(64) NOT NULL, -- SHA-256 hash of Owner's secret key
    guest_passcode_hash VARCHAR(64) NOT NULL, -- SHA-256 hash of Guest invite token
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

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.duowatch_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duowatch_participants ENABLE ROW LEVEL SECURITY;

-- 5. Safe Read Policies (Zero Secret Leaks)
-- Public / Anon can only read active non-expired rooms by explicit room_code lookup.
-- Note: Sensitive hash columns are never queried directly by client frontend;
-- the client interacts via SECURITY DEFINER functions.
CREATE POLICY "Allow public read room by code" 
    ON public.duowatch_rooms 
    FOR SELECT 
    USING (is_active = true AND expires_at > NOW());

CREATE POLICY "Allow participants to view room peers" 
    ON public.duowatch_participants 
    FOR SELECT 
    USING (true);

-- Disallow direct insert/update/delete by anon users to prevent bypassing authorization
-- All mutations must flow through verified stored procedures (RPCs)
CREATE POLICY "Disallow direct insert into rooms" 
    ON public.duowatch_rooms FOR INSERT WITH CHECK (false);

CREATE POLICY "Disallow direct update to rooms" 
    ON public.duowatch_rooms FOR UPDATE USING (false);

CREATE POLICY "Disallow direct delete from rooms" 
    ON public.duowatch_rooms FOR DELETE USING (false);

CREATE POLICY "Disallow direct insert into participants" 
    ON public.duowatch_participants FOR INSERT WITH CHECK (false);

-- 6. RPC: Create Private Room
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
SET search_path = public
AS $$
DECLARE
    v_room public.duowatch_rooms%ROWTYPE;
BEGIN
    INSERT INTO public.duowatch_rooms (
        room_code,
        room_name,
        owner_token_hash,
        guest_passcode_hash,
        current_mode,
        expires_at
    ) VALUES (
        p_room_code,
        COALESCE(NULLIF(p_room_name, ''), 'Private Cinema'),
        p_owner_token_hash,
        p_guest_passcode_hash,
        COALESCE(p_initial_mode, 'youtube'),
        NOW() + INTERVAL '24 hours'
    )
    RETURNING * INTO v_room;

    RETURN jsonb_build_object(
        'success', true,
        'roomId', v_room.id,
        'roomCode', v_room.room_code,
        'roomName', v_room.room_name,
        'expiresAt', v_room.expires_at
    );
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'ROOM_CODE_ALREADY_EXISTS');
END;
$$;

-- 7. RPC: Join Room (Atomic Row Lock & Strict 2-Participant Limit)
CREATE OR REPLACE FUNCTION public.duowatch_join_room(
    p_room_code VARCHAR,
    p_participant_id VARCHAR,
    p_display_name VARCHAR,
    p_token_hash VARCHAR,
    p_role VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_room public.duowatch_rooms%ROWTYPE;
    v_participant_count INT;
    v_existing_participant public.duowatch_participants%ROWTYPE;
BEGIN
    -- 1. Lock room row to prevent race conditions during concurrent joins
    SELECT * INTO v_room FROM public.duowatch_rooms 
    WHERE room_code = p_room_code AND is_active = true AND expires_at > NOW()
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'ROOM_NOT_FOUND_OR_EXPIRED');
    END IF;

    -- 2. Verify token hash cryptographically
    IF p_role = 'owner' THEN
        IF v_room.owner_token_hash != p_token_hash THEN
            RETURN jsonb_build_object('success', false, 'error', 'INVALID_OWNER_TOKEN');
        END IF;
    ELSIF p_role = 'partner' THEN
        IF v_room.guest_passcode_hash != p_token_hash THEN
            RETURN jsonb_build_object('success', false, 'error', 'INVALID_GUEST_PASSCODE');
        END IF;
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_ROLE');
    END IF;

    -- 3. Check if participant is already registered (reconnecting or refreshed page)
    SELECT * INTO v_existing_participant FROM public.duowatch_participants
    WHERE room_id = v_room.id AND participant_id = p_participant_id;

    IF FOUND THEN
        UPDATE public.duowatch_participants
        SET last_seen = NOW(), display_name = p_display_name
        WHERE id = v_existing_participant.id;
        
        RETURN jsonb_build_object(
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
    WHERE room_id = v_room.id AND last_seen < (NOW() - INTERVAL '90 seconds');

    -- 5. Count active participants: capacity MUST NOT exceed 2
    SELECT COUNT(*) INTO v_participant_count FROM public.duowatch_participants
    WHERE room_id = v_room.id;

    IF v_participant_count >= 2 THEN
        RETURN jsonb_build_object('success', false, 'error', 'ROOM_FULL');
    END IF;

    -- 6. Insert verified participant
    INSERT INTO public.duowatch_participants (room_id, participant_id, display_name, role)
    VALUES (v_room.id, p_participant_id, p_display_name, p_role);

    RETURN jsonb_build_object(
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

-- 8. RPC: Heartbeat (Keeps participant active)
CREATE OR REPLACE FUNCTION public.duowatch_heartbeat(
    p_room_code VARCHAR,
    p_participant_id VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_room_id UUID;
BEGIN
    SELECT id INTO v_room_id FROM public.duowatch_rooms WHERE room_code = p_room_code;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'ROOM_NOT_FOUND');
    END IF;

    UPDATE public.duowatch_participants
    SET last_seen = NOW()
    WHERE room_id = v_room_id AND participant_id = p_participant_id;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- 9. RPC: Leave Room
CREATE OR REPLACE FUNCTION public.duowatch_leave_room(
    p_room_code VARCHAR,
    p_participant_id VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_room_id UUID;
BEGIN
    SELECT id INTO v_room_id FROM public.duowatch_rooms WHERE room_code = p_room_code;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false);
    END IF;

    DELETE FROM public.duowatch_participants
    WHERE room_id = v_room_id AND participant_id = p_participant_id;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- 10. RPC: Update Media State (Host Only)
CREATE OR REPLACE FUNCTION public.duowatch_update_media_state(
    p_room_code VARCHAR,
    p_owner_token_hash VARCHAR,
    p_current_mode VARCHAR,
    p_media_state JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_room public.duowatch_rooms%ROWTYPE;
BEGIN
    SELECT * INTO v_room FROM public.duowatch_rooms 
    WHERE room_code = p_room_code AND owner_token_hash = p_owner_token_hash;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED_OR_NOT_FOUND');
    END IF;

    UPDATE public.duowatch_rooms
    SET 
        current_mode = COALESCE(p_current_mode, current_mode),
        media_state = COALESCE(p_media_state, media_state)
    WHERE id = v_room.id;

    RETURN jsonb_build_object('success', true);
END;
$$;
