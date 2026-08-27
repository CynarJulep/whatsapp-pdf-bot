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

const P = 'margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111111;';

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

/**
 * HTML = mismo texto que el mail plano, sin tablas ni “hoja/tarjeta”.
 */
function buildClaimEmailHtml(info = {}) {
    return textToSimpleHtml(buildClaimEmailText(info));
}

function wrapEmailHtml(inner) {
    return [
        '<!DOCTYPE html>',
        '<html lang="es"><head><meta charset="utf-8"></head>',
        '<body style="margin:0;padding:0;">',
        inner,
        '</body></html>',
    ].join('');
}

function formatPlainLineToHtml(line) {
    const trimmed = line.trimEnd();
    if (!trimmed) {
        return `<p style="${P}">&nbsp;</p>`;
    }

    const labelMatch = trimmed.match(/^(Solicitud Nro|Subtipo|Ubicaci[oó]n):\s*(.+)$/i);
    if (labelMatch) {
        return `<p style="${P}"><strong>${escapeHtml(labelMatch[1])}:</strong> ${escapeHtml(labelMatch[2])}</p>`;
    }

    if (/^Atentamente,?$/i.test(trimmed)) {
        return `<p style="margin:18px 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111111;">${escapeHtml(trimmed)}</p>`;
    }

    if (/^Atención Ciudadana$/i.test(trimmed)) {
        return `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111111;"><strong>${escapeHtml(trimmed)}</strong></p>`;
    }

    if (/^Municipalidad de Santa Fe$/i.test(trimmed)) {
        return `<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111111;">${escapeHtml(trimmed)}</p>`;
    }

    if (/^Por favor no conteste/i.test(trimmed)) {
        return `<p style="margin:8px 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#333333;"><em>${escapeHtml(trimmed)}</em></p>`;
    }

    if (/^https:\/\/www\.santafeciudad\.gov\.ar\/?$/i.test(trimmed)) {
        return `<p style="${P}"><a href="https://www.santafeciudad.gov.ar/" style="color:#0645AD;">https://www.santafeciudad.gov.ar/</a></p>`;
    }

    if (/^0800\s*777\s*5000$/i.test(trimmed)) {
        return `<p style="${P}"><a href="tel:08007775000" style="color:#111111;text-decoration:none;">${escapeHtml(trimmed)}</a></p>`;
    }

    return `<p style="${P}">${escapeHtml(trimmed)}</p>`;
}

function textToSimpleHtml(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    return wrapEmailHtml(lines.map(formatPlainLineToHtml).join('\n'));
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
