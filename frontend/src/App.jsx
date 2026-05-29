import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  UploadCloud, FileText, Send, Users, Settings, CheckCircle,
  AlertCircle, RefreshCw, X, Trash2, Edit, Save, UserPlus,
  Search, Moon, Sun, Wifi, WifiOff, ChevronRight, ChevronLeft,
  Check, Plus, Loader2
} from 'lucide-react';

// shadcn/ui
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// ── Config ──────────────────────────────────────────────────────────────────
const DEFAULT_SUPABASE_URL = 'https://hltyozdvcqfmvqmyrlva.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsdHlvemR2Y3FmbXZxbXlybHZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNjE5OTEsImV4cCI6MjA5NTYzNzk5MX0.bidc0Iq1-2ztsa6oazqrkt4DJ5b4rBSnIC1PM1E733U';
const DEFAULT_BACKEND_URL = 'https://whatsapp-pdf-bot-backend.onrender.com';

const getParam = (param, def) => {
  const url = new URLSearchParams(window.location.search);
  if (url.has(param)) { localStorage.setItem(param.toUpperCase(), url.get(param)); return url.get(param); }
  return localStorage.getItem(param.toUpperCase()) || def;
};

const supabaseUrl  = getParam('supabase_url', DEFAULT_SUPABASE_URL);
const supabaseKey  = getParam('supabase_anon_key', DEFAULT_SUPABASE_ANON_KEY);
const backendUrl   = getParam('railway_url', DEFAULT_BACKEND_URL);
const supabase     = createClient(supabaseUrl, supabaseKey);

// ── Helpers ──────────────────────────────────────────────────────────────────
const initials = (name = '') =>
  name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();

const formatBytes = (bytes) => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const normalizePhone = (raw) => {
  let p = raw.replace(/\D/g, '');
  if (p.length === 10 && /^[123]/.test(p)) p = '549' + p;
  else if (p.length === 12 && p.startsWith('54') && p[2] !== '9') p = '549' + p.slice(2);
  return p;
};

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border animate-fade-slide-up
      ${type === 'success'
        ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-300'
        : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950 dark:border-red-800 dark:text-red-300'
      }`}>
      {type === 'success'
        ? <CheckCircle className="w-5 h-5 flex-shrink-0" />
        : <AlertCircle className="w-5 h-5 flex-shrink-0" />
      }
      <span className="text-sm font-medium">{message}</span>
      <button onClick={onClose} className="ml-1 opacity-60 hover:opacity-100 transition-opacity">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// ── Step Indicator ─────────────────────────────────────────────────────────────
function StepIndicator({ current, total }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => (
        <React.Fragment key={i}>
          <div className={`step-dot w-2.5 h-2.5 rounded-full
            ${i < current
              ? 'bg-primary scale-100'
              : i === current
                ? 'bg-primary scale-125 ring-4 ring-primary/20'
                : 'bg-muted-foreground/30'
            }`}
          />
          {i < total - 1 && (
            <div className={`h-px w-8 transition-all duration-500
              ${i < current ? 'bg-primary' : 'bg-muted-foreground/20'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Step 1: Drop Zone ─────────────────────────────────────────────────────────
function DropZone({ onFile }) {
  const [active, setActive] = useState(false);
  const inputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault(); e.stopPropagation();
    setActive(e.type === 'dragenter' || e.type === 'dragover');
  };
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    setActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) validate(file);
  };
  const validate = (file) => {
    if (file.type !== 'application/pdf') return;
    if (file.size > 52428800) return;
    onFile(file);
  };

  return (
    <div className="animate-fade-slide-up flex flex-col items-center w-full max-w-xl mx-auto">
      <h2 className="text-3xl font-bold text-foreground mb-2 tracking-tight text-center">
        Enviá un documento
      </h2>
      <p className="text-muted-foreground text-center mb-8 text-base">
        Arrastrá tu PDF o hacé clic para buscarlo
      </p>

      <div
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`dropzone-idle w-full border-2 border-dashed rounded-3xl cursor-pointer
          flex flex-col items-center justify-center gap-6 p-16
          transition-all duration-300 select-none
          ${active
            ? 'dropzone-active border-primary bg-primary/5 scale-[1.01]'
            : 'border-border hover:border-primary/50 hover:bg-muted/40'
          }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && validate(e.target.files[0])}
        />
        <div className={`w-20 h-20 rounded-2xl flex items-center justify-center
          transition-all duration-300 shadow-sm
          ${active ? 'bg-primary text-primary-foreground scale-110' : 'bg-muted text-muted-foreground'}`}>
          <UploadCloud className="w-9 h-9" />
        </div>

        <div className="text-center space-y-1">
          <p className="text-lg font-semibold text-foreground">
            {active ? 'Soltá para subir' : 'Arrastrá tu PDF acá'}
          </p>
          <p className="text-sm text-muted-foreground">o tocá para explorar archivos</p>
          <p className="text-xs text-muted-foreground/60 mt-3">Solo PDF · Máximo 50 MB</p>
        </div>
      </div>
    </div>
  );
}

// ── Step 2: Preview ────────────────────────────────────────────────────────────
function FilePreview({ file, onBack, onNext }) {
  return (
    <div className="animate-fade-slide-up flex flex-col items-center w-full max-w-xl mx-auto">
      <h2 className="text-3xl font-bold text-foreground mb-2 tracking-tight text-center">
        Vista previa
      </h2>
      <p className="text-muted-foreground text-center mb-8 text-base">
        Confirmá el archivo antes de continuar
      </p>

      <Card className="w-full shadow-lg">
        <CardContent className="p-6">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-950 border border-red-100 dark:border-red-900
              flex items-center justify-center flex-shrink-0 shadow-sm">
              <FileText className="w-8 h-8 text-red-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-base font-semibold text-foreground truncate">{file.name}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{formatBytes(file.size)}</p>
              <Badge variant="secondary" className="mt-2 text-xs">PDF</Badge>
            </div>
            <button
              onClick={onBack}
              className="text-muted-foreground hover:text-destructive transition-colors p-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </CardContent>
      </Card>

      <div className="flex w-full gap-3 mt-8">
        <Button variant="outline" onClick={onBack} className="flex-1 h-13 text-base gap-2">
          <ChevronLeft className="w-4 h-4" /> Volver
        </Button>
        <Button onClick={onNext} className="flex-[2] h-13 text-base font-semibold gap-2">
          Continuar <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

// ── Step 3: Contact Picker ─────────────────────────────────────────────────────
function ContactPicker({ contacts, onBack, onSend, sending, progress, progressText }) {
  const active = contacts.filter(c => c.is_active);
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState('');

  const filtered = active.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.description || '').toLowerCase().includes(search.toLowerCase())
  );

  const allSelected = filtered.length > 0 && filtered.every(c => selected.has(c.id));

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelected(prev => {
        const next = new Set(prev);
        filtered.forEach(c => next.delete(c.id));
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        filtered.forEach(c => next.add(c.id));
        return next;
      });
    }
  };

  const handleSend = () => {
    const recipients = contacts.filter(c => selected.has(c.id));
    onSend(recipients);
  };

  return (
    <div className="animate-fade-slide-up flex flex-col items-center w-full max-w-xl mx-auto">
      <h2 className="text-3xl font-bold text-foreground mb-2 tracking-tight text-center">
        ¿A quién enviás?
      </h2>
      <p className="text-muted-foreground text-center mb-6 text-base">
        Seleccioná uno o más destinatarios
      </p>

      {/* Search */}
      <div className="relative w-full mb-3">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar destinatario..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 h-11 text-sm"
        />
      </div>

      {/* Select all bar */}
      <div className="flex items-center justify-between w-full mb-2 px-1">
        <span className="text-xs text-muted-foreground">
          {selected.size} seleccionado{selected.size !== 1 ? 's' : ''}
        </span>
        <Button variant="ghost" size="sm" onClick={toggleAll} className="text-xs h-7 px-2 gap-1">
          {allSelected ? 'Deseleccionar todos' : 'Seleccionar todos'}
        </Button>
      </div>

      {/* Contact list */}
      <ScrollArea className="w-full rounded-2xl border bg-card h-[min(360px,45vh)]">
        <div className="p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No hay destinatarios activos
            </div>
          ) : (
            filtered.map(c => {
              const isSelected = selected.has(c.id);
              return (
                <div
                  key={c.id}
                  onClick={() => toggle(c.id)}
                  className={`contact-card flex items-center gap-4 px-4 py-3 rounded-xl cursor-pointer
                    ${isSelected
                      ? 'bg-primary/8 dark:bg-primary/12 border border-primary/20'
                      : 'hover:bg-muted/60 border border-transparent'
                    }`}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggle(c.id)}
                    onClick={(e) => e.stopPropagation()}
                    id={`contact-${c.id}`}
                    className="flex-shrink-0"
                  />
                  <Avatar className="flex-shrink-0 w-9 h-9">
                    <AvatarFallback className={`text-xs font-bold
                      ${isSelected
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                      }`}>
                      {initials(c.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{c.name}</p>
                    {c.description && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{c.description}</p>
                    )}
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Progress */}
      {sending && (
        <div className="w-full mt-4 space-y-2 animate-fade-slide-down">
          <div className="flex justify-between text-xs font-medium text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {progressText}
            </span>
            <span className="text-primary font-mono">{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      {/* Action buttons */}
      <div className="flex w-full gap-3 mt-5">
        <Button variant="outline" onClick={onBack} disabled={sending} className="h-13 px-6 text-base gap-2">
          <ChevronLeft className="w-4 h-4" /> Volver
        </Button>
        <button
          onClick={handleSend}
          disabled={selected.size === 0 || sending}
          className={`send-btn flex-1 h-14 rounded-xl text-base font-bold text-white
            flex items-center justify-center gap-2.5
            bg-gradient-to-r from-indigo-600 to-violet-600
            disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none`}
        >
          {sending ? (
            <><Loader2 className="w-5 h-5 animate-spin" /> Enviando...</>
          ) : (
            <><Send className="w-5 h-5" /> Enviar por WhatsApp</>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Contacts Tab ───────────────────────────────────────────────────────────────
function ContactsTab({ contacts, onReload, showToast }) {
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', description: '' });
  const [editForm, setEditForm] = useState({ name: '', phone_number: '', description: '' });
  const [saving, setSaving] = useState(false);

  const filtered = contacts.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.description || '').toLowerCase().includes(search.toLowerCase()) ||
    c.phone_number.includes(search)
  );

  const allActiveIds = contacts.filter(c => c.is_active).map(c => c.id);
  const [selected, setSelected] = useState(new Set());

  const allSelected = allActiveIds.length > 0 && allActiveIds.every(id => selected.has(id));

  const toggleSelectAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allActiveIds));
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || form.phone.replace(/\D/g, '').length < 8) {
      showToast('Completá nombre y teléfono (mín. 8 dígitos)', 'error');
      return;
    }
    setSaving(true);
    try {
      const phone = normalizePhone(form.phone);
      const { error } = await supabase.from('contacts').insert([{
        name: form.name.trim(),
        phone_number: phone,
        description: form.description.trim() || null,
        is_active: true,
      }]);
      if (error) throw error;
      showToast('Contacto agregado ✓');
      setForm({ name: '', phone: '', description: '' });
      setAddOpen(false);
      onReload();
    } catch (err) {
      showToast(err.message.includes('23505') ? 'Ese número ya existe' : err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editForm.name.trim()) { showToast('El nombre es obligatorio', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('contacts').update({
        name: editForm.name.trim(),
        phone_number: normalizePhone(editForm.phone_number),
        description: editForm.description?.trim() || null,
      }).eq('id', editId);
      if (error) throw error;
      showToast('Cambios guardados ✓');
      setEditId(null);
      onReload();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      const { error } = await supabase.from('contacts').delete().eq('id', deleteId);
      if (error) throw error;
      showToast('Contacto eliminado');
      setDeleteId(null);
      onReload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleToggleActive = async (id, current) => {
    await supabase.from('contacts').update({ is_active: !current }).eq('id', id);
    onReload();
  };

  const startEdit = (c) => {
    setEditId(c.id);
    setEditForm({ name: c.name, phone_number: c.phone_number, description: c.description || '' });
  };

  return (
    <div className="animate-fade-slide-up space-y-4">
      {/* Header bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 h-10 text-sm"
          />
        </div>
        <Button variant="outline" size="sm" onClick={toggleSelectAll} className="h-10 gap-2 text-sm whitespace-nowrap">
          {allSelected ? 'Deseleccionar todos' : 'Seleccionar todos'}
        </Button>
        <Button onClick={() => setAddOpen(true)} size="sm" className="h-10 gap-2 text-sm">
          <Plus className="w-4 h-4" /> Agregar
        </Button>
      </div>

      <div className="text-xs text-muted-foreground">
        {contacts.filter(c => c.is_active).length} activos · {contacts.length} total
      </div>

      {/* Contact cards */}
      <ScrollArea className="h-[min(500px,58vh)] rounded-2xl border bg-card">
        <div className="p-3 space-y-1.5">
          {filtered.length === 0 && (
            <div className="py-16 text-center text-muted-foreground text-sm">
              No hay contactos
            </div>
          )}
          {filtered.map(c => {
            const isEditing = editId === c.id;
            const isChecked = selected.has(c.id);
            return (
              <div
                key={c.id}
                className={`contact-card group flex items-center gap-3 px-4 py-3.5 rounded-xl
                  border transition-all
                  ${isEditing
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-transparent hover:border-border hover:bg-muted/40'
                  }`}
              >
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={() => {
                    setSelected(prev => {
                      const next = new Set(prev);
                      next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                      return next;
                    });
                  }}
                />
                <Avatar className="flex-shrink-0 w-10 h-10">
                  <AvatarFallback className={`text-sm font-bold ${c.is_active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    {initials(c.name)}
                  </AvatarFallback>
                </Avatar>

                {isEditing ? (
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Input value={editForm.name} onChange={(e) => setEditForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="Nombre" className="h-8 text-sm" />
                    <Input value={editForm.phone_number} onChange={(e) => setEditForm(p => ({ ...p, phone_number: e.target.value }))}
                      placeholder="Teléfono" className="h-8 text-sm font-mono" />
                    <Input value={editForm.description} onChange={(e) => setEditForm(p => ({ ...p, description: e.target.value }))}
                      placeholder="Descripción / apodo" className="h-8 text-sm" />
                  </div>
                ) : (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground truncate">{c.name}</p>
                      {!c.is_active && <Badge variant="outline" className="text-[10px] h-4 py-0">Inactivo</Badge>}
                    </div>
                    {c.description && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{c.description}</p>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-1 flex-shrink-0">
                  {isEditing ? (
                    <>
                      <Button variant="ghost" size="icon" onClick={handleSaveEdit} disabled={saving}
                        className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setEditId(null)}
                        className="h-8 w-8 text-muted-foreground hover:text-foreground">
                        <X className="w-4 h-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Switch
                              checked={c.is_active}
                              onCheckedChange={() => handleToggleActive(c.id, c.is_active)}
                              className="scale-75"
                            />
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p>{c.is_active ? 'Desactivar' : 'Activar'}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <Button variant="ghost" size="icon" onClick={() => startEdit(c)}
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all">
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteId(c.id)}
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Add Contact Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Nuevo Contacto</DialogTitle>
            <DialogDescription>Completá los datos del destinatario</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="add-name" className="text-sm font-medium">Nombre</Label>
              <Input id="add-name" placeholder="Ej. Mesa de Entradas"
                value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-phone" className="text-sm font-medium">Teléfono</Label>
              <Input id="add-phone" placeholder="Ej. 549342555555" className="font-mono"
                value={form.phone} onChange={(e) => setForm(p => ({ ...p, phone: e.target.value }))} />
              <p className="text-xs text-muted-foreground">Incluí el código de país (Ej: 549 + área + número)</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-desc" className="text-sm font-medium">Descripción <span className="text-muted-foreground font-normal">(opcional)</span></Label>
              <Input id="add-desc" placeholder="Ej. Despacho del Intendente"
                value={form.description} onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))} />
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)} className="flex-1">
                Cancelar
              </Button>
              <Button type="submit" disabled={saving} className="flex-1 gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                Agregar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminás este contacto?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-white hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Status Tab ─────────────────────────────────────────────────────────────────
function StatusTab({ botStatus, contacts }) {
  const active = contacts.filter(c => c.is_active).length;
  return (
    <div className="animate-fade-slide-up space-y-4">
      {/* Connection card */}
      <Card className={`border-2 ${
        botStatus.offline ? 'border-muted' :
        botStatus.connected ? 'border-emerald-200 dark:border-emerald-800' : 'border-red-200 dark:border-red-800'
      }`}>
        <CardContent className="p-6 flex items-center gap-4">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 ${
            botStatus.offline ? 'bg-muted' :
            botStatus.connected ? 'bg-emerald-50 dark:bg-emerald-950' : 'bg-red-50 dark:bg-red-950'
          }`}>
            {botStatus.offline ? (
              <WifiOff className="w-7 h-7 text-muted-foreground" />
            ) : botStatus.connected ? (
              <Wifi className="w-7 h-7 text-emerald-500" />
            ) : (
              <AlertCircle className="w-7 h-7 text-red-500 animate-pulse" />
            )}
          </div>
          <div>
            <p className="text-base font-bold text-foreground">
              {botStatus.offline ? 'Sin conexión' :
               botStatus.connected ? 'WhatsApp conectado' : 'Esperando vinculación'}
            </p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {botStatus.offline ? 'El servicio no responde. Reintentando...' :
               botStatus.connected
                ? botStatus.phoneUser ? `Número: +${botStatus.phoneUser.split('@')[0]}` : 'Servicio activo'
                : 'Escaneá el código QR para conectar'}
            </p>
          </div>
          {!botStatus.offline && !botStatus.connected && (
            <RefreshCw className="w-5 h-5 text-muted-foreground animate-spin ml-auto" />
          )}
        </CardContent>
      </Card>

      {/* QR Code */}
      {!botStatus.connected && !botStatus.offline && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Código QR de Vinculación</CardTitle>
            <CardDescription>Abrí WhatsApp → Dispositivos vinculados → Vincular dispositivo</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center pb-6">
            {botStatus.qr ? (
              <div className="p-3 bg-white rounded-2xl shadow-md border">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(botStatus.qr)}&size=200x200`}
                  alt="QR WhatsApp"
                  className="w-48 h-48 rounded-lg"
                />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-8">
                <RefreshCw className="w-8 h-8 text-muted-foreground animate-spin" />
                <p className="text-sm text-muted-foreground">Generando código QR...</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-5 text-center">
            <div className="text-3xl font-extrabold text-primary">{contacts.length}</div>
            <div className="text-xs text-muted-foreground mt-1 uppercase tracking-wider font-semibold">Contactos</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 text-center">
            <div className="text-3xl font-extrabold text-emerald-500">{active}</div>
            <div className="text-xs text-muted-foreground mt-1 uppercase tracking-wider font-semibold">Activos</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [dark, setDark] = useState(true);
  const [contacts, setContacts] = useState([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [botStatus, setBotStatus] = useState({ connected: false, checking: true, qr: null, offline: true, phoneUser: null });
  const [toast, setToast] = useState(null);
  const [activeTab, setActiveTab] = useState('send');

  // Wizard state
  const [step, setStep] = useState(0); // 0=drop, 1=preview, 2=pick
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');

  // Apply dark class
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type, id: Date.now() });
  }, []);

  // Load contacts
  const loadContacts = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('contacts').select('*').order('name');
      if (error) throw error;
      setContacts(data || []);
    } catch (err) {
      showToast('Error cargando contactos', 'error');
    } finally {
      setLoadingContacts(false);
    }
  }, [showToast]);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  // Bot status polling
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`${backendUrl}/status`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        setBotStatus({ connected: !!data.connected, checking: false, qr: data.qr || null, offline: false, phoneUser: data.phone_user || null });
      } catch {
        setBotStatus({ connected: false, checking: false, qr: null, offline: true, phoneUser: null });
      }
    };
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, []);

  // Send handler (multi-recipient)
  const handleSend = async (recipients) => {
    if (!file || recipients.length === 0) return;
    setSending(true);
    setProgress(10);
    setProgressText('Subiendo archivo...');

    const cleanName = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
    const uniqueName = `${Date.now()}_${cleanName}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from('pdfs')
        .upload(uniqueName, file, { cacheControl: '3600', upsert: true });
      if (uploadError) throw uploadError;

      setProgress(50);
      setProgressText(`Enviando a ${recipients.length} destinatario${recipients.length > 1 ? 's' : ''}...`);

      // Send to each recipient sequentially
      const results = [];
      for (const [i, contact] of recipients.entries()) {
        setProgressText(`Enviando a ${contact.name}... (${i + 1}/${recipients.length})`);
        try {
          const res = await fetch(`${backendUrl}/send-pdf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: uniqueName, phoneNumber: contact.phone_number }),
          });
          const result = await res.json();
          results.push({ contact, ok: res.ok && result.success });
        } catch {
          results.push({ contact, ok: false });
        }
        setProgress(50 + Math.round(((i + 1) / recipients.length) * 50));
      }

      const ok = results.filter(r => r.ok).length;
      const fail = results.length - ok;

      setProgress(100);
      if (fail === 0) {
        showToast(`¡Enviado a ${ok} destinatario${ok > 1 ? 's' : ''}! ✓`);
      } else {
        showToast(`${ok} enviado${ok !== 1 ? 's' : ''}, ${fail} falló`, 'error');
      }

      setTimeout(() => {
        setFile(null);
        setStep(0);
        setSending(false);
        setProgress(0);
        setProgressText('');
      }, 2000);
    } catch (err) {
      showToast(err.message, 'error');
      setSending(false);
      setProgress(0);
    }
  };

  // File selected → go to step 1
  const handleFile = (f) => {
    setFile(f);
    setStep(1);
  };

  // Connection status pill
  const statusPill = botStatus.offline ? (
    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground bg-muted px-3 py-1.5 rounded-full">
      <span className="w-2 h-2 rounded-full bg-muted-foreground/50" />
      Sin conexión
    </div>
  ) : botStatus.connected ? (
    <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-3 py-1.5 rounded-full border border-emerald-200 dark:border-emerald-800">
      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
      WhatsApp activo
    </div>
  ) : (
    <div className="flex items-center gap-2 text-xs font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/60 px-3 py-1.5 rounded-full border border-red-200 dark:border-red-800">
      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
      Sin vincular
    </div>
  );

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground flex flex-col">

        {/* ── Header ── */}
        <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
          <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-9 flex items-center">
                <img
                  src="/marca_muni/SF_Horizontal_Blanco.png"
                  alt="Santa Fe"
                  className="h-7 object-contain hidden dark:block"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
                <img
                  src="/marca_muni/SF_Horizontal_Color.png"
                  alt="Santa Fe"
                  className="h-7 object-contain dark:hidden"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {statusPill}
              <Separator orientation="vertical" className="h-5" />
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={() => setDark(!dark)} className="h-9 w-9">
                      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{dark ? 'Modo claro' : 'Modo oscuro'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </header>

        {/* ── Main ── */}
        <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8">
          <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); if (v === 'send') { setStep(0); setFile(null); } }}>

            <TabsList className="w-full mb-8 h-11">
              <TabsTrigger value="send" className="flex-1 gap-2 text-sm">
                <Send className="w-4 h-4" /> Enviar
              </TabsTrigger>
              <TabsTrigger value="contacts" className="flex-1 gap-2 text-sm">
                <Users className="w-4 h-4" /> Contactos
              </TabsTrigger>
              <TabsTrigger value="status" className="flex-1 gap-2 text-sm">
                <Settings className="w-4 h-4" /> Estado
              </TabsTrigger>
            </TabsList>

            {/* ── Send Tab ── */}
            <TabsContent value="send">
              <StepIndicator current={step} total={3} />
              {step === 0 && <DropZone onFile={handleFile} />}
              {step === 1 && file && (
                <FilePreview
                  file={file}
                  onBack={() => { setFile(null); setStep(0); }}
                  onNext={() => setStep(2)}
                />
              )}
              {step === 2 && file && (
                <ContactPicker
                  contacts={loadingContacts ? [] : contacts}
                  onBack={() => setStep(1)}
                  onSend={handleSend}
                  sending={sending}
                  progress={progress}
                  progressText={progressText}
                />
              )}
            </TabsContent>

            {/* ── Contacts Tab ── */}
            <TabsContent value="contacts">
              {loadingContacts ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4].map(i => (
                    <Skeleton key={i} className="h-16 w-full rounded-xl" />
                  ))}
                </div>
              ) : (
                <ContactsTab
                  contacts={contacts}
                  onReload={loadContacts}
                  showToast={showToast}
                />
              )}
            </TabsContent>

            {/* ── Status Tab ── */}
            <TabsContent value="status">
              <StatusTab botStatus={botStatus} contacts={contacts} />
            </TabsContent>

          </Tabs>
        </main>

        {/* ── Footer ── */}
        <footer className="border-t py-4 text-center text-xs text-muted-foreground">
          Municipalidad de Santa Fe © {new Date().getFullYear()}
        </footer>

        {/* ── Toast ── */}
        {toast && (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
