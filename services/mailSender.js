/**
 * Envío de reclamos por SMTP (Zimbra municipal / informes@).
 * Credenciales: SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS / SMTP_FROM
 */
const nodemailer = require('nodemailer');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

/**
 * Texto plano compacto (estilo mail normal).
 * Evita líneas vacías de más: Gmail oculta el pie tras “…” si hay mucho whitespace.
 */
function buildClaimEmailText(info = {}) {
    const fields = normalizeClaimFields(info);
    const head = fields.hasClaimData
        ? [
            'Se remite el siguiente reclamo para su conocimiento.',
            '',
            `Solicitud Nro: ${fields.solicitudNro}`,
            `Subtipo: ${fields.subtipo}`,
            `Ubicación: ${fields.ubicacion}`,
        ]
        : [
            'Se remite el documento adjunto para su conocimiento.',
        ];

    return [
        ...head,
        '',
        'Atentamente,',
        'Atención Ciudadana',
        'Municipalidad de Santa Fe',
        '',
        'Por favor no conteste a este correo. Comuníquese al:',
        '0800 777 5000',
        'Presencialmente en Salta 2951, Santa Fe',
        'Por chat en nuestro sitio web:',
        'https://www.santafeciudad.gov.ar/',
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

function buildClaimEmailHtml(info = {}) {
    return textToSimpleHtml(buildClaimEmailText(info));
}

/**
 * HTML compacto: un solo bloque con <br>, sin párrafos vacíos.
 * Así Gmail no “recorta” el mensaje tras puntos suspensivos.
 */
function textToSimpleHtml(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const parts = [];
    let pendingBlank = false;

    for (const raw of lines) {
        const trimmed = raw.trimEnd();
        if (!trimmed) {
            pendingBlank = parts.length > 0;
            continue;
        }

        if (parts.length) {
            parts.push('<br>');
            if (pendingBlank) parts.push('<br>');
        }
        pendingBlank = false;

        const labelMatch = trimmed.match(/^(Solicitud Nro|Subtipo|Ubicaci[oó]n):\s*(.+)$/i);
        if (labelMatch) {
            parts.push(`<strong>${escapeHtml(labelMatch[1])}:</strong> ${escapeHtml(labelMatch[2])}`);
        } else if (/^Atención Ciudadana$/i.test(trimmed)) {
            parts.push(`<strong>${escapeHtml(trimmed)}</strong>`);
        } else if (/^https:\/\/www\.santafeciudad\.gov\.ar\/?$/i.test(trimmed)) {
            parts.push('<a href="https://www.santafeciudad.gov.ar/" style="color:#0645AD;">https://www.santafeciudad.gov.ar/</a>');
        } else if (/^0800\s*777\s*5000$/i.test(trimmed)) {
            parts.push(`<a href="tel:08007775000" style="color:#111111;text-decoration:none;">${escapeHtml(trimmed)}</a>`);
        } else if (/^Por favor no conteste/i.test(trimmed)) {
            parts.push(`<em>${escapeHtml(trimmed)}</em>`);
        } else {
            parts.push(escapeHtml(trimmed));
        }
    }

    return [
        '<!DOCTYPE html>',
        '<html lang="es"><head><meta charset="utf-8"></head>',
        '<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.35;color:#111111;">',
        parts.join(''),
        '</body></html>',
    ].join('');
}

function makeUniqueSendId() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Asunto base + marca única para que Gmail/Zimbra abran un hilo nuevo
 * (si no, agrupan todo bajo el mismo correo y ocultan el cuerpo tras “…”).
 */
function makeUniqueSubject(baseSubject) {
    const base = String(baseSubject || 'Solicitud').trim() || 'Solicitud';
    const now = new Date();
    const stamp = now.toLocaleString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
    return `${base} · ${stamp}`;
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
    const sendId = makeUniqueSendId();
    const subject = makeUniqueSubject(opts.subject || 'Solicitud');
    const text = opts.text || '';
    const html = opts.html || textToSimpleHtml(text);
    const fileName = opts.fileName || 'reclamo.pdf';
    const domain = String(from).includes('@') ? String(from).split('@')[1] : 'santafeciudad.gov.ar';

    const transporter = getTransporter();
    const info = await transporter.sendMail({
        from: `"Atención Ciudadana" <${from}>`,
        to,
        subject,
        text,
        html,
        // Forzar correo nuevo (sin hilo / reply)
        messageId: `<pai-${sendId}@${domain}>`,
        headers: {
            'X-Entity-Ref-ID': sendId,
            'X-Auto-Response-Suppress': 'All',
        },
        // No setear inReplyTo / references
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
        subject,
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
    makeUniqueSubject,
    textToSimpleHtml,
    sendClaimEmail,
};
