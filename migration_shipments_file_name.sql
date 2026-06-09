-- Agrega nombre de archivo al historial de envíos
ALTER TABLE public.shipments
    ADD COLUMN IF NOT EXISTS file_name TEXT;
