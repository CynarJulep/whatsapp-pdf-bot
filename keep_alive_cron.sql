-- Habilitar las extensiones necesarias en la base de datos de Supabase.
-- pg_net permite realizar solicitudes HTTP asincrónicas desde Postgres.
-- pg_cron permite programar tareas en segundo plano.
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Eliminar el cron job existente por si acaso se ejecuta de nuevo este script
SELECT cron.unschedule('keep-alive-render-whatsapp');

-- Programar la tarea para llamar al endpoint de estado de Render cada 10 minutos.
-- Esto mantendrá la instancia encendida previniendo que se apague después de 15 minutos de inactividad.
SELECT cron.schedule(
    'keep-alive-render-whatsapp',
    '*/10 * * * *', -- Cada 10 minutos
    $$ SELECT net.http_get('https://whatsapp-pdf-bot-backend.onrender.com/status') $$
);
