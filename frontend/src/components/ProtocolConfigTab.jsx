import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Save, Search, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { DEFAULT_PROTOCOL, PROTOCOL_ROW_ID, normalizeProtocolRow } from '@/lib/protocol';

export default function ProtocolConfigTab({ protocol, subtypesCatalog = [], supabase, showToast, onSaved }) {
  const [form, setForm] = useState(() => normalizeProtocolRow(protocol));
  const [restrictionsText, setRestrictionsText] = useState(
    () => (normalizeProtocolRow(protocol).restrictions || []).join('\n')
  );
  const [exemptSearch, setExemptSearch] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const next = normalizeProtocolRow(protocol);
    setForm(next);
    setRestrictionsText((next.restrictions || []).join('\n'));
  }, [protocol]);

  const catalogNames = useMemo(() => {
    const names = new Set();
    for (const item of subtypesCatalog) {
      const name = String(item.subtipo || '').trim().toUpperCase();
      if (name) names.add(name);
    }
    for (const exempt of form.exempt_subtypes || []) {
      const name = String(exempt || '').trim().toUpperCase();
      if (name) names.add(name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'es'));
  }, [subtypesCatalog, form.exempt_subtypes]);

  const filteredCatalog = useMemo(() => {
    const term = exemptSearch.trim().toUpperCase();
    if (!term) return catalogNames;
    return catalogNames.filter((name) => name.includes(term));
  }, [catalogNames, exemptSearch]);

  const exemptSet = useMemo(
    () => new Set((form.exempt_subtypes || []).map((s) => String(s).trim().toUpperCase())),
    [form.exempt_subtypes]
  );

  const toggleExempt = (name) => {
    const key = String(name).trim().toUpperCase();
    setForm((prev) => {
      const current = new Set((prev.exempt_subtypes || []).map((s) => String(s).trim().toUpperCase()));
      if (current.has(key)) current.delete(key);
      else current.add(key);
      return { ...prev, exempt_subtypes: Array.from(current).sort() };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const restrictions = restrictionsText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      const payload = {
        id: PROTOCOL_ROW_ID,
        active: Boolean(form.active),
        title: (form.title || DEFAULT_PROTOCOL.title).trim() || DEFAULT_PROTOCOL.title,
        subtitle: (form.subtitle || '').trim(),
        restrictions,
        info_text: (form.info_text || '').trim(),
        exempt_subtypes: (form.exempt_subtypes || []).map((s) => String(s).trim().toUpperCase()).filter(Boolean),
      };

      const { data, error } = await supabase
        .from('protocol_settings')
        .upsert(payload, { onConflict: 'id' })
        .select('*')
        .single();

      if (error) throw error;
      const saved = normalizeProtocolRow(data);
      onSaved?.(saved);
      showToast?.('Protocolo guardado ✓');
    } catch (err) {
      console.error('Error guardando protocolo:', err);
      showToast?.('Error al guardar el protocolo', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-muted/20 p-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-red-600" />
            <Label htmlFor="protocol-active" className="text-sm font-semibold">
              Protocolo activo
            </Label>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Al activarlo, todos los operadores ven el aviso y deben confirmar antes de derivar
            (salvo subtipos exceptuados).
          </p>
        </div>
        <Switch
          id="protocol-active"
          checked={Boolean(form.active)}
          onCheckedChange={(checked) => setForm((prev) => ({ ...prev, active: checked }))}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="protocol-title">Título del cartel</Label>
          <Input
            id="protocol-title"
            value={form.title || ''}
            onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
            placeholder="PROTOCOLO ACTIVADO"
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="protocol-subtitle">Subtítulo</Label>
          <Input
            id="protocol-subtitle"
            value={form.subtitle || ''}
            onChange={(e) => setForm((prev) => ({ ...prev, subtitle: e.target.value }))}
            placeholder="Actuación Municipal ante Emergencias por Lluvias"
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="protocol-restrictions">Restricciones (una por línea)</Label>
          <Textarea
            id="protocol-restrictions"
            value={restrictionsText}
            onChange={(e) => setRestrictionsText(e.target.value)}
            className="min-h-28"
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="protocol-info">Texto de información</Label>
          <Textarea
            id="protocol-info"
            value={form.info_text || ''}
            onChange={(e) => setForm((prev) => ({ ...prev, info_text: e.target.value }))}
            className="min-h-24"
          />
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-sm font-semibold">Subtipos exceptuados</Label>
          <Badge variant="secondary" className="font-medium">
            {exemptSet.size} seleccionados
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Estos subtipos pueden enviarse sin el popup de confirmación mientras el protocolo esté activo.
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={exemptSearch}
            onChange={(e) => setExemptSearch(e.target.value)}
            placeholder="Buscar subtipo…"
            className="pl-9"
          />
        </div>
        <div className="max-h-52 overflow-y-auto rounded-xl border border-border">
          {filteredCatalog.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No hay subtipos para mostrar.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {filteredCatalog.map((name) => {
                const checked = exemptSet.has(name);
                return (
                  <li key={name}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/40">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleExempt(name)}
                      />
                      <span className="text-sm font-medium">{name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="flex justify-end pt-1">
        <Button type="button" onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Guardar protocolo
        </Button>
      </div>
    </div>
  );
}
