export const PROTOCOL_ROW_ID = '00000000-0000-4000-8000-000000000001';

export const DEFAULT_PROTOCOL = {
  id: PROTOCOL_ROW_ID,
  active: false,
  title: 'PROTOCOLO ACTIVADO',
  subtitle: 'Actuación Municipal ante Emergencias por Lluvias',
  restrictions: [
    'NO SE DERIVAN POR PAI LOS RECLAMOS. (Solo derivar a tránsito y cuidacoches)',
    'Si se comunica alguien por un reclamo realizado previamente a la activación del protocolo, se debe generar un nuevo reclamo haciendo referencia al número original y a la cantidad de reiteraciones.',
    'Estas reglas aplican a los subtipos correspondientes a las derivaciones por PAI.',
  ],
  info_text:
    'Los reclamos ingresados a través del SAC (Sistema de Atención Ciudadana) serán tratados DIRECTAMENTE por el área de Riesgo.',
  exempt_subtypes: ['CUIDACOCHES'],
};

export function normalizeProtocolRow(row) {
  if (!row) return { ...DEFAULT_PROTOCOL, restrictions: [...DEFAULT_PROTOCOL.restrictions], exempt_subtypes: [...DEFAULT_PROTOCOL.exempt_subtypes] };

  let restrictions = DEFAULT_PROTOCOL.restrictions;
  if (Array.isArray(row.restrictions)) {
    restrictions = row.restrictions.map(String).filter(Boolean);
  } else if (typeof row.restrictions === 'string') {
    try {
      const parsed = JSON.parse(row.restrictions);
      if (Array.isArray(parsed)) restrictions = parsed.map(String).filter(Boolean);
    } catch {
      /* keep defaults */
    }
  }

  return {
    ...DEFAULT_PROTOCOL,
    ...row,
    active: Boolean(row.active),
    title: row.title || DEFAULT_PROTOCOL.title,
    subtitle: row.subtitle || DEFAULT_PROTOCOL.subtitle,
    restrictions,
    info_text: row.info_text ?? DEFAULT_PROTOCOL.info_text,
    exempt_subtypes: Array.isArray(row.exempt_subtypes)
      ? row.exempt_subtypes.map(String).filter(Boolean)
      : [...DEFAULT_PROTOCOL.exempt_subtypes],
  };
}

export function isProtocolExempt(subtipo, exemptList = []) {
  const clean = String(subtipo || '').trim().toUpperCase();
  if (!clean) return false;
  return (exemptList || []).some((s) => String(s).trim().toUpperCase() === clean);
}
