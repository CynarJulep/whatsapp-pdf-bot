-- Persistencia de sesión Playwright SAC (cookies/storage) fuera del disco efímero.
CREATE TABLE IF NOT EXISTS public.sac_session_state (
    id TEXT PRIMARY KEY DEFAULT 'default',
    state JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.sac_session_state ENABLE ROW LEVEL SECURITY;

-- Sin políticas públicas: solo service_role (backend) puede leer/escribir.
