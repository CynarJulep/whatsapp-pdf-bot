import fs from 'fs';
import path from 'path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: npm run test:pdf -- <path-to-pdf>');
  process.exit(1);
}

const USUARIO_CARGA_SKIP = new Set([
  'fecha', 'hora', 'estado', 'derivado', 'derivar', 'operacion', 'operación', 'operacionn', 'recibido',
  'pagina', 'página', 'sistema', 'municipalidad', 'santa',
]);

function looksLikeUsuarioCarga(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return /^[a-z][a-z0-9._-]{2,32}$/i.test(trimmed) && !USUARIO_CARGA_SKIP.has(trimmed.toLowerCase());
}

function extractPageText(content) {
  const items = content.items
    .filter((it) => it.str?.trim())
    .map((it) => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5] }));
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  let currentLine = [], lastY = null;
  for (const item of items) {
    if (lastY !== null && Math.abs(item.y - lastY) > 4) {
      if (currentLine.length) lines.push(currentLine.sort((a, b) => a.x - b.x).map((it) => it.str).join(' '));
      currentLine = [];
    }
    currentLine.push(item);
    lastY = item.y;
  }
  if (currentLine.length) lines.push(currentLine.sort((a, b) => a.x - b.x).map((it) => it.str).join(' '));
  return lines.join('\n');
}

function extractUsuarioCarga(fullText) {
  if (!fullText) return null;
  const historiaIdx = fullText.search(/\bHistoria\b/i);
  const historiaText = historiaIdx >= 0 ? fullText.slice(historiaIdx, historiaIdx + 2000) : fullText;
  const normalized = historiaText.replace(/\s+/g, ' ');
  const derivarMatches = [...normalized.matchAll(/\bDerivar\s+Derivado\s+([a-zA-Z][a-zA-Z0-9._-]{2,32})\s+\d{2}\/\d{2}\/\d{4}/g)];
  for (const match of derivarMatches) {
    if (looksLikeUsuarioCarga(match[1])) return match[1].toLowerCase();
  }
  return null;
}

const data = new Uint8Array(fs.readFileSync(path.resolve(pdfPath)));
const pdf = await getDocument({ data, useSystemFonts: true }).promise;
let fullText = '';
for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);
  fullText += extractPageText(await page.getTextContent()) + '\n';
}

const solicitudMatch = fullText.match(/Solicitud\s+Nro[:\s.]*([0-9\-]+)/i);
const subtipoMatch = fullText.match(/Subtipo[:\s\-]+([\s\S]+?)(?=(?:Descripci[oó]n|Fecha|Ubicaci[oó]n|Estado|Usuario|Prioridad|Origen|Solicitud|Tipo)[:\-]\s+|$)/i);
const usuarioCarga = extractUsuarioCarga(fullText);

console.log(JSON.stringify({
  solicitudNro: solicitudMatch?.[1]?.trim() ?? null,
  subtipo: subtipoMatch?.[1]?.trim() ?? null,
  usuarioCarga,
}, null, 2));

if (!usuarioCarga) {
  console.error('\nERROR: no se detectó usuario de carga');
  process.exit(1);
}

console.log('\nOK: usuario de carga detectado ->', usuarioCarga);
