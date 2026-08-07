const fs = require('fs/promises');
const path = require('path');

const SAC_LOGIN_URL = process.env.SAC_LOGIN_URL || 'https://sac.santafeciudad.gov.ar/sac/inicio.do?accion=ir';
const SAC_SEARCH_URL = process.env.SAC_SEARCH_URL || 'https://sac.santafeciudad.gov.ar/sac/solicitud/busqueda.do?accion=ir&nivel=nivel3';
const SAC_HEADLESS = process.env.SAC_HEADLESS !== 'false';
const SAC_TIMEOUT_MS = Number(process.env.SAC_TIMEOUT_MS || 60000);
const SAC_SESSION_STATE_PATH = process.env.SAC_SESSION_STATE_PATH
  || path.join(__dirname, '..', '.sac-session', 'storage-state.json');

function sanitizeFileName(value) {
  return String(value || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function saveSessionState(context, remoteSave) {
  const sessionDir = path.dirname(SAC_SESSION_STATE_PATH);
  await fs.mkdir(sessionDir, { recursive: true });
  await context.storageState({ path: SAC_SESSION_STATE_PATH });
  if (typeof remoteSave === 'function') {
    try {
      const raw = await fs.readFile(SAC_SESSION_STATE_PATH, 'utf8');
      await remoteSave(JSON.parse(raw));
    } catch (err) {
      console.warn('[SAC] No se pudo persistir la sesión remota:', err.message || err);
    }
  }
}

async function prepareLocalSessionState(remoteLoad) {
  if (await fileExists(SAC_SESSION_STATE_PATH)) return true;
  if (typeof remoteLoad !== 'function') return false;
  try {
    const state = await remoteLoad();
    if (!state || typeof state !== 'object') return false;
    const sessionDir = path.dirname(SAC_SESSION_STATE_PATH);
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(SAC_SESSION_STATE_PATH, JSON.stringify(state), 'utf8');
    console.log('[SAC] Sesión remota restaurada en disco local.');
    return true;
  } catch (err) {
    console.warn('[SAC] No se pudo restaurar la sesión remota:', err.message || err);
    return false;
  }
}

async function waitForFirst(page, selectors, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      try {
        const locator = page.locator(selector).first();
        if (await locator.count() && await locator.isVisible()) {
          return locator;
        }
      } catch (_) {
        // Frame/page may be navigating; retry all selectors until the global deadline.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No se encontró ningún selector válido: ${selectors.join(', ')}`);
}

function getSearchScopes(page) {
  const main = page.mainFrame();
  const children = page.frames().filter((frame) => frame !== main);
  return [main, ...children];
}

function describeScope(scope) {
  try {
    return scope.url();
  } catch (_) {
    return '[scope-sin-url]';
  }
}

function buildDetailedSelectorError(selectors, scopes) {
  const scopeList = scopes.map((scope) => describeScope(scope)).join(' | ');
  return `No se encontró ningún selector válido: ${selectors.join(', ')}. Scopes inspeccionados: ${scopeList}`;
}

async function waitForFirstInScopes(scopes, selectors, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const scope of scopes) {
      for (const selector of selectors) {
        try {
          const locator = scope.locator(selector).first();
          if (await locator.count() && await locator.isVisible()) {
            return { locator, scope, selector };
          }
        } catch (_) {
          // A child frame may detach during navigation; retry all scopes.
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(buildDetailedSelectorError(selectors, scopes));
}

async function tryOpenSearchFromMenu(page, scopes) {
  for (const scope of scopes) {
    const menuLink = scope.locator('a', { hasText: /Buscar solicitud|Buscar reclamo|Solicitud/i }).first();
    const count = await menuLink.count();
    if (!count) continue;
    try {
      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => null),
        menuLink.click({ timeout: 4000 })
      ]);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);
      return true;
    } catch (_) {
      // try next scope/link
    }
  }
  return false;
}

function buildControlHaystack(meta) {
  return [
    meta.name,
    meta.id,
    meta.placeholder,
    meta.ariaLabel,
    meta.title,
    meta.labelsText,
    meta.closestText
  ].join(' ').toLowerCase();
}

async function findControlByHints(scopes, options) {
  const { selector, hints, tagConstraint = null } = options;
  const normalizedHints = hints.map((hint) => hint.toLowerCase());
  let best = null;

  for (const scope of scopes) {
    const controls = scope.locator(selector);
    const count = await controls.count();
    for (let i = 0; i < count; i += 1) {
      const locator = controls.nth(i);
      const meta = await locator.evaluate((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const isVisible = style.visibility !== 'hidden'
          && style.display !== 'none'
          && rect.width > 0
          && rect.height > 0;

        const labels = [];
        if (element.labels) {
          for (const label of Array.from(element.labels)) {
            labels.push((label.textContent || '').trim());
          }
        }

        if (element.id) {
          const forLabel = document.querySelector(`label[for="${element.id}"]`);
          if (forLabel) labels.push((forLabel.textContent || '').trim());
        }

        const closest = element.closest('tr, td, .form-group, .campo, .row, form, fieldset, div');
        return {
          tag: element.tagName.toLowerCase(),
          type: (element.getAttribute('type') || '').toLowerCase(),
          name: element.getAttribute('name') || '',
          id: element.id || '',
          placeholder: element.getAttribute('placeholder') || '',
          ariaLabel: element.getAttribute('aria-label') || '',
          title: element.getAttribute('title') || '',
          labelsText: labels.join(' '),
          closestText: (closest?.textContent || '').slice(0, 220),
          isVisible,
          disabled: !!element.disabled
        };
      });

      if (!meta.isVisible || meta.disabled) continue;
      if (meta.type === 'hidden') continue;
      if (tagConstraint && meta.tag !== tagConstraint) continue;

      const haystack = buildControlHaystack(meta);
      let score = 0;
      for (const hint of normalizedHints) {
        if (haystack.includes(hint)) score += 1;
      }

      if (score <= 0) continue;

      if (!best || score > best.score) {
        best = { locator, scope, score };
      }
    }
  }

  return best;
}

async function maybeFill(locator, value) {
  if (!locator) return;
  await locator.click({ timeout: 5000 });
  await locator.fill('');
  await locator.fill(String(value));
}

async function isLoginPage(page) {
  const passCount = await page.locator('input[name="contrasenia"], input[type="password"]').count();
  const userCount = await page.locator('input[name="usuario"], input#usuario').count();
  return passCount > 0 && userCount > 0;
}

async function assertNoHeadlessCloudflareChallenge(page) {
  if (!SAC_HEADLESS) return;
  const challengeFrame = page.frames().some((frame) =>
    /challenges\.cloudflare\.com|turnstile/i.test(frame.url())
  );
  if (!challengeFrame) return;

  throw new Error(
    'Cloudflare Turnstile bloqueó la automatización desde Render. '
    + 'Ejecutá el worker SAC local con SAC_HEADLESS=false.'
  );
}

async function performLogin(page, usuario, contrasena) {
  await page.goto(SAC_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: SAC_TIMEOUT_MS });

  // En ciertos estados SAC redirige al inicio aun llamando a login.do.
  // Si ya hay sesión activa, no forzamos un login interactivo.
  if (!(await isLoginPage(page))) {
    console.log('[SAC] La pantalla de login no está visible, se asume sesión activa.');
    return;
  }

  const usuarioInput = await waitForFirst(page, [
    'input[name="usuario"]',
    'input#usuario',
    'input[type="text"]'
  ]);
  const passInput = await waitForFirst(page, [
    'input[name="contrasenia"]',
    'input#contrasenia',
    'input[type="password"]'
  ]);

  await maybeFill(usuarioInput, usuario);
  await maybeFill(passInput, contrasena);

  const loginButton = await waitForFirst(page, [
    'input[name="ingresar"]',
    'input[type="submit"]',
    'button:has-text("Ingresar")'
  ]);

  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: SAC_TIMEOUT_MS }).catch(() => null),
    loginButton.click()
  ]);
}

async function ensureLoggedIn(page, context, usuario, contrasena, remoteSave) {
  await page.goto(SAC_SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: SAC_TIMEOUT_MS });

  if (!(await isLoginPage(page))) {
    return;
  }

  if (!usuario || !contrasena) {
    if (SAC_HEADLESS) {
      throw new Error(
        'La sesión SAC expiró. Configurá SAC_USER y SAC_PASSWORD en el worker local.'
      );
    }

    console.log('[SAC] Sesión expirada. Completá el login manual en la ventana de Chromium (5 min).');
    const manualLoginDeadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < manualLoginDeadline && await isLoginPage(page)) {
      await page.waitForTimeout(1000);
    }
    if (await isLoginPage(page)) {
      throw new Error('Tiempo agotado esperando el login manual en SAC.');
    }
    await saveSessionState(context, remoteSave);
    await page.goto(SAC_SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: SAC_TIMEOUT_MS });
    return;
  }

  console.log('[SAC] Sesión expirada o inexistente. Iniciando login...');
  await performLogin(page, usuario, contrasena);
  await saveSessionState(context, remoteSave);
  await page.goto(SAC_SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: SAC_TIMEOUT_MS });

  if (await isLoginPage(page)) {
    throw new Error('No se pudo iniciar sesión en SAC con las credenciales configuradas');
  }
}

function buildClaimRegex(numeroReclamo, anio) {
  const numero = String(numeroReclamo || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const year = String(anio || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${numero}\\s*[-/]\\s*${year}`);
}

async function openClaimDetail(scopeOrScopes, numeroReclamo, anio) {
  const scopes = Array.isArray(scopeOrScopes) ? scopeOrScopes : [scopeOrScopes];
  const claimRegex = buildClaimRegex(numeroReclamo, anio);

  for (const scope of scopes) {
    try {
      const activePage = typeof scope.page === 'function' ? scope.page() : scope;
      const directClaimLink = scope.locator('a', { hasText: claimRegex }).first();

      if (await directClaimLink.count()) {
        await Promise.all([
          activePage.waitForLoadState('domcontentloaded', { timeout: SAC_TIMEOUT_MS }).catch(() => null),
          directClaimLink.click()
        ]);
        return activePage;
      }

      const fallbackLink = scope.locator('a[href*="/solicitud/ver.do"]').first();
      if (await fallbackLink.count()) {
        await Promise.all([
          activePage.waitForLoadState('domcontentloaded', { timeout: SAC_TIMEOUT_MS }).catch(() => null),
          fallbackLink.click()
        ]);
        return activePage;
      }
    } catch (_) {
      // A search page may close while SAC replaces it with the result window.
    }
  }

  throw new Error(`No se encontró el reclamo ${numeroReclamo}/${anio} en los resultados de búsqueda`);
}

async function triggerPdfDownload({ page, scope, context, numeroReclamo, timeoutMs }) {
  const downloadWaitMs = Math.min(timeoutMs, 8000);
  const detailUrl = page.url();

  // SAC exposes the same detail URL with accion=imprimir. Fetching it through
  // the authenticated browser context avoids two UI waits when it returns PDF.
  if (/\/solicitud\/ver\.do/i.test(detailUrl)) {
    try {
      const printUrl = new URL(detailUrl);
      printUrl.searchParams.set('accion', 'imprimir');
      printUrl.searchParams.set('incluirDatosComplementarios', 'false');
      const response = await context.request.get(printUrl.toString(), {
        timeout: Math.min(timeoutMs, 15000)
      });
      if (response.ok()) {
        const contentType = response.headers()['content-type'] || '';
        const buffer = Buffer.from(await response.body());
        const isPdf = contentType.toLowerCase().includes('pdf')
          || buffer.subarray(0, 5).toString('ascii') === '%PDF-';
        if (isPdf && buffer.length > 1000) {
          return { pdfBuffer: buffer, suggestedFileName: `${numeroReclamo}.pdf` };
        }
      }
    } catch (_) {
      // Continue with browser-driven download fallbacks.
    }
  }

  const printButton = scope.locator('input[type="button"][value="Imprimir"], button:has-text("Imprimir")').first();
  if (await printButton.count()) {
    try {
      const popupPromise = page.waitForEvent('popup', { timeout: downloadWaitMs }).catch(() => null);
      const downloadPromise = page.waitForEvent('download', { timeout: downloadWaitMs }).catch(() => null);
      await printButton.click({ timeout: 5000 });
      const download = await downloadPromise;
      if (!download) throw new Error('El botón Imprimir no disparó una descarga directa');
      void popupPromise.then((popup) => popup?.close().catch(() => null));
      const diskPath = await download.path();
      if (diskPath) {
        const buffer = await fs.readFile(diskPath);
        const suggestedFileName = download.suggestedFilename() || `${numeroReclamo}.pdf`;
        return { pdfBuffer: buffer, suggestedFileName };
      }
    } catch (_) {
      // Fallback to generic selectors below.
    }
  }

  const pdfTriggerSelectors = [
    'input[type="button"][value*="PDF"]',
    'input[type="button"][onclick*="PDF"]',
    'button:has-text("PDF")',
    'a:has-text("PDF")',
    'a[href*="pdf"]',
    'a[href*="imprimir"]',
    'a:has-text("Imprimir")'
  ];

  for (const selector of pdfTriggerSelectors) {
    const locator = scope.locator(selector).first();
    const count = await locator.count();
    if (!count) continue;

    try {
      const downloadPromise = page.waitForEvent('download', { timeout: downloadWaitMs }).catch(() => null);
      await locator.click({ timeout: 5000 });
      const download = await downloadPromise;
      if (!download) continue;
      const diskPath = await download.path();
      if (!diskPath) continue;
      const buffer = await fs.readFile(diskPath);
      const suggestedFileName = download.suggestedFilename() || `${numeroReclamo}.pdf`;
      return { pdfBuffer: buffer, suggestedFileName };
    } catch (_) {
      // Maybe this selector opens another tab or just navigates.
    }
  }

  const hrefCandidates = await scope.$$eval('a[href]', (anchors) =>
    anchors
      .map((anchor) => anchor.getAttribute('href') || '')
      .filter((href) => href && /(pdf|imprimir|certificado)/i.test(href))
      .slice(0, 12)
  );

  for (const href of hrefCandidates) {
    try {
      const absoluteUrl = new URL(href, page.url()).toString();
      const response = await context.request.get(absoluteUrl, { timeout: timeoutMs });
      if (!response.ok()) continue;
      const contentType = response.headers()['content-type'] || '';
      const buffer = await response.body();
      if (!contentType.toLowerCase().includes('pdf') && !buffer?.length) continue;
      const suggestedFileName = `${numeroReclamo}.pdf`;
      return { pdfBuffer: Buffer.from(buffer), suggestedFileName };
    } catch (_) {
      // Try next link.
    }
  }

  throw new Error('No se pudo descargar el PDF del reclamo en SAC');
}

async function runSacSingleClaimFetch({
  numeroReclamo,
  anio,
  usuario,
  contrasena,
  loadSessionState,
  saveSessionState: remoteSaveSessionState
} = {}) {
  let playwright;
  try {
    playwright = require('playwright');
  } catch (_) {
    throw new Error('No se encontró Playwright instalado en el servidor. Ejecutá: npm i playwright && npx playwright install chromium');
  }

  const MAX_ATTEMPTS = 2;
  let lastError = null;
  const startedAt = Date.now();
  console.log(`[SAC] Inicio descarga reclamo ${numeroReclamo}/${anio}`);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // Free Render = 512MB. Do not use its aggressive single-process flags locally:
    // they make headed Chromium unstable during SAC form navigation on Windows.
    const lowMemoryCloud = process.env.RENDER === 'true' || process.env.SAC_LOW_MEMORY === 'true';
    const chromiumArgs = lowMemoryCloud
      ? [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--disable-default-apps',
          '--disable-sync',
          '--disable-translate',
          '--hide-scrollbars',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-first-run',
          '--no-default-browser-check',
          '--safebrowsing-disable-auto-update',
          '--font-render-hinting=none',
          '--single-process',
          '--js-flags=--max-old-space-size=128'
        ]
      : ['--disable-dev-shm-usage'];

    const browser = await playwright.chromium.launch({
      headless: SAC_HEADLESS,
      args: chromiumArgs
    });

    try {
      const contextOptions = {
        acceptDownloads: true,
        viewport: { width: 1024, height: 720 },
        reducedMotion: 'reduce'
      };

      const hasLocalSession = attempt === 1 && await prepareLocalSessionState(loadSessionState);
      if (hasLocalSession && await fileExists(SAC_SESSION_STATE_PATH)) {
        contextOptions.storageState = SAC_SESSION_STATE_PATH;
        console.log('[SAC] Reutilizando sesión guardada.');
      }

      const context = await browser.newContext(contextOptions);
      let page = await context.newPage();
      page.setDefaultTimeout(SAC_TIMEOUT_MS);

      console.log(`[SAC] Etapa login (${numeroReclamo}/${anio})`);
      await ensureLoggedIn(page, context, usuario, contrasena, remoteSaveSessionState);
      await assertNoHeadlessCloudflareChallenge(page);
      console.log(`[SAC] Login/sesión OK (${numeroReclamo}/${anio})`);

      const resolveSearchForm = async () => {
        const scopes = getSearchScopes(page);
        let activeScope = page.mainFrame();

        let numeroInput;
        try {
          const foundNumero = await waitForFirstInScopes(scopes, [
            'input[name="nroSolicitud"]',
            'input[name="numeroSolicitud"]',
            'input[name="numero"]',
            'input[name*="solicitud"]',
            'input[id*="solicitud"]',
            'input[name*="reclamo"]',
            'input[id*="reclamo"]'
          ], 25000);
          numeroInput = foundNumero.locator;
          activeScope = foundNumero.scope;
        } catch (_) {
          const guessedNumero = await findControlByHints(scopes, {
            selector: 'input, textarea',
            hints: ['solicitud', 'reclamo', 'numero', 'nro']
          });
          if (!guessedNumero) {
            const openedFromMenu = await tryOpenSearchFromMenu(page, scopes);
            if (openedFromMenu) {
              const refreshedScopes = getSearchScopes(page);
              const retryNumero = await findControlByHints(refreshedScopes, {
                selector: 'input, textarea',
                hints: ['solicitud', 'reclamo', 'numero', 'nro']
              });
              if (retryNumero) {
                numeroInput = retryNumero.locator;
                activeScope = retryNumero.scope;
                console.log(`[SAC] Campo número detectado tras navegar desde menú en scope: ${describeScope(activeScope)}`);
              }
            }
          }
          if (!numeroInput) {
            throw new Error(buildDetailedSelectorError([
              'input[name="nroSolicitud"]',
              'input[name="numeroSolicitud"]',
              'input[name="numero"]',
              'input[name*="solicitud"]',
              'input[id*="solicitud"]',
              'input[name*="reclamo"]',
              'input[id*="reclamo"]'
            ], scopes));
          }
          if (guessedNumero) {
            numeroInput = guessedNumero.locator;
            activeScope = guessedNumero.scope;
            console.log(`[SAC] Campo número detectado por heurística en scope: ${describeScope(activeScope)}`);
          }
        }

        let anioInput;
        try {
          const foundAnio = await waitForFirst(activeScope, [
            'select[name="anioSolicitud"]',
            'input[name="anioSolicitud"]',
            'input[name="anio"]',
            'select[name="anio"]',
            'input[id*="anio"]',
            'select[id*="anio"]'
          ]);
          anioInput = foundAnio;
        } catch (_) {
          const guessedAnio = await findControlByHints([activeScope], {
            selector: 'select, input',
            hints: ['anio', 'año', 'ejercicio']
          });
          if (guessedAnio) {
            anioInput = guessedAnio.locator;
            console.log(`[SAC] Campo año detectado por heurística en scope: ${describeScope(activeScope)}`);
          }
        }

        let buscarButton;
        try {
          buscarButton = await waitForFirst(activeScope, [
            'input[type="button"][value*="Buscar"]',
            'input[type="submit"][value*="Buscar"]',
            'button:has-text("Buscar")',
            'input[name="buscar"]'
          ]);
        } catch (_) {
          const guessedButton = await findControlByHints([activeScope], {
            selector: 'button, input[type="button"], input[type="submit"]',
            hints: ['buscar', 'consultar', 'aceptar']
          });
          if (!guessedButton) {
            throw new Error(`No se pudo encontrar el botón de búsqueda en el formulario SAC (${describeScope(activeScope)})`);
          }
          buscarButton = guessedButton.locator;
          console.log('[SAC] Botón de búsqueda detectado por heurística.');
        }

        return { numeroInput, anioInput, buscarButton, activeScope };
      };

      let form;
      try {
        console.log(`[SAC] Etapa detectar formulario (${numeroReclamo}/${anio})`);
        form = await resolveSearchForm();
      } catch (firstError) {
        console.warn(`[SAC] No se pudo detectar el formulario de búsqueda al primer intento: ${firstError.message}`);
        console.warn('[SAC] Reintentando con login forzado y refresco completo de sesión...');
        await performLogin(page, usuario, contrasena);
        await saveSessionState(context, remoteSaveSessionState);
        await page.goto(SAC_SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: SAC_TIMEOUT_MS });
        await page.waitForLoadState('networkidle', { timeout: SAC_TIMEOUT_MS }).catch(() => null);
        form = await resolveSearchForm();
      }

      const { numeroInput, anioInput, buscarButton } = form;
      console.log(`[SAC] Formulario detectado (${numeroReclamo}/${anio})`);

      await maybeFill(numeroInput, numeroReclamo);

      if (anioInput) {
        const anioTag = await anioInput.evaluate((el) => el.tagName.toLowerCase());
        if (anioTag === 'select') {
          await anioInput.selectOption(String(anio));
        } else {
          await maybeFill(anioInput, anio);
        }
      } else {
        console.warn('[SAC] No se detectó campo de año. Se continúa con valor por defecto del formulario.');
      }

      const replacementPagePromise = context.waitForEvent('page', { timeout: 1500 }).catch(() => null);
      await buscarButton.click();
      const replacementPage = await replacementPagePromise;
      if (replacementPage) {
        await replacementPage.waitForLoadState('domcontentloaded', { timeout: SAC_TIMEOUT_MS }).catch(() => null);
      }
      if (page.isClosed() || replacementPage) {
        page = replacementPage || context.pages().filter((candidate) => !candidate.isClosed()).at(-1);
      }
      if (!page || page.isClosed()) {
        throw new Error('SAC cerró la ventana de búsqueda sin abrir una ventana de resultados');
      }
      await page.waitForLoadState('networkidle', { timeout: SAC_TIMEOUT_MS }).catch(() => null);

      console.log(`[SAC] Búsqueda enviada; abriendo resultado (${numeroReclamo}/${anio})`);
      const detailPage = await openClaimDetail(getSearchScopes(page), numeroReclamo, anio);

      console.log(`[SAC] Resultado abierto; descargando PDF (${numeroReclamo}/${anio})`);
      const { pdfBuffer, suggestedFileName } = await triggerPdfDownload({
        page: detailPage,
        scope: detailPage.mainFrame(),
        context,
        numeroReclamo,
        timeoutMs: SAC_TIMEOUT_MS
      });

      await saveSessionState(context, remoteSaveSessionState);

      const elapsedMs = Date.now() - startedAt;
      console.log(`[SAC] Reclamo ${numeroReclamo}/${anio} listo en ${elapsedMs}ms (${Math.round((pdfBuffer?.length || 0) / 1024)} KB)`);

      return {
        pdfBuffer,
        suggestedFileName: sanitizeFileName(suggestedFileName) || `${numeroReclamo}_${anio}.pdf`
      };
    } catch (error) {
      lastError = error;
      const message = String(error?.message || '');
      const isTransientBrowserClose = /Target page, context or browser has been closed|page has been closed|browser has been closed/i.test(message);

      if (isTransientBrowserClose && attempt < MAX_ATTEMPTS) {
        console.warn(`[SAC] Intento ${attempt} falló por cierre inesperado del navegador. Reintentando desde cero...`);
      } else {
        console.error(`[SAC] Fallo descarga ${numeroReclamo}/${anio}:`, message);
        throw error;
      }
    } finally {
      await browser.close().catch(() => null);
    }
  }

  throw lastError || new Error('No se pudo completar la búsqueda SAC');
}

module.exports = {
  runSacSingleClaimFetch
};
