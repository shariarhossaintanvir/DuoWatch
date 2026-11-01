# Supabase Setup Guide & Database Migrations

DuoWatch uses **Supabase Free Tier** ($0/month) for ephemeral room state, cryptographic authorization, and real-time WebRTC signaling.

## 1. Create a Free Supabase Project

1. Visit [supabase.com](https://supabase.com) and click **Start your project** (Free plan, no credit card required).
2. Enter your project name (e.g. `DuoWatch`).
3. Set a strong database password.
4. Choose the region closest to you and your partner.
5. Click **Create new project**.

---

## 2. Apply Database Migrations & Security Policies

1. In your Supabase project dashboard, navigate to the **SQL Editor** from the left sidebar.
2. Click **New Query**.
3. Open `supabase/migrations/20261101_init_duowatch.sql` from this repository.
4. Paste the entire SQL content into the SQL Editor and click **Run**.

### What this script creates:
- `public.duowatch_rooms`: Room metadata, cryptographic token hashes, current mode, and timestamps.
- `public.duowatch_participants`: Ephemeral active participant tracker.
- **Row Level Security (RLS)**:
  - Disallows direct client `INSERT`, `UPDATE`, and `DELETE` on room tables.
  - Allows public reading only by specific, active `room_code`.
- **Atomic Join Function (`duowatch_join_room`)**:
  - Uses `SELECT ... FOR UPDATE` row locking to prevent concurrent join race conditions.
  - Purges inactive participants (> 90 seconds without heartbeat).
  - Enforces capacity: strictly maximum 2 participants allowed. If active count >= 2, rejects with `ROOM_FULL`.
- **Host Authoritative Update Function (`duowatch_update_media_state`)**:
  - Validates that only requests matching `owner_token_hash` can update movie mode or playback state.

---

## 3. Enable Realtime Publications

In the SQL Editor, execute the following to ensure Supabase Realtime broadcasts table events:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.duowatch_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.duowatch_participants;
```

---

## 4. Obtain Your Public API Credentials

1. In your Supabase dashboard, click **Project Settings** (gear icon) > **API**.
2. Locate the following values:
   - **Project URL**: (e.g. `https://abcdefghijkl.supabase.co`)
   - **Project API Keys**: Copy the **`anon` (public)** key.
3. Add these to your `.env` file or Cloudflare Pages environment variables:
   ```env
   VITE_SUPABASE_URL=https://abcdefghijkl.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsIn...
   ```

> ⚠️ **CRITICAL SECURITY WARNING:**  
> **NEVER copy or use the `service_role` (secret) key.** DuoWatch is designed so that the client strictly uses the `anon` public key, with all mutations secured by Postgres `SECURITY DEFINER` procedures.
