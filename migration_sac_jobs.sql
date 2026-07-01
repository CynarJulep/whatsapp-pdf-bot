CREATE TABLE IF NOT EXISTS public.sac_jobs (
    id TEXT PRIMARY KEY,
    numero_reclamo TEXT NOT NULL,
    anio INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed')),
    error_message TEXT,
    storage_path TEXT,
    file_name TEXT,
    public_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    finished_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_sac_jobs_lookup ON public.sac_jobs (numero_reclamo, anio, status);
CREATE INDEX IF NOT EXISTS idx_sac_jobs_created ON public.sac_jobs (created_at DESC);

ALTER TABLE public.sac_jobs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'sac_jobs'
          AND policyname = 'Allow public read of sac_jobs'
    ) THEN
        CREATE POLICY "Allow public read of sac_jobs"
        ON public.sac_jobs FOR SELECT
        TO anon, authenticated
        USING (true);
    END IF;
END $$;
