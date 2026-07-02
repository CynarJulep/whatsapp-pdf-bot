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

async function saveSessionState(context) {
  const sessionDir = path.dirname(SAC_SESSION_STATE_PATH);
  await fs.mkdir(sessionDir, { recursive: true });
  await context.storageState({ path: SAC_SESSION_STATE_PATH });
}

async function waitForFirst(page, selectors, timeout = 15000) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout });
      return locator;
    } catch (_) {
      // Try next selector
    }
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
  for (const scope of scopes) {
    for (const selector of selectors) {
      try {
        const locator = scope.locator(selector).first();
        await locator.waitFor({ state: 'visible', timeout });
        return { locator, scope, selector };
      } catch (_) {
        // Try next selector/scope
      }
    }
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

async function ensureLoggedIn(page, context, usuario, contrasena) {
  await page.goto(SAC_SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: SAC_TIMEOUT_MS });

  if (!(await isLoginPage(page))) {
    return;
  }

  console.log('[SAC] Sesión expirada o inexistente. Iniciando login...');
  await performLogin(page, usuario, contrasena);
  await saveSessionState(context);
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

async function openClaimDetail(scope, numeroReclamo, anio) {
  const activePage = typeof scope.page === 'function' ? scope.page() : scope;
  const claimRegex = buildClaimRegex(numeroReclamo, anio);
  const directClaimLink = scope.locator('a', { hasText: claimRegex }).first();

  if (await directClaimLink.count()) {
    await Promise.all([
      activePage.waitForLoadState('domcontentloaded', { timeout: SAC_TIMEOUT_MS }).catch(() => null),
      directClaimLink.click()
    ]);
    return;
  }

  const fallbackLink = scope.locator('a[href*="/solicitud/ver.do"]').first();
  if (await fallbackLink.count()) {
    await Promise.all([
      activePage.waitForLoadState('domcontentloaded', { timeout: SAC_TIMEOUT_MS }).catch(() => null),
      fallbackLink.click()
    ]);
    return;
  }

  throw new Error(`No se encontró el reclamo ${numeroReclamo}/${anio} en los resultados de búsqueda`);
}

async function triggerPdfDownload({ page, scope, context, numeroReclamo, timeoutMs }) {
  const printButton = scope.locator('input[type="button"][value="Imprimir"], button:has-text("Imprimir")').first();
  if (await printButton.count()) {
    try {
      const popupPromise = page.waitForEvent('popup', { timeout: 12000 }).catch(() => null);
      const downloadPromise = page.waitForEvent('download', { timeout: timeoutMs });
      await printButton.click({ timeout: 5000 });
      const download = await downloadPromise;
      const popup = await popupPromise;
      if (popup) {
        await popup.close().catch(() => null);
      }
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
    'button:has-text("Imprimir")',
    'a:has-text("Imprimir")'
  ];

  for (const selector of pdfTriggerSelectors) {
    const locator = scope.locator(selector).first();
    const count = await locator.count();
    if (!count) continue;

    try {
      const downloadPromise = page.waitForEvent('download', { timeout: timeoutMs });
      await locator.click({ timeout: 5000 });
      const download = await downloadPromise;
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

async function runSacSingleClaimFetch({ numeroReclamo, anio, usuario, contrasena }) {
  if (!usuario || !contrasena) {
    throw new Error('Faltan credenciales SAC_USER / SAC_PASSWORD en variables de entorno');
  }

  let playwright;
  try {
    playwright = require('playwright');
  } catch (_) {
    throw new Error('No se encontró Playwright instalado en el servidor');
  }

  const MAX_ATTEMPTS = 2;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const browser = await playwright.chromium.launch({
      headless: SAC_HEADLESS,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });

    try {
      const contextOptions = {
        acceptDownloads: true,
        viewport: { width: 1440, height: 900 }
      };

      if (attempt === 1 && await fileExists(SAC_SESSION_STATE_PATH)) {
        contextOptions.storageState = SAC_SESSION_STATE_PATH;
        console.log('[SAC] Reutilizando sesión guardada localmente.');
      }

      const context = await browser.newContext(contextOptions);
      const page = await context.newPage();
      page.setDefaultTimeout(SAC_TIMEOUT_MS);

      await ensureLoggedIn(page, context, usuario, contrasena);

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
        form = await resolveSearchForm();
      } catch (firstError) {
        console.warn(`[SAC] No se pudo detectar el formulario de búsqueda al primer intento: ${firstError.message}`);
        console.warn('[SAC] Reintentando con login forzado y refresco completo de sesión...');
        await performLogin(page, usuario, contrasena);
        await saveSessionState(context);
        await page.goto(SAC_SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: SAC_TIMEOUT_MS });
        await page.waitForLoadState('networkidle', { timeout: SAC_TIMEOUT_MS }).catch(() => null);
        form = await resolveSearchForm();
      }

      const { numeroInput, anioInput, buscarButton, activeScope } = form;

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

      await Promise.all([
        page.waitForLoadState('networkidle', { timeout: SAC_TIMEOUT_MS }).catch(() => null),
        buscarButton.click()
      ]);

      await openClaimDetail(activeScope, numeroReclamo, anio);

      const { pdfBuffer, suggestedFileName } = await triggerPdfDownload({
        page,
        scope: activeScope,
        context,
        numeroReclamo,
        timeoutMs: SAC_TIMEOUT_MS
      });

      await saveSessionState(context);

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
