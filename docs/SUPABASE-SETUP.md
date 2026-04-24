# Supabase Storage Setup

## Error: "new row violates row-level security policy"

This means the anon key doesn't have permission to write to Supabase Storage.
Fix by using the **service role key** (bypasses RLS entirely) or by adding an RLS policy.

---

## Option A — Service Role Key (recommended)

1. Go to your Supabase project → **Settings → API**
2. Copy the **service_role** key (under "Project API keys")
3. Add to `.env.local`:

```
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

The export route already prefers `SUPABASE_SERVICE_ROLE_KEY` over the anon key — no code changes needed.

> **Warning:** Never expose the service role key to the browser. It is only used server-side in `/api/supabase/export`.

---

## Option B — RLS Policy on the bucket

If you want to keep using the anon key, add an insert policy to your storage bucket.

1. Go to **Storage → Policies** in your Supabase dashboard
2. Select the `generated-images` bucket (create it first if it doesn't exist)
3. Add a new policy:
   - **Allowed operation:** INSERT
   - **Policy definition:** `true` (allows all inserts, or restrict by `auth.role() = 'anon'`)

---

## Create the bucket

If the bucket doesn't exist yet:

1. Go to **Storage** in your Supabase dashboard
2. Click **New bucket**
3. Name it `generated-images`
4. Set to **Public** if you want public image URLs (recommended for this app)

---

## .env.local reference

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # add this to fix RLS errors
```
