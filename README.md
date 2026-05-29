---
title: Whatsapp Pdf Sender
emoji: 💬
colorFrom: indigo
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# Guía de Inicialización y Despliegue: WhatsApp PDF Office Automation (Hugging Face Spaces)

Este sistema permite a operadores de oficina subir archivos PDF a una interfaz web (Netlify) y enviarlos de manera automatizada a través de WhatsApp Business, persistiendo la sesión de conexión de forma permanente en Supabase (PostgreSQL) y procesando las solicitudes en un backend Docker gratuito corriendo 24/7 en **Hugging Face Spaces**.

---

## 🛠️ Requisitos Previos

Necesitarás cuentas gratuitas en:
1. **Supabase** (Base de datos y Storage)
2. **Hugging Face** (Alojamiento del backend Node.js mediante Docker)
3. **Netlify** o cualquier hosting estático (Alojamiento de la interfaz frontend)
4. **UptimeRobot** (Para evitar que el backend entre en hibernación)
5. Un teléfono con **WhatsApp Business** para realizar el enlace inicial por código QR.

---

## 📋 Pasos de Despliegue

### Paso 1: Configurar Supabase

1. Crea un proyecto nuevo en **Supabase**.
2. Dirígete a la sección **SQL Editor** y ejecuta la totalidad del contenido del archivo [schema.sql](schema.sql). Esto creará:
   - Las tablas `baileys_creds` y `baileys_keys` para persistencia de la sesión de WhatsApp.
   - El bucket de almacenamiento público `pdfs` con las políticas RLS correspondientes para permitir subidas y descargas directas desde el navegador.
3. Ve a la sección **Project Settings** > **API** y copia los siguientes valores:
   - **Project URL** (ej. `https://xxx.supabase.co`)
   - **`anon` `public` key** (Llave anónima pública)
   - **`service_role` key** (Llave secreta de servicio - **¡Guárdala con seguridad, no la expongas en el frontend!**)

---

### Paso 2: Crear el Space en Hugging Face

1. Inicia sesión en [Hugging Face](https://huggingface.co/) y haz clic en tu perfil (arriba a la derecha) > **New Space**.
2. Configura los siguientes campos:
   - **Space Name**: Elige un nombre (ej. `whatsapp-pdf-sender`).
   - **License**: `mit` (u otra de tu preferencia).
   - **SDK**: Selecciona **Docker**.
   - **Docker Template**: Selecciona **Blank**.
   - **Space Hardware**: Selecciona la opción gratuita (**CPU basic • 2 vCPU • 16 GB RAM • Free**).
   - **Visibility**: Puedes ponerlo en **Public** o **Private**. (Si es privado, igualmente podrás acceder a su API pública para el webhook).
3. Haz clic en **Create Space**.

---

### Paso 3: Configurar las Variables de Entorno (Secrets)

1. En la página de tu Space recién creado, ve a la pestaña **Settings** (Ajustes).
2. Haz scroll hasta la sección **Variables and Secrets** y haz clic en **New Secret**.
3. Añade las siguientes variables:
   - `SUPABASE_URL` = (Tu Project URL de Supabase)
   - `SUPABASE_SERVICE_ROLE_KEY` = (Tu llave secreta `service_role` de Supabase)
   - `SESSION_ID` = `pai` (Identificador único de sesión)

---

### Paso 4: Subir los Archivos al Space

Puedes clonar el repositorio Git que te proporciona Hugging Face y subir los archivos, o subirlos directamente desde el navegador:

1. En tu Space, ve a la pestaña **Files and versions** y haz clic en **Add file** > **Upload files**.
2. Sube los siguientes archivos de tu proyecto local:
   - [Dockerfile](Dockerfile)
   - [index.js](index.js)
   - [package.json](package.json)
3. Escribe un mensaje para el commit y haz clic en **Commit changes to main**.
4. Hugging Face comenzará a compilar el contenedor automáticamente. Esto tardará alrededor de 1-2 minutos.

---

### Paso 5: Vinculación Inicial del Código QR

1. Una vez terminada la compilación, dirígete a la pestaña **Logs** (o **Container Logs**) en el panel de Hugging Face.
2. Verás el código QR renderizado directamente en los logs de la consola.
3. Toma tu celular con **WhatsApp Business**, ve a **Dispositivos Vinculados** > **Vincular un dispositivo** y escanea el código QR de los logs.
4. Tras unos segundos, los logs indicarán: `[WhatsApp] Connection established successfully!`.
5. Los tokens de autenticación se habrán guardado automáticamente en tu base de datos de Supabase.

---

### Paso 6: Obtener la URL de tu Backend

La URL pública para acceder a tu contenedor de Hugging Face Spaces tiene la siguiente estructura:
`https://<tu-usuario-de-huggingface>-<nombre-del-space>.hf.space`

*(Por ejemplo: si tu usuario es `pedro` y tu Space se llama `whatsapp-pdf-sender`, tu URL será `https://pedro-whatsapp-pdf-sender.hf.space`)*

Puedes verificar que funcione abriendo en tu navegador:
`https://<tu-usuario-de-huggingface>-<nombre-del-space>.hf.space/status`
Debería devolverte un JSON indicando: `{"success":true,"connected":true,...}`.

---

### Paso 7: Configurar UptimeRobot (Evitar Hibernación)

Hugging Face apaga los Spaces gratuitos si no reciben visitas en 48 horas. Para que tu bot corra **24/7 sin interrupciones**, utilizaremos un monitor de pings gratuito:

1. Regístrate en [UptimeRobot](https://uptimerobot.com/) (cuenta 100% gratuita).
2. Haz clic en **Add New Monitor**.
3. Configura el monitor:
   - **Monitor Type**: `HTTPS`
   - **Friendly Name**: `WhatsApp Bot Ping`
   - **URL (or IP)**: `https://<tu-usuario-de-huggingface>-<nombre-del-space>.hf.space/status`
   - **Monitoring Interval**: Cada `5 minutos`.
4. Guarda el monitor. Esto enviará una petición a tu backend constantemente manteniéndolo despierto y activo de forma permanente gratis.

---

### Paso 8: Desplegar el Frontend en Netlify

1. Abre el archivo [index.html](index.html).
2. Dirígete a la etiqueta `<script>` y reemplaza los marcadores de posición con tus credenciales públicas:
   ```javascript
   const SUPABASE_URL = "https://tu-proyecto.supabase.co";
   const SUPABASE_ANON_KEY = "tu-llave-publica-anon";
   const RAILWAY_URL = "https://tu-usuario-de-huggingface-nombre-del-space.hf.space"; 
   ```
   > [!NOTE]
   > Nota: En `index.html` la variable se llama `RAILWAY_URL` para mantener compatibilidad con el código, pero debes colocar allí tu URL de Hugging Face (`https://...hf.space`).
3. Sube el archivo `index.html` a un nuevo sitio en **Netlify** (arrastrándolo a Netlify Drop).
4. También puedes abrir el link de Netlify agregando parámetros de consulta para no editar el código:
   `https://tu-sitio.netlify.app/?supabase_url=URL&supabase_anon_key=KEY&railway_url=URL_HF_SPACE`

---

## 🚀 Prueba de Funcionamiento

1. Ingresa a tu URL del frontend en Netlify.
2. En la parte superior derecha deberías ver el indicador en verde: **WhatsApp Conectado**.
3. Ingresa el número telefónico en formato internacional (ej. `5491122334455` para Argentina).
4. Arrastra o selecciona tu archivo PDF.
5. Haz clic en **Enviar por WhatsApp**.
6. El panel subirá el PDF a Supabase Storage y seguidamente disparará el webhook hacia Hugging Face. El destinatario recibirá el PDF al instante.
