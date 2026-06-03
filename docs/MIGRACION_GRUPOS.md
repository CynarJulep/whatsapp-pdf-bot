# Migración: grupos de WhatsApp

Antes de usar la pestaña **Grupos** en configuración, ejecutá el SQL en Supabase:

1. Abrí [Supabase Dashboard](https://supabase.com/dashboard) → proyecto **hltyozdvcqfmvqmyrlva**
2. **SQL Editor** → New query
3. Pegá y ejecutá el contenido de `migration_groups.sql` (o la sección 6 de `schema.sql`)

Verificación local:

```bash
node run_migration.js
```

Debería mostrar `✓ La tabla whatsapp_groups ya existe` y `✓ Columnas is_group/group_jid ya existen en shipments`.
