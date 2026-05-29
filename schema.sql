-- ==========================================
-- SQL Schema for WhatsApp PDF Automation
-- Stack: Supabase + Baileys + Railway
-- ==========================================

-- 1. Table for storing credentials (creds)
CREATE TABLE IF NOT EXISTS public.baileys_creds (
    session_id TEXT PRIMARY KEY,
    creds JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable RLS for baileys_creds (Only accessible by backend via Service Role Key)
ALTER TABLE public.baileys_creds ENABLE ROW LEVEL SECURITY;

-- 2. Table for storing authentication keys (prekeys, sessions, etc.)
CREATE TABLE IF NOT EXISTS public.baileys_keys (
    session_id TEXT NOT NULL,
    key_type TEXT NOT NULL,
    key_id TEXT NOT NULL,
    data JSONB,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id, key_type, key_id)
);

-- Enable RLS for baileys_keys (Only accessible by backend via Service Role Key)
ALTER TABLE public.baileys_keys ENABLE ROW LEVEL SECURITY;

-- Add indexes for performance on lookups
CREATE INDEX IF NOT EXISTS idx_baileys_keys_lookup 
ON public.baileys_keys (session_id, key_type, key_id);

-- 3. Storage Bucket Configuration
-- Ensure the storage.buckets table has the 'pdfs' bucket configured.
-- This bucket is set to 'public: true' so files can be fetched easily if needed,
-- but the backend downloads them directly as buffers.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'pdfs', 
    'pdfs', 
    true, 
    52428800, -- 50MB limit
    ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE 
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 4. Row Level Security (RLS) Policies for Storage
-- We allow public uploads (INSERT) and downloads (SELECT) on the 'pdfs' bucket.
-- This allows the Netlify frontend to upload files directly using the anon key.

-- Policy to allow anonymous uploads (inserts) to the 'pdfs' bucket
CREATE POLICY "Allow public uploads to pdfs"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'pdfs');

-- Policy to allow anonymous downloads (selects) from the 'pdfs' bucket
CREATE POLICY "Allow public downloads from pdfs"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'pdfs');

-- Policy to allow anonymous updates/overwrites in case the same file is uploaded again
CREATE POLICY "Allow public updates to pdfs"
ON storage.objects FOR UPDATE
TO anon, authenticated
USING (bucket_id = 'pdfs')
WITH CHECK (bucket_id = 'pdfs');

-- Policy to allow deletion if needed (optional, but good to have for cleanup)
CREATE POLICY "Allow public deletes from pdfs"
ON storage.objects FOR DELETE
TO anon, authenticated
USING (bucket_id = 'pdfs');

-- 5. Contacts Table for manual targeting selection
CREATE TABLE IF NOT EXISTS public.contacts (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone_number TEXT UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable RLS for contacts table
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

-- Add RLS Policies for public access (so frontend app can manage them using anon key)
CREATE POLICY "Allow public read of contacts"
ON public.contacts FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "Allow public insert of contacts"
ON public.contacts FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "Allow public update of contacts"
ON public.contacts FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow public delete of contacts"
ON public.contacts FOR DELETE
TO anon, authenticated
USING (true);

