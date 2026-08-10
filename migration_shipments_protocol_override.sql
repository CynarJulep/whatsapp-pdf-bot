-- Marca envíos confirmados con "Sí, enviar igual" durante protocolo activo
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS protocol_override BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.shipments.protocol_override IS
  'True cuando se derivó confirmando "Sí, enviar igual" con protocolo activo (no exceptuados).';
