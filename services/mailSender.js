/**
 * Envío de reclamos por SMTP (Zimbra municipal / informes@).
 * Credenciales: SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS / SMTP_FROM
 */
const nodemailer = require('nodemailer');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_FOOTER_LINES = [
    'Por favor no conteste a este correo. Comuníquese al:',
    '0800 777 5000',
    '',
    'Presencialmente en Salta 2951, Santa Fe',
    '',
    'Por chat en nuestro sitio web:',
    'https://www.santafeciudad.gov.ar/',
];

function isValidEmail(value) {
    return EMAIL_RE.test(String(value || '').trim());
}

function isSmtpConfigured() {
    return Boolean(
        process.env.SMTP_HOST &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASS
    );
}

function getTransporter() {
    if (!isSmtpConfigured()) {
        throw new Error('SMTP no configurado (faltan SMTP_HOST / SMTP_USER / SMTP_PASS).');
    }
    const port = Number(process.env.SMTP_PORT || 465);
    const secure = process.env.SMTP_SECURE !== 'false';
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
        tls: { rejectUnauthorized: false },
        connectionTimeout: 20000,
        greetingTimeout: 20000,
    });
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Normaliza campos del PDF para el cuerpo del mail. */
function normalizeClaimFields(info = {}) {
    const clean = (value) => String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
    return {
        solicitudNro: clean(info.solicitudNro) || 'No especificado',
        subtipo: clean(info.subtipo).toUpperCase() || 'No especificado',
        ubicacion: clean(info.ubicacion) || 'No especificada',
        hasClaimData: Boolean(clean(info.solicitudNro) || clean(info.subtipo) || clean(info.ubicacion)),
    };
}

function signatureText() {
    return [
        'Atentamente,',
        '',
        'Atención Ciudadana',
        'Municipalidad de Santa Fe',
    ].join('\n');
}

/**
 * Plantilla institucional (texto plano).
 * Solo: intro + Solicitud / Subtipo / Ubicación.
 */
function buildClaimEmailText(info = {}) {
    const fields = normalizeClaimFields(info);
    if (!fields.hasClaimData) {
        return [
            'Se remite el documento adjunto para su conocimiento.',
            '',
            signatureText(),
            '',
            ...CONTACT_FOOTER_LINES,
        ].join('\n');
    }
    return [
        'Se remite el siguiente reclamo para su conocimiento.',
        '',
        `Solicitud Nro: ${fields.solicitudNro}`,
        '',
        `Subtipo: ${fields.subtipo}`,
        '',
        `Ubicación: ${fields.ubicacion}`,
        '',
        signatureText(),
        '',
        ...CONTACT_FOOTER_LINES,
    ].join('\n');
}

function buildClaimEmailSubject(info = {}) {
    const fields = normalizeClaimFields(info);
    const nro = fields.solicitudNro === 'No especificado' ? 'sin número' : fields.solicitudNro;
    const sub = fields.subtipo && fields.subtipo !== 'No especificado'
        ? ` (${fields.subtipo})`
        : '';
    return `Solicitud ${nro}${sub}`;
}

function linkifyEscaped(escaped) {
    return escaped
        .replace(
            /https?:\/\/[^\s<]+/g,
            (url) => `<a href="${url}" style="color:#003b73;text-decoration:underline;">${url}</a>`
        )
        .replace(
            /\b(0800\s*777\s*5000)\b/g,
            '<a href="tel:08007775000" style="color:#003b73;text-decoration:none;font-weight:700;">$1</a>'
        );
}

function formatPlainLineToHtml(line) {
    const trimmed = line.trimEnd();
    if (!trimmed) return '<div style="height:10px;line-height:10px;font-size:10px;">&nbsp;</div>';

    const labelMatch = trimmed.match(/^(Solicitud Nro|Subtipo|Ubicaci[oó]n):\s*(.+)$/i);
    if (labelMatch) {
        const label = escapeHtml(labelMatch[1]);
        const value = linkifyEscaped(escapeHtml(labelMatch[2]));
        return `<p style="margin:0 0 12px;line-height:1.55;"><strong style="color:#0f172a;">${label}:</strong> <span style="color:#1e293b;">${value}</span></p>`;
    }

    if (/^Atentamente,?$/i.test(trimmed)) {
        return `<p style="margin:22px 0 6px;line-height:1.5;color:#334155;">${escapeHtml(trimmed)}</p>`;
    }

    if (/^Atención Ciudadana$/i.test(trimmed)) {
        return `<p style="margin:0;line-height:1.45;font-weight:700;color:#0f172a;font-size:15px;">${escapeHtml(trimmed)}</p>`;
    }

    if (/^Municipalidad de Santa Fe$/i.test(trimmed)) {
        return `<p style="margin:0 0 18px;line-height:1.45;color:#475569;">${escapeHtml(trimmed)}</p>`;
    }

    if (/^Por favor no conteste/i.test(trimmed)) {
        return `<p style="margin:8px 0 10px;line-height:1.55;color:#334155;"><em>${linkifyEscaped(escapeHtml(trimmed))}</em></p>`;
    }

    if (/^Por chat en nuestro/i.test(trimmed) || /^Presencialmente/i.test(trimmed)) {
        return `<p style="margin:0 0 8px;line-height:1.55;color:#334155;">${linkifyEscaped(escapeHtml(trimmed))}</p>`;
    }

    if (/^https?:\/\//i.test(trimmed) || /^0800\s/i.test(trimmed)) {
        return `<p style="margin:0 0 12px;line-height:1.55;">${linkifyEscaped(escapeHtml(trimmed))}</p>`;
    }

    if (/^Se remite /i.test(trimmed)) {
        return `<p style="margin:0 0 18px;line-height:1.65;font-size:15px;color:#1e293b;">${escapeHtml(trimmed)}</p>`;
    }

    return `<p style="margin:0 0 10px;line-height:1.55;color:#1e293b;">${linkifyEscaped(escapeHtml(trimmed))}</p>`;
}

/**
 * HTML institucional: intro + grilla Solicitud/Subtipo/Ubicación + firma + canales.
 */
function buildClaimEmailHtml(info = {}) {
    const fields = normalizeClaimFields(info);

    const fieldCell = (label, value) => (
        `<td style="width:50%;padding:0 18px 14px 0;vertical-align:top;">
          <div style="font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;font-weight:600;margin:0 0 4px;">${escapeHtml(label)}</div>
          <div style="font-size:14px;line-height:1.45;color:#0f172a;font-weight:600;">${escapeHtml(value)}</div>
        </td>`
    );

    const claimBlock = !fields.hasClaimData
        ? '<p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:#1e293b;">Se remite el documento adjunto para su conocimiento.</p>'
        : [
            '<p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#1e293b;">Se remite el siguiente reclamo para su conocimiento.</p>',
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;margin:0 0 8px;">',
            '<tr>',
            fieldCell('Solicitud Nro', fields.solicitudNro),
            fieldCell('Subtipo', fields.subtipo),
            '</tr>',
            '<tr>',
            `<td colspan="2" style="padding:0 0 4px 0;vertical-align:top;">
              <div style="font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;font-weight:600;margin:0 0 4px;">Ubicación</div>
              <div style="font-size:14px;line-height:1.45;color:#0f172a;font-weight:600;">${escapeHtml(fields.ubicacion)}</div>
            </td>`,
            '</tr>',
            '</table>',
        ].join('\n');

    return wrapEmailHtml([
        claimBlock,
        '<p style="margin:28px 0 4px;font-size:14px;line-height:1.5;color:#334155;">Atentamente,</p>',
        '<p style="margin:0;font-size:14px;line-height:1.4;font-weight:700;color:#0f172a;">Atención Ciudadana</p>',
        '<p style="margin:0 0 24px;font-size:13px;line-height:1.4;color:#64748b;">Municipalidad de Santa Fe</p>',
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0;">',
        '<tr><td colspan="2" style="padding:16px 0 10px;font-size:12px;line-height:1.5;color:#64748b;font-style:italic;">Por favor no conteste a este correo. Comuníquese por alguno de estos canales:</td></tr>',
        '<tr>',
        '<td style="width:50%;padding:0 16px 8px 0;vertical-align:top;font-size:13px;line-height:1.55;color:#334155;">',
        '<strong style="color:#0f172a;">Teléfono</strong><br>',
        '<a href="tel:08007775000" style="color:#003b73;text-decoration:none;font-weight:600;">0800 777 5000</a>',
        '</td>',
        '<td style="width:50%;padding:0 0 8px 16px;vertical-align:top;font-size:13px;line-height:1.55;color:#334155;">',
        '<strong style="color:#0f172a;">Presencial</strong><br>',
        'Salta 2951, Santa Fe',
        '</td>',
        '</tr>',
        '<tr>',
        '<td colspan="2" style="padding:8px 0 0 0;vertical-align:top;font-size:13px;line-height:1.55;color:#334155;">',
        '<strong style="color:#0f172a;">Sitio web</strong><br>',
        '<a href="https://www.santafeciudad.gov.ar/" style="color:#003b73;text-decoration:underline;">santafeciudad.gov.ar</a>',
        '</td>',
        '</tr>',
        '</table>',
    ].join('\n'));
}

function wrapEmailHtml(inner) {
    return [
        '<!DOCTYPE html>',
        '<html lang="es">',
        '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
        '<body style="margin:0;padding:16px 12px;background:#ffffff;">',
        '<div style="font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;line-height:1.55;max-width:680px;">',
        inner,
        '</div>',
        '</body></html>',
    ].join('');
}

function textToSimpleHtml(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const body = lines.map(formatPlainLineToHtml).join('\n');
    return wrapEmailHtml(body);
}

/**
 * @param {{ to: string, subject: string, text: string, html?: string, pdfBuffer: Buffer, fileName: string }} opts
 */
async function sendClaimEmail(opts) {
    const to = String(opts.to || '').trim();
    if (!isValidEmail(to)) {
        throw new Error('Dirección de correo inválida.');
    }
    if (!opts.pdfBuffer || !Buffer.isBuffer(opts.pdfBuffer)) {
        throw new Error('Falta el PDF adjunto.');
    }
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    const subject = opts.subject || 'Solicitud';
    const text = opts.text || '';
    const html = opts.html || textToSimpleHtml(text);
    const fileName = opts.fileName || 'reclamo.pdf';

    const transporter = getTransporter();
    const info = await transporter.sendMail({
        from: `"Atención Ciudadana" <${from}>`,
        to,
        subject,
        text,
        html,
        attachments: [
            {
                filename: fileName,
                content: opts.pdfBuffer,
                contentType: 'application/pdf',
            },
        ],
    });

    return {
        messageId: info.messageId || null,
        response: info.response || null,
    };
}

module.exports = {
    isValidEmail,
    isSmtpConfigured,
    normalizeClaimFields,
    buildClaimEmailText,
    buildClaimEmailHtml,
    buildClaimEmailSubject,
    textToSimpleHtml,
    sendClaimEmail,
};
