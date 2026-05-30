---
target: frontend/src/App.jsx
total_score: 30
p0_count: 0
p1_count: 1
timestamp: 2026-05-29T21-08-39Z
slug: frontend-src-app-jsx
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Solid status pills and upload progress, but no indicator for PDF load states. |
| 2 | Match System / Real World | 4 | Excellent match with municipal concepts ("Derivaciones", "Área destino"). |
| 3 | User Control and Freedom | 3 | Easy to cancel or go back, but no undo for contact status toggle. |
| 4 | Consistency and Standards | 3 | Cohesive components, but colors deviate from DESIGN.md palette tokens. |
| 5 | Error Prevention | 4 | Proactive maximum limit of 3 recipients prevents accidential bulk spamming. |
| 6 | Recognition Rather Than Recall | 4 | Auto-detected areas highlight matching contacts cleanly with "Auto" badges. |
| 7 | Flexibility and Efficiency | 2 | Lacks keyboard shortcuts for high-frequency municipal operators. |
| 8 | Aesthetic and Minimalist Design | 2 | Banned violet-indigo gradients and decorative bg styling leak through. |
| 9 | Error Recovery | 3 | Actionable toast errors. |
| 10 | Help and Documentation | 2 | No inline tooltips or help panel for new operators. |
| **Total** | | **30/40** | **Good** |

#### Anti-Patterns Verdict

**LLM assessment**: The interface structure is highly functional, but visually it leans on standard "SaaS tech startup" tropes: violet-indigo gradients, pill-shape rounded buttons, and a dark mode focus that doesn't fit the restrained, light-background institutional identity of the Municipalidad de Santa Fe defined in `DESIGN.md`.

**Deterministic scan**: Found 1 warning of `ai-color-palette` (purple/violet gradient button in `frontend/src/App.jsx` line 398).

**Visual overlays**: n/a (visual overlay was not run in page, CLI detector was used).

#### Overall Impression
The app has a very strong, highly-focused flow (drop PDF -> auto-select area -> send), but the visual execution relies on generic AI-boilerplate styling (purple gradients and tech-startup vibes) rather than the clean, restrained institutional blue/white palette defined in `DESIGN.md`.

#### What's Working
- **Auto-detection flow**: Reading PDF text to auto-highlight matching areas with the `Auto` badge minimizes user input.
- **Split layout preview**: Showing the PDF natively next to the recipient picker keeps the operator in the context of the document.

#### Priority Issues
- **[P1] AI color palette mismatch**: Banned `from-indigo-600 to-violet-600` gradient on primary send button.
  - *Why it matters*: Undermines the official institutional branding and makes the app feel like a generic SaaS template.
  - *Fix*: Replace with solid institutional blue primary styling matching the `--color-primary` palette.
  - *Suggested command*: `$impeccable colorize frontend/src/App.jsx`
- **[P2] Lack of keyboard shortcuts for power-users**:
  - *Why it matters*: Municipal operators doing hundreds of daily derivations will slow down using mouse-only clicks.
  - *Fix*: Add basic keyboard mapping (e.g. `Enter` to send, `Esc` to go back, numbers `1-3` to toggle top contacts).
  - *Suggested command*: `$impeccable adapt frontend/src/App.jsx`
- **[P2] Restrained/Institutional light theme alignment**:
  - *Why it matters*: The default dark theme is inappropriate for office desktop environments.
  - *Fix*: Set the default mode to light, matching the brand personality.
  - *Suggested command*: `$impeccable polish frontend/src/App.jsx`

#### Persona Red Flags

**Alex (Power User)**: Forced to click checkboxes manually for every file derivation. No keyboard shortcuts to quickly execute the submit button or reset. High efficiency bottleneck.

**Jordan (First-Timer)**: The wizard does a good job guiding them, but a lack of brief inline documentation/examples on how a PDF should look to trigger auto-detection could cause initial confusion.

#### Minor Observations
- Missing hover styles/feedback on the close `X` button on the PDF preview header.
- The font family relies on system defaults instead of explicitly rendering clean sans-serif spacing.
