# Design

## Color Strategy

**Restrained** — tinted neutrals + un acento institucional. Es una herramienta de trabajo, no una página de marketing. El color lleva la identidad; el fondo es puro.

## Palette

```css
/* Light mode */
--color-bg:         oklch(1.000 0.000 0);         /* pure white */
--color-surface:    oklch(0.975 0.004 230);        /* muy leve tinte azul-institucional */
--color-ink:        oklch(0.18 0.010 230);         /* casi negro, leve tinte azul */
--color-muted:      oklch(0.52 0.010 230);         /* texto secundario, ≥4.5:1 vs bg */
--color-primary:    oklch(0.38 0.090 230);         /* azul institucional oscuro */
--color-accent:     oklch(0.58 0.120 160);         /* verde semáforo — confirmación/éxito */
--color-border:     oklch(0.88 0.006 230);

/* Dark mode */
--color-bg-dark:       oklch(0.10 0.010 230);      /* near-black, tinte azul */
--color-surface-dark:  oklch(0.15 0.012 230);
--color-ink-dark:      oklch(0.96 0.000 0);
--color-muted-dark:    oklch(0.62 0.008 230);
--color-primary-dark:  oklch(0.65 0.130 230);      /* azul más brillante en dark */
--color-accent-dark:   oklch(0.68 0.130 160);
--color-border-dark:   oklch(1 0 0 / 0.08);
```

## Typography

- **Font family**: Inter (Google Fonts) — legible, neutral, institucional
- **Scale ratio**: 1.25 (Major Third)
- **Base size**: 16px
- **Heading weights**: 700–800
- **Body weight**: 400–500
- **Mono**: system-ui monospace para teléfonos y códigos

| Role | Size | Weight | Use |
|---|---|---|---|
| hero | clamp(2.5rem, 5vw, 4rem) | 900 | Título principal "DERIVACIONES" |
| h1 | 1.953rem | 800 | Títulos de sección |
| h2 | 1.563rem | 700 | Card headers |
| body | 1rem | 400 | Contenido general |
| small | 0.8rem | 500 | Labels, badges |
| micro | 0.7rem | 600 uppercase | Eyebrows (solo 1 por pantalla) |

## Components

### Wizard Steps
- 2 pasos: drop zone → preview+pick
- Step indicator: dots + línea de progreso, sin números
- Animación: fadeSlideUp, 350ms, ease-out-quart

### Drop Zone
- Borde dashed 2px `--color-border` → `--color-primary` en hover/drag
- Ícono de upload grande centralizado
- Sin texto decorativo, solo instrucción de acción

### PDF Preview
- `<embed>` nativo del browser (sin librería)
- Panel izquierdo del split 50/50 en desktop
- Header con nombre de archivo y botón de quitar

### Contact Picker
- Lista scrolleable con Checkbox + Avatar (iniciales) + nombre + descripción
- Máximo 3 seleccionables
- Contacto auto-detectado destacado con badge "Auto" en ámbar

### Contact Cards (tab Contactos)
- Sin borde en rest, borde `--color-border` en hover
- Acciones (editar/borrar) ocultas hasta hover del grupo
- Toggle de activo/inactivo con Switch nativo de shadcn

### Buttons
- Primary: `--color-primary` fill, texto blanco, sin sombra
- Enviar: gradiente indigo→violet, h-12, font-bold
- Ghost: sin fondo en rest
- Sin border-radius > 12px en cards; 8px en inputs; full pill para badges/tags

## Layout

- Max-width principal: 6xl (72rem) para la pantalla split; 2xl (42rem) para tabs simples
- Spacing rítmico: 4/8/12/16/24/32/48/64px
- Header sticky con blur backdrop
- Footer simple, una línea

## Motion

- `ease-out-quart`: cubic-bezier(0.25, 1, 0.5, 1)
- Duraciones: 250ms interacciones, 350ms transiciones de vista
- `@media (prefers-reduced-motion: reduce)`: sin transform/opacity animations, solo crossfade
- Sin bounce, sin elastic

## Anti-patterns activos

- Sin gradient text (background-clip: text)
- Sin glassmorphism decorativo
- Sin border-radius > 16px en cards
- Sin eyebrows uppercase en cada sección
- Sin métricas hero con números grandes y gradientes
