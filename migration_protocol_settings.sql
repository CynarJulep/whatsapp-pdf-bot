-- Protocolo global PAI (singleton)
-- Activación compartida entre todos los clientes + Realtime

CREATE TABLE IF NOT EXISTS public.protocol_settings (
    id UUID PRIMARY KEY DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
    active BOOLEAN NOT NULL DEFAULT FALSE,
    title TEXT NOT NULL DEFAULT 'PROTOCOLO ACTIVADO',
    subtitle TEXT NOT NULL DEFAULT 'Actuación Municipal ante Emergencias por Lluvias',
    restrictions JSONB NOT NULL DEFAULT '[]'::jsonb,
    info_text TEXT NOT NULL DEFAULT '',
    exempt_subtypes TEXT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT protocol_settings_singleton CHECK (id = '00000000-0000-4000-8000-000000000001'::uuid)
);

-- Una sola fila
INSERT INTO public.protocol_settings (
    id,
    active,
    title,
    subtitle,
    restrictions,
    info_text,
    exempt_subtypes
) VALUES (
    '00000000-0000-4000-8000-000000000001'::uuid,
    FALSE,
    'PROTOCOLO ACTIVADO',
    'Actuación Municipal ante Emergencias por Lluvias',
    '[
      "NO SE DERIVAN POR PAI LOS RECLAMOS. (Solo derivar a tránsito y cuidacoches)",
      "Si se comunica alguien por un reclamo realizado previamente a la activación del protocolo, se debe generar un nuevo reclamo haciendo referencia al número original y a la cantidad de reiteraciones.",
      "Estas reglas aplican a los subtipos correspondientes a las derivaciones por PAI."
    ]'::jsonb,
    'Los reclamos ingresados a través del SAC (Sistema de Atención Ciudadana) serán tratados DIRECTAMENTE por el área de Riesgo.',
    ARRAY['CUIDACOCHES']
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.protocol_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read of protocol_settings" ON public.protocol_settings;
CREATE POLICY "Allow public read of protocol_settings"
ON public.protocol_settings FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Allow public update of protocol_settings" ON public.protocol_settings;
CREATE POLICY "Allow public update of protocol_settings"
ON public.protocol_settings FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Insert no hace falta en uso normal (singleton seed), pero por si se recrea
DROP POLICY IF EXISTS "Allow public insert of protocol_settings" ON public.protocol_settings;
CREATE POLICY "Allow public insert of protocol_settings"
ON public.protocol_settings FOR INSERT
TO anon, authenticated
WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.protocol_settings TO anon, authenticated;

-- Realtime: agregar a la publication si no está
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'protocol_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.protocol_settings;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.touch_protocol_settings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protocol_settings_updated_at ON public.protocol_settings;
CREATE TRIGGER protocol_settings_updated_at
BEFORE UPDATE ON public.protocol_settings
FOR EACH ROW
EXECUTE FUNCTION public.touch_protocol_settings_updated_at();
