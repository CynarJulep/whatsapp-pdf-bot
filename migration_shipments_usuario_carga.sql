-- Usuario de carga extraído del PDF (sección Historia)
ALTER TABLE public.shipments
    ADD COLUMN IF NOT EXISTS usuario_carga TEXT;
