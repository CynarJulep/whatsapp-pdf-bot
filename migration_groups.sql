-- ==========================================
-- MIGRATION: WhatsApp Groups Support
-- ==========================================

-- 1. Nueva tabla para grupos de WhatsApp predefinidos
CREATE TABLE IF NOT EXISTS public.whatsapp_groups (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    group_jid TEXT UNIQUE NOT NULL,    -- Formato: "120363XXXXXXXXX@g.us"
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    subtypes TEXT[] DEFAULT '{}',      -- Subtipos para autoselección (igual que contacts)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable RLS
ALTER TABLE public.whatsapp_groups ENABLE ROW LEVEL SECURITY;

-- RLS Policies (iguales a contacts, acceso con anon key desde el frontend)
CREATE POLICY "Allow public read of whatsapp_groups"
ON public.whatsapp_groups FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "Allow public insert of whatsapp_groups"
ON public.whatsapp_groups FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "Allow public update of whatsapp_groups"
ON public.whatsapp_groups FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow public delete of whatsapp_groups"
ON public.whatsapp_groups FOR DELETE
TO anon, authenticated
USING (true);

-- 2. Agregar columnas a shipments para soportar envíos a grupos
ALTER TABLE public.shipments 
    ADD COLUMN IF NOT EXISTS is_group BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS group_jid TEXT;
