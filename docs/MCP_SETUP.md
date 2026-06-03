# MCP en Cursor (este proyecto)

## Render

1. Creá una API key en [Render → Account Settings → API Keys](https://dashboard.render.com/settings#api-keys).
2. Definí la variable de entorno en Windows (PowerShell, sesión actual):

```powershell
$env:RENDER_API_KEY = "rnd_xxxxxxxx"
```

Para dejarla permanente (usuario):

```powershell
[System.Environment]::SetEnvironmentVariable("RENDER_API_KEY", "rnd_xxxxxxxx", "User")
```

3. Copiá la plantilla si no tenés el archivo local:

```powershell
Copy-Item .cursor\mcp.json.example .cursor\mcp.json
```

4. Reiniciá Cursor (o recargá MCP en **Settings → Tools & MCP**).

El backend de este proyecto en Render suele ser: `whatsapp-pdf-bot-backend`.

## Supabase

- URL del MCP: `https://mcp.supabase.com/mcp`
- En Cursor, conectá el servidor **supabase** con OAuth desde **Settings → Tools & MCP** (botón Connect).
- Proyecto PAI: `hltyozdvcqfmvqmyrlva`
