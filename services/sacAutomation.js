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

async function openClaimDetail(page, numeroReclamo, anio) {
  const claimRegex = buildClaimRegex(numeroReclamo, anio);
  const directClaimLink = page.locator('a', { hasText: claimRegex }).first();

  if (await directClaimLink.count()) {
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: SAC_TIMEOUT_MS }).catch(() => null),
      directClaimLink.click()
    ]);
    return;
  }

  const fallbackLink = page.locator('a[href*="/solicitud/ver.do"]').first();
  if (await fallbackLink.count()) {
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: SAC_TIMEOUT_MS }).catch(() => null),
      fallbackLink.click()
    ]);
    return;
  }

  throw new Error(`No se encontró el reclamo ${numeroReclamo}/${anio} en los resultados de búsqueda`);
}

async function triggerPdfDownload({ page, context, numeroReclamo, timeoutMs }) {
  const printButton = page.locator('input[type="button"][value="Imprimir"], button:has-text("Imprimir")').first();
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
    const locator = page.locator(selector).first();
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

  const hrefCandidates = await page.$$eval('a[href]', (anchors) =>
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

  const browser = await playwright.chromium.launch({
    headless: SAC_HEADLESS,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const contextOptions = {
      acceptDownloads: true,
      viewport: { width: 1440, height: 900 }
    };

    if (await fileExists(SAC_SESSION_STATE_PATH)) {
      contextOptions.storageState = SAC_SESSION_STATE_PATH;
      console.log('[SAC] Reutilizando sesión guardada localmente.');
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    page.setDefaultTimeout(SAC_TIMEOUT_MS);

    await ensureLoggedIn(page, context, usuario, contrasena);

    const numeroInput = await waitForFirst(page, [
      'input[name="nroSolicitud"]',
      'input[name="numeroSolicitud"]',
      'input[name="numero"]',
      'input[id*="solicitud"]',
      'input[name*="solicitud"]'
    ]);

    const anioInput = await waitForFirst(page, [
      'select[name="anioSolicitud"]',
      'input[name="anio"]',
      'select[name="anio"]',
      'input[id*="anio"]',
      'select[id*="anio"]'
    ]);

    await maybeFill(numeroInput, numeroReclamo);

    const anioTag = await anioInput.evaluate((el) => el.tagName.toLowerCase());
    if (anioTag === 'select') {
      await anioInput.selectOption(String(anio));
    } else {
      await maybeFill(anioInput, anio);
    }

    const buscarButton = await waitForFirst(page, [
      'input[type="button"][value*="Buscar"]',
      'button:has-text("Buscar")',
      'input[name="buscar"]'
    ]);

    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: SAC_TIMEOUT_MS }).catch(() => null),
      buscarButton.click()
    ]);

    await openClaimDetail(page, numeroReclamo, anio);

    const { pdfBuffer, suggestedFileName } = await triggerPdfDownload({
      page,
      context,
      numeroReclamo,
      timeoutMs: SAC_TIMEOUT_MS
    });

    await saveSessionState(context);

    return {
      pdfBuffer,
      suggestedFileName: sanitizeFileName(suggestedFileName) || `${numeroReclamo}_${anio}.pdf`
    };
  } finally {
    await browser.close();
  }
}

module.exports = {
  runSacSingleClaimFetch
};
