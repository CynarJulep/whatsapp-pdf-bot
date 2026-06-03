// Script de migración para tabla whatsapp_groups
// Ejecutar con: node run_migration.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runMigration() {
  console.log('Ejecutando migración...');

  // 1. Crear tabla whatsapp_groups via RPC
  // Supabase no expone exec_sql directamente, así que usamos el endpoint de management API
  const fetch = global.fetch;
  
  const projectRef = process.env.SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  console.log(`Project ref: ${projectRef}`);

  // Verificar si la tabla existe insertando y haciendo select
  const { error: checkError } = await supabase.from('whatsapp_groups').select('id').limit(1);
  
  if (!checkError) {
    console.log('✓ La tabla whatsapp_groups ya existe');
  } else {
    console.log('La tabla no existe aún. Por favor ejecutá el siguiente SQL en el Dashboard de Supabase:');
    console.log(`
CREATE TABLE IF NOT EXISTS public.whatsapp_groups (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    group_jid TEXT UNIQUE NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    subtypes TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE public.whatsapp_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read of whatsapp_groups" ON public.whatsapp_groups FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow public insert of whatsapp_groups" ON public.whatsapp_groups FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow public update of whatsapp_groups" ON public.whatsapp_groups FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete of whatsapp_groups" ON public.whatsapp_groups FOR DELETE TO anon, authenticated USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_groups TO anon, authenticated;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS is_group BOOLEAN DEFAULT FALSE;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS group_jid TEXT;
    `);
  }

  // Verificar columnas en shipments
  const { error: shipErr } = await supabase.from('shipments').select('is_group').limit(1);
  if (!shipErr) {
    console.log('✓ Columnas is_group/group_jid ya existen en shipments');
  } else {
    console.log('⚠ Las columnas is_group/group_jid no existen en shipments. Agregalas manualmente.');
  }
}

runMigration().catch(console.error);
