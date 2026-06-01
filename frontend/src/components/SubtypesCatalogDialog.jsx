import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, Plus, RefreshCw, Edit, Trash2, Save, X, Loader2, 
  LayoutGrid, Table2, User, Zap, AlertCircle, HelpCircle, MapPin
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription 
} from '@/components/ui/dialog';
import { 
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, 
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle 
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export default function SubtypesCatalogDialog({ 
  open, 
  onOpenChange, 
  catalog, 
  loading, 
  onReload, 
  showToast, 
  supabase,
  prefill,
  onClearPrefill,
  searchPrefill,
  onClearSearchPrefill,
  contacts = [],
  onReloadContacts
}) {
  const [search, setSearch] = useState('');
  const [tipoFilter, setTipoFilter] = useState('all');
  const [categoriaFilter, setCategoriaFilter] = useState('all');
  const [derivacionFilter, setDerivacionFilter] = useState('all');
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'table'
  const [detailItem, setDetailItem] = useState(null);
  
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ tipo: 'RECLAMO', categoria: '', subtipo: '', derivar: true, comentarios: '', contactId: 'none' });
  
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({ tipo: 'RECLAMO', categoria: '', subtipo: '', derivar: true, comentarios: '', contactId: 'none' });
  
  const [deleteId, setDeleteId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [visibleCount, setVisibleCount] = useState(16);
  const observerRef = React.useRef(null);
 
  // Handle prefill from new uploaded PDF subtypes
  useEffect(() => {
    if (prefill && open) {
      setAddForm({
        tipo: prefill.tipo || 'RECLAMO',
        categoria: prefill.categoria || '',
        subtipo: prefill.subtipo || '',
        derivar: prefill.derivar !== undefined ? prefill.derivar : true,
        comentarios: prefill.comentarios || '',
        contactId: 'none'
      });
      setAddOpen(true);
      if (onClearPrefill) onClearPrefill();
    }
  }, [prefill, open, onClearPrefill]);

  // Handle search prefill from outer state
  useEffect(() => {
    if (searchPrefill && open) {
      setSearch(searchPrefill);
      if (onClearSearchPrefill) onClearSearchPrefill();
    }
  }, [searchPrefill, open, onClearSearchPrefill]);
 
  // Helper to map subtypes to contacts for O(1) lookups
  const subtypeToContactMap = useMemo(() => {
    const map = new Map();
    if (!contacts) return map;
    contacts.forEach(contact => {
      if (contact.is_active && contact.subtypes) {
        contact.subtypes.forEach(sub => {
          if (sub) {
            map.set(sub.trim().toUpperCase(), contact);
          }
        });
      }
    });
    return map;
  }, [contacts]);
 
  // Helper to find contact assigned to a subtype
  const getAssignedContact = (subtipo) => {
    if (!subtipo) return null;
    return subtypeToContactMap.get(subtipo.trim().toUpperCase()) || null;
  };
 
  // Filter logic
  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    return catalog.filter(item => {
      // Find assigned contact to include contact name in search
      const assignedContact = getAssignedContact(item.subtipo);
      const contactName = assignedContact ? assignedContact.name.toLowerCase() : '';
 
      const matchesSearch = !term ||
        (item.tipo || '').toLowerCase().includes(term) ||
        (item.categoria || '').toLowerCase().includes(term) ||
        (item.subtipo || '').toLowerCase().includes(term) ||
        (item.comentarios || '').toLowerCase().includes(term) ||
        contactName.includes(term);
        
      const matchesTipo = tipoFilter === 'all' || item.tipo === tipoFilter;
      const matchesCategoria = categoriaFilter === 'all' || item.categoria === categoriaFilter;
      const matchesDerivacion = derivacionFilter === 'all' || 
        (derivacionFilter === 'derivar' && item.derivar) ||
        (derivacionFilter === 'no' && !item.derivar);
        
      return matchesSearch && matchesTipo && matchesCategoria && matchesDerivacion;
    });
  }, [catalog, search, tipoFilter, categoriaFilter, derivacionFilter, subtypeToContactMap]);
 
  // Reset pagination on search/filters/viewMode change
  useEffect(() => {
    setVisibleCount(16);
  }, [search, tipoFilter, categoriaFilter, derivacionFilter, viewMode]);
 
  const itemsToShow = useMemo(() => {
    return filtered.slice(0, visibleCount);
  }, [filtered, visibleCount]);

  // Infinite Scroll / Lazy Load Callback Ref Observer
  const sentinelRef = React.useCallback(node => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (node) {
      const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount(prev => Math.min(prev + 16, filtered.length));
        }
      }, { 
        rootMargin: '250px', // Load next batch 250px before reaching the end of scroll
        threshold: 0.01 
      });
      observer.observe(node);
      observerRef.current = observer;
    }
  }, [filtered.length]);

  // Clean up observer on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, []);
 
  const uniqueTipos = useMemo(() => {
    const set = new Set();
    catalog.forEach(item => {
      if (item.tipo) set.add(item.tipo);
    });
    return [...set].sort();
  }, [catalog]);

  const uniqueCategorias = useMemo(() => {
    const set = new Set();
    catalog.forEach(item => {
      if (item.categoria) set.add(item.categoria);
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'es'));
  }, [catalog]);

  const handleToggleDerivar = async (item, e) => {
    if (e) e.stopPropagation();
    const newDerivar = !item.derivar;
    try {
      const { error } = await supabase
        .from('subtypes_catalog')
        .update({ derivar: newDerivar })
        .eq('id', item.id);
      if (error) throw error;
      showToast(`Subtipo "${item.subtipo}" actualizado ✓`);
      onReload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Helper to handle contact reassignment in database
  const updateContactAssignment = async (subtipo, newContactId) => {
    const cleanSub = subtipo.trim().toUpperCase();
    
    // Find who currently has this subtype
    const oldContacts = contacts.filter(c => c.subtypes && c.subtypes.some(s => s.trim().toUpperCase() === cleanSub));
    
    // Remove from old contacts
    for (const oldContact of oldContacts) {
      if (oldContact.id.toString() !== newContactId) {
        const updatedSubtypes = (oldContact.subtypes || []).filter(s => s.trim().toUpperCase() !== cleanSub);
        await supabase
          .from('contacts')
          .update({ subtypes: updatedSubtypes })
          .eq('id', oldContact.id);
      }
    }
    
    // Add to new contact if selected
    if (newContactId && newContactId !== 'none') {
      const newContact = contacts.find(c => c.id.toString() === newContactId);
      if (newContact) {
        const currentSubtypes = newContact.subtypes || [];
        const isAlreadyAdded = currentSubtypes.some(s => s.trim().toUpperCase() === cleanSub);
        if (!isAlreadyAdded) {
          const updatedSubtypes = [...currentSubtypes, cleanSub];
          await supabase
            .from('contacts')
            .update({ subtypes: updatedSubtypes })
            .eq('id', newContact.id);
        }
      }
    }

    if (onReloadContacts) {
      await onReloadContacts();
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!addForm.categoria.trim() || !addForm.subtipo.trim()) {
      showToast('Completá Categoría y Subtipo', 'error');
      return;
    }
    setSaving(true);
    const newSubtipo = addForm.subtipo.trim().toUpperCase();
    try {
      // 1. Insert subtype catalog item
      const { error } = await supabase
        .from('subtypes_catalog')
        .insert([{
          tipo: addForm.tipo,
          categoria: addForm.categoria.trim().toUpperCase(),
          subtipo: newSubtipo,
          derivar: addForm.derivar,
          comentarios: addForm.comentarios.trim() || null
        }]);
      if (error) throw error;
      
      // 2. Assign contact if set
      if (addForm.derivar && addForm.contactId !== 'none') {
        await updateContactAssignment(newSubtipo, addForm.contactId);
      }

      showToast('Subtipo agregado al catálogo ✓');
      setAddForm({ tipo: 'RECLAMO', categoria: '', subtipo: '', derivar: true, comentarios: '', contactId: 'none' });
      setAddOpen(false);
      onReload();
    } catch (err) {
      showToast(err.message.includes('23505') ? 'Este subtipo ya existe en el catálogo' : err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (item, e) => {
    if (e) e.stopPropagation();
    const assigned = getAssignedContact(item.subtipo);
    setEditId(item.id);
    setEditForm({
      tipo: item.tipo,
      categoria: item.categoria,
      subtipo: item.subtipo,
      derivar: item.derivar,
      comentarios: item.comentarios || '',
      contactId: assigned ? assigned.id.toString() : 'none'
    });
  };

  const handleSaveEdit = async (e) => {
    if (e) e.stopPropagation();
    if (!editForm.categoria.trim() || !editForm.subtipo.trim()) {
      showToast('Completá Categoría y Subtipo', 'error');
      return;
    }
    setSaving(true);
    const newSubtipo = editForm.subtipo.trim().toUpperCase();
    
    // Find old catalog item to see if subtipo name changed
    const oldItem = catalog.find(i => i.id === editId);
    const oldSubtipo = oldItem ? oldItem.subtipo : newSubtipo;

    try {
      // 1. Update subtypes catalog table
      const { error } = await supabase
        .from('subtypes_catalog')
        .update({
          tipo: editForm.tipo,
          categoria: editForm.categoria.trim().toUpperCase(),
          subtipo: newSubtipo,
          derivar: editForm.derivar,
          comentarios: editForm.comentarios.trim() || null
        })
        .eq('id', editId);
      if (error) throw error;
      
      // 2. Handle contact assignment
      if (editForm.derivar) {
        await updateContactAssignment(newSubtipo, editForm.contactId);
      } else {
        // If it's no longer derivar, remove assignment
        await updateContactAssignment(newSubtipo, 'none');
      }

      // If subtipo name changed, clean up old references
      if (oldSubtipo !== newSubtipo) {
        await updateContactAssignment(oldSubtipo, 'none');
      }

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
    const item = catalog.find(i => i.id === deleteId);
    try {
      const { error } = await supabase
        .from('subtypes_catalog')
        .delete()
        .eq('id', deleteId);
      if (error) throw error;

      if (item) {
        // Remove contact assignments
        await updateContactAssignment(item.subtipo, 'none');
      }

      showToast('Subtipo eliminado del catálogo');
      setDeleteId(null);
      if (detailItem && detailItem.id === deleteId) {
        setDetailItem(null);
      }
      onReload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-7xl h-[88vh] flex flex-col p-0 gap-0 overflow-hidden bg-background [&>button[class*='absolute']]:text-white/80 [&>button[class*='absolute']]:hover:text-white border-border/60 shadow-2xl">
          <DialogHeader className="msf-header text-white p-5 sm:px-8 flex-shrink-0">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5 sm:gap-8">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
                <img
                  src="/marca_muni/SF_Horizontal_Blanco.png"
                  alt="Municipalidad de Santa Fe"
                  className="h-11 w-auto max-w-[min(100%,300px)] object-contain object-left drop-shadow-sm sm:h-12"
                />
                <div className="hidden h-14 w-[1px] bg-[oklch(1_0_0_/22%)] sm:block" />
                <div className="flex flex-col gap-0.5">
                  <DialogTitle className="font-heading text-2xl sm:text-3xl leading-[1.08] font-bold tracking-tight text-[var(--msf-header-fg)]">
                    Buscador PAI
                  </DialogTitle>
                  <p className="max-w-xl text-sm sm:text-base font-medium text-[var(--msf-header-muted)]">
                    Derivaciones y orientación
                  </p>
                </div>
              </div>
              <Button 
                onClick={() => setAddOpen(true)} 
                size="sm" 
                className="gap-1.5 text-xs font-bold h-10 px-4 bg-white text-[var(--msf-blue)] hover:bg-white/90 shadow-sm border-0 self-start sm:self-auto shrink-0 transition-all active:scale-95 duration-150 cursor-pointer"
              >
                <Plus className="w-4 h-4" /> Agregar Subtipo
              </Button>
            </div>
          </DialogHeader>
          <div className="p-6 flex-1 flex flex-col min-h-0 gap-4">

          {/* Filters & View switcher */}
          <div className="flex flex-wrap gap-3 items-center pb-2 border-b border-border/40">
            <div className="relative flex-1 min-w-[200px] sm:max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder="Buscar por subtipo, tipo o categoría…" 
                value={search} 
                onChange={(e) => setSearch(e.target.value)} 
                className="pl-10 h-10 text-sm"
              />
            </div>

            <Select value={tipoFilter} onValueChange={setTipoFilter}>
              <SelectTrigger className="w-full min-w-[9rem] sm:w-[150px] h-10 text-sm">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                {uniqueTipos.map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={categoriaFilter} onValueChange={setCategoriaFilter}>
              <SelectTrigger className="w-full min-w-[9rem] sm:w-[220px] h-10 text-sm">
                <SelectValue placeholder="Categoría" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                <SelectItem value="all">Todas las categorías</SelectItem>
                {uniqueCategorias.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={derivacionFilter} onValueChange={setDerivacionFilter}>
              <SelectTrigger className="w-full min-w-[9rem] sm:w-[180px] h-10 text-sm">
                <SelectValue placeholder="Derivación" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">¿Se deriva? (todas)</SelectItem>
                <SelectItem value="derivar">Se deriva</SelectItem>
                <SelectItem value="no">No derivar</SelectItem>
              </SelectContent>
            </Select>
            
            <div className="flex items-center border rounded-xl p-0.5 bg-muted/20 ml-auto">
              <Button 
                variant={viewMode === 'cards' ? 'secondary' : 'ghost'} 
                size="sm" 
                onClick={() => setViewMode('cards')} 
                className="h-8 px-3 gap-1.5 text-xs font-semibold"
              >
                <LayoutGrid className="w-3.5 h-3.5" /> Tarjetas
              </Button>
              <Button 
                variant={viewMode === 'table' ? 'secondary' : 'ghost'} 
                size="sm" 
                onClick={() => setViewMode('table')} 
                className="h-8 px-3 gap-1.5 text-xs font-semibold"
              >
                <Table2 className="w-3.5 h-3.5" /> Tabla
              </Button>
            </div>
            
            <Button 
              variant="outline" 
              size="sm" 
              onClick={onReload} 
              disabled={loading}

              className="h-10 px-3 gap-1.5 text-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {/* Catalog List */}
          <div className="flex-1 flex flex-col min-h-0 mt-1">
            {loading && catalog.length === 0 ? (
              <div className="space-y-3 py-6">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 border border-dashed rounded-2xl bg-muted/20">
                <Search className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-60" />
                <p className="text-sm font-bold text-muted-foreground">Sin resultados</p>
                <p className="text-xs text-muted-foreground mt-1">Cambiá los filtros de búsqueda o probá otra palabra.</p>
              </div>
            ) : viewMode === 'cards' ? (
              // ── CARDS VIEW ──────────────────────────────────────────────────
              <div className="flex-1 overflow-y-auto pr-2 rounded-2xl border bg-card/40 p-3 shadow-inner min-h-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-1">
                  {itemsToShow.map(item => {
                    const isDerivar = item.derivar;
                    const assignedContact = getAssignedContact(item.subtipo);
                    const isEditing = editId === item.id;
                    
                    if (isEditing) {
                      return (
                        <Card key={item.id} className="border-primary/45 bg-primary/[0.02] p-4 space-y-3 flex flex-col justify-between">
                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <Badge className="text-[9px] font-bold">{editForm.tipo}</Badge>
                              <Badge variant="outline" className="text-[9px]">{editForm.categoria}</Badge>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[9px] font-bold text-muted-foreground uppercase">Subtipo</Label>
                              <Input 
                                value={editForm.subtipo} 
                                onChange={(e) => setEditForm(p => ({ ...p, subtipo: e.target.value }))}
                                className="h-8 text-xs font-bold uppercase" 
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[9px] font-bold text-muted-foreground uppercase">Categoría</Label>
                              <Input 
                                value={editForm.categoria} 
                                onChange={(e) => setEditForm(p => ({ ...p, categoria: e.target.value }))}
                                className="h-8 text-xs uppercase" 
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[9px] font-bold text-muted-foreground uppercase">Comentarios / Instrucción</Label>
                              <Input 
                                value={editForm.comentarios} 
                                onChange={(e) => setEditForm(p => ({ ...p, comentarios: e.target.value }))}
                                className="h-8 text-xs" 
                              />
                            </div>
                            <div className="flex items-center justify-between pt-1">
                              <div className="flex items-center gap-1">
                                <Switch 
                                  checked={editForm.derivar} 
                                  onCheckedChange={(checked) => setEditForm(p => ({ ...p, derivar: checked }))}
                                  id={`edit-derivar-card-${item.id}`}
                                  className="scale-75"
                                />
                                <Label htmlFor={`edit-derivar-card-${item.id}`} className="text-[10px] font-bold">Se deriva</Label>
                              </div>
                            </div>
                            {editForm.derivar && (
                              <div className="space-y-1 pt-1 border-t border-border/40">
                                <Label className="text-[9px] font-bold text-muted-foreground uppercase">Contacto Asignado</Label>
                                <Select value={editForm.contactId} onValueChange={(v) => setEditForm(p => ({ ...p, contactId: v }))}>
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue placeholder="Seleccionar contacto" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">Sin contacto asignado</SelectItem>
                                    {contacts.filter(c => c.is_active).map(c => (
                                      <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                          </div>
                          
                          <div className="flex justify-end gap-1.5 pt-2 border-t border-border/40">
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditId(null)}>
                              Cancelar
                            </Button>
                            <Button size="sm" className="h-7 text-xs gap-1" onClick={(e) => handleSaveEdit(e)} disabled={saving}>
                              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3 h-3" />} Guardar
                            </Button>
                          </div>
                        </Card>
                      );
                    }

                    return (
                      <div className="relative group/card" key={item.id}>
                        <Card 
                          onClick={() => setDetailItem(item)}
                          className={cn(
                            "group/card cursor-pointer overflow-hidden rounded-lg border py-0 shadow-xs ring-0 relative h-full",
                            "motion-safe:transition-[transform,box-shadow,border-color,background-color] motion-safe:duration-300 motion-safe:ease-out",
                            "motion-safe:hover:scale-[1.05] motion-safe:hover:shadow-lg",
                            isDerivar 
                              ? "border-[var(--msf-border-derivar)] bg-[var(--msf-card-derivar)] motion-safe:hover:border-[var(--msf-green)]/50" 
                              : "border-[var(--msf-border-no)] bg-[var(--msf-card-no)] motion-safe:hover:border-[oklch(0.62_0.14_22_/0.42)]"
                          )}
                        >
                          <div className="flex h-full min-h-[10.5rem] flex-col gap-3 px-3.5 py-3.5">
                            <div className="flex flex-wrap items-center justify-between gap-1.5">
                              <Badge 
                                variant="outline" 
                                className={cn(
                                  "h-5 px-1.5 text-[0.65rem] font-bold uppercase tracking-wide",
                                  isDerivar
                                    ? "border-[var(--msf-border-derivar)] bg-[oklch(1_0_0_/0.35)] text-[var(--msf-badge-derive-fg)]"
                                    : "border-[var(--msf-border-no)] bg-[oklch(1_0_0_/0.35)] text-[var(--msf-badge-no-fg)]"
                                )}
                              >
                                {item.tipo}
                              </Badge>
                              <Badge 
                                variant="secondary" 
                                className={cn(
                                  "h-5 shrink-0 border-0 px-1.5 text-[0.65rem] font-bold cursor-pointer select-none",
                                  isDerivar
                                    ? "bg-[var(--msf-badge-derive-bg)] text-[var(--msf-badge-derive-fg)]"
                                    : "bg-[var(--msf-badge-no-bg)] text-[var(--msf-badge-no-fg)]"
                                )}
                                onClick={(e) => handleToggleDerivar(item, e)}
                              >
                                {isDerivar ? 'Se deriva' : 'No derivar'}
                              </Badge>
                            </div>
                            
                            <h4 
                              className={cn(
                                "min-h-0 flex-1 text-left text-[0.8125rem] leading-snug font-bold tracking-tight uppercase leading-tight sm:text-sm",
                                isDerivar
                                  ? "text-[var(--msf-blue)] group-hover/card:text-[var(--msf-green-dark)]"
                                  : "text-[var(--msf-title-no)] group-hover/card:text-[oklch(0.48_0.12_22)]"
                              )}
                            >
                              <span className="line-clamp-[5]">{item.subtipo}</span>
                            </h4>

                            <div 
                              className={cn(
                                "mt-auto flex flex-col gap-2 border-t pt-3",
                                isDerivar ? "border-[var(--msf-border-derivar)]" : "border-[var(--msf-border-no)]"
                              )}
                            >
                              <div className="space-y-1">
                                <p className="text-[0.62rem] font-semibold tracking-wider text-muted-foreground uppercase">
                                  Categoría
                                </p>
                                <p className="line-clamp-2 text-xs leading-snug font-semibold text-pretty text-foreground">
                                  {item.categoria}
                                </p>
                              </div>

                              {isDerivar && (
                                <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
                                  <p className="text-[0.62rem] font-semibold tracking-wider text-muted-foreground uppercase">
                                    Contacto Asignado
                                  </p>
                                  <Select 
                                    value={assignedContact ? assignedContact.id.toString() : 'none'} 
                                    onValueChange={async (newId) => {
                                      try {
                                        await updateContactAssignment(item.subtipo, newId);
                                        showToast('Contacto asignado correctamente', 'success');
                                      } catch (err) {
                                        showToast('Error al asignar contacto: ' + err.message, 'error');
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="h-7 text-xs py-0 px-2 font-bold text-primary bg-primary/5 hover:bg-primary/10 border-primary/10 hover:border-primary/20 rounded focus:ring-0 focus:ring-offset-0 w-full max-w-[170px]">
                                      <User className="w-2.5 h-2.5 mr-1" />
                                      <SelectValue placeholder="Sin contacto" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">Sin contacto</SelectItem>
                                      {contacts.filter(c => c.is_active).map(c => (
                                        <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}

                              {item.comentarios && (
                                <div className="space-y-1">
                                  <p className="text-[0.62rem] font-semibold tracking-wider text-muted-foreground uppercase">
                                    Comentarios
                                  </p>
                                  <p className="line-clamp-3 text-left text-[11px] leading-relaxed text-pretty text-foreground">
                                    {item.comentarios}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        </Card>
                      </div>
                    );
                  })}
                  {visibleCount < filtered.length && (
                    <div ref={sentinelRef} className="h-12 flex items-center justify-center py-4 col-span-full">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              // ── TABLE VIEW ──────────────────────────────────────────────────
              <div className="flex-1 overflow-y-auto pr-2 rounded-2xl border bg-card shadow-inner min-h-0">
                <div className="p-2 space-y-1.5">
                  {itemsToShow.map(item => {
                    const isEditing = editId === item.id;
                    const assignedContact = getAssignedContact(item.subtipo);
                    
                    return (
                      <div 
                        key={item.id} 
                        onClick={() => !isEditing && setDetailItem(item)}
                        className={cn(
                          "flex flex-col md:flex-row md:items-center gap-4 p-3 rounded-xl border transition-all text-sm font-medium cursor-pointer",
                          isEditing 
                            ? "border-primary/30 bg-primary/5 cursor-default" 
                            : item.derivar 
                              ? "border-[var(--msf-border-derivar)] bg-[var(--msf-row-derivar)] hover:bg-[var(--msf-row-derivar)]/80" 
                              : "border-[var(--msf-border-no)] bg-[var(--msf-row-no)] hover:bg-[var(--msf-row-no)]/80"
                        )}
                      >
                        {isEditing ? (
                          <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-3 bg-muted/20 p-3 rounded-lg border border-primary/10">
                            <div className="space-y-1">
                              <Label className="text-[10px] font-semibold text-muted-foreground">Tipo</Label>
                              <Select value={editForm.tipo} onValueChange={(v) => setEditForm(p => ({ ...p, tipo: v }))}>
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="RECLAMO">RECLAMO</SelectItem>
                                  <SelectItem value="DENUNCIA">DENUNCIA</SelectItem>
                                  <SelectItem value="CONSULTA">CONSULTA</SelectItem>
                                  <SelectItem value="SUGERENCIA">SUGERENCIA</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] font-semibold text-muted-foreground">Categoría</Label>
                              <Input 
                                value={editForm.categoria} 
                                onChange={(e) => setEditForm(p => ({ ...p, categoria: e.target.value }))}
                                className="h-8 text-xs uppercase" 
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] font-semibold text-muted-foreground">Subtipo</Label>
                              <Input 
                                value={editForm.subtipo} 
                                onChange={(e) => setEditForm(p => ({ ...p, subtipo: e.target.value }))}
                                className="h-8 text-xs uppercase" 
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] font-semibold text-muted-foreground">Asignación de Contacto</Label>
                              <Select value={editForm.contactId} onValueChange={(v) => setEditForm(p => ({ ...p, contactId: v }))} disabled={!editForm.derivar}>
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="Asignar contacto" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Sin contacto asignado</SelectItem>
                                  {contacts.filter(c => c.is_active).map(c => (
                                    <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="md:col-span-4 space-y-1">
                              <Label className="text-[10px] font-semibold text-muted-foreground">Comentarios de Derivación</Label>
                              <Input 
                                value={editForm.comentarios} 
                                onChange={(e) => setEditForm(p => ({ ...p, comentarios: e.target.value }))}
                                className="h-8 text-xs" 
                              />
                            </div>
                            <div className="md:col-span-4 flex items-center gap-2 pt-1">
                              <Switch 
                                checked={editForm.derivar} 
                                onCheckedChange={(checked) => setEditForm(p => ({ ...p, derivar: checked }))}
                                id={`edit-derivar-tbl-${item.id}`}
                                className="scale-75"
                              />
                              <Label htmlFor={`edit-derivar-tbl-${item.id}`} className="text-xs font-semibold">Se deriva por PAI</Label>
                            </div>
                          </div>
                        ) : (
                          <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                            {/* Tipo / Categoria */}
                            <div className="md:col-span-3 space-y-1">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-[9px] font-bold h-4 px-1.5 uppercase bg-muted/30">
                                  {item.tipo}
                                </Badge>
                                <Badge 
                                  variant={item.derivar ? "default" : "secondary"} 
                                  className={`text-[9px] font-extrabold h-4 px-1.5 ${item.derivar ? 'bg-emerald-500 text-white' : 'text-muted-foreground'} cursor-pointer select-none`}
                                  onClick={(e) => handleToggleDerivar(item, e)}
                                >
                                  {item.derivar ? 'Se deriva' : 'No derivar'}
                                </Badge>
                              </div>
                              <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase truncate">
                                {item.categoria}
                              </p>
                            </div>

                            {/* Subtipo */}
                            <div className="md:col-span-4 min-w-0">
                              <p className="text-sm font-black text-foreground uppercase tracking-wide truncate">
                                {item.subtipo}
                              </p>
                            </div>

                            {/* Contact & Comentarios */}
                            <div className="md:col-span-5 min-w-0 space-y-1" onClick={(e) => e.stopPropagation()}>
                              {item.derivar && (
                                <Select 
                                  value={assignedContact ? assignedContact.id.toString() : 'none'} 
                                  onValueChange={async (newId) => {
                                    try {
                                      await updateContactAssignment(item.subtipo, newId);
                                      showToast('Contacto asignado correctamente', 'success');
                                    } catch (err) {
                                      showToast('Error al asignar contacto: ' + err.message, 'error');
                                    }
                                  }}
                                >
                                  <SelectTrigger className="inline-flex h-7 text-[10px] font-extrabold text-primary bg-primary/5 hover:bg-primary/10 border-primary/10 hover:border-primary/20 rounded px-2 w-auto max-w-[180px] focus:ring-0 focus:ring-offset-0">
                                    <User className="w-2.5 h-2.5 mr-1" />
                                    <SelectValue placeholder="Sin contacto" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">Sin contacto</SelectItem>
                                    {contacts.filter(c => c.is_active).map(c => (
                                      <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                              {item.comentarios ? (
                                <p className="text-xs text-muted-foreground truncate">
                                  💡 {item.comentarios}
                                </p>
                              ) : (
                                <span className="text-[10px] text-muted-foreground/40 italic block">Sin observaciones</span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 self-end md:self-auto flex-shrink-0">
                          {isEditing ? (
                            <>
                              <Button variant="ghost" size="icon" onClick={(e) => handleSaveEdit(e)} disabled={saving}
                                className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50">
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                              </Button>
                              <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setEditId(null); }}
                                className="h-8 w-8 text-muted-foreground hover:text-foreground">
                                <X className="w-4 h-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button variant="ghost" size="icon" onClick={(e) => startEdit(item, e)}
                                className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent transition-all">
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setDeleteId(item.id); }}
                                className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all">
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {visibleCount < filtered.length && (
                    <div ref={sentinelRef} className="h-12 flex items-center justify-center py-4">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
      </Dialog>

      {/* ── DETAIL DIALOG (Muestra toda la info al clickear una tarjeta) ── */}
      <Dialog open={detailItem !== null} onOpenChange={(open) => !open && setDetailItem(null)}>
        <DialogContent 
          className={`sm:max-w-2xl max-h-[85vh] overflow-y-auto p-0 gap-0 border-2 transition-all duration-300
            ${detailItem?.derivar 
              ? 'border-emerald-500/35 bg-emerald-50/95 dark:bg-emerald-950/20' 
              : 'border-border bg-card'
            }`}
        >
          {detailItem && (
            <div className="p-6 space-y-6">
              <DialogHeader className="gap-3 text-left">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] font-bold uppercase bg-muted/40 px-2 py-0.5">
                      {detailItem.tipo}
                    </Badge>
                    <Badge 
                      variant={detailItem.derivar ? "default" : "secondary"} 
                      className={`text-[10px] font-black px-2 py-0.5 ${detailItem.derivar ? 'bg-emerald-500 text-white' : ''}`}
                    >
                      {detailItem.derivar ? 'SE DERIVA POR PAI' : 'NO DERIVAR'}
                    </Badge>
                  </div>
                  
                  {/* Actions inside detail dialog */}
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={(e) => { startEdit(detailItem, e); setDetailItem(null); }}>
                      <Edit className="w-3.5 h-3.5" /> Editar
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs text-destructive hover:bg-destructive/10" onClick={() => setDeleteId(detailItem.id)}>
                      <Trash2 className="w-3.5 h-3.5" /> Eliminar
                    </Button>
                  </div>
                </div>
                
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-primary leading-none flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" /> {detailItem.categoria}
                </p>
                <DialogTitle className="font-heading text-2xl font-black tracking-tight text-foreground uppercase leading-tight pt-1">
                  {detailItem.subtipo}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-5 border-t border-border/40 pt-5">
                {/* Contact Assignment Section */}
                {detailItem.derivar && (
                  <div className="p-4 rounded-xl bg-primary/5 border border-primary/10 space-y-2">
                    <p className="text-[10px] font-extrabold tracking-wider text-muted-foreground uppercase">
                      Contacto de Envío Predeterminado
                    </p>
                    {getAssignedContact(detailItem.subtipo) ? (
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                          {getAssignedContact(detailItem.subtipo).name.slice(0,2).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-foreground">
                            {getAssignedContact(detailItem.subtipo).name}
                          </p>
                          <p className="text-xs text-muted-foreground font-mono mt-0.5">
                            +{getAssignedContact(detailItem.subtipo).phone_number}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <p className="text-xs text-muted-foreground font-medium">
                          No hay ningún contacto asociado a este subtipo actualmente.
                        </p>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="w-fit text-xs h-8"
                          onClick={(e) => { startEdit(detailItem, e); setDetailItem(null); }}
                        >
                          Asignar Contacto ahora
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* Comments Section */}
                <div className="space-y-2">
                  <p className="text-[10px] font-extrabold tracking-wider text-muted-foreground uppercase">
                    Comentarios / Regla PAI / Instrucción
                  </p>
                  <div className="text-sm font-medium leading-relaxed text-pretty text-foreground bg-muted/40 dark:bg-muted/10 p-4 rounded-xl border border-border/40">
                    {detailItem.comentarios ? (
                      <p className="whitespace-pre-line text-sm font-semibold text-foreground/90">{detailItem.comentarios}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground font-medium">Sin observaciones o comentarios registrados para este subtipo.</p>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="flex justify-end pt-3 border-t border-border/40">
                <Button onClick={() => setDetailItem(null)} className="h-9 px-6 font-bold text-xs rounded-lg">
                  Entendido
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Agregar Subtipo al Catálogo</DialogTitle>
            <DialogDescription className="text-xs">
              Registrá un nuevo subtipo de trámite y su regla de derivación.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="add-catalog-tipo" className="text-xs font-semibold text-muted-foreground">Tipo *</Label>
              <Select value={addForm.tipo} onValueChange={(v) => setAddForm(p => ({ ...p, tipo: v }))}>
                <SelectTrigger id="add-catalog-tipo" className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RECLAMO">RECLAMO</SelectItem>
                  <SelectItem value="DENUNCIA">DENUNCIA</SelectItem>
                  <SelectItem value="CONSULTA">CONSULTA</SelectItem>
                  <SelectItem value="SUGERENCIA">SUGERENCIA</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-catalog-cat" className="text-xs font-semibold text-muted-foreground">Categoría *</Label>
              <Input 
                id="add-catalog-cat" 
                placeholder="Ej. MANTENIMIENTO VIAL" 
                value={addForm.categoria} 
                onChange={(e) => setAddForm(p => ({ ...p, categoria: e.target.value }))}
                className="h-10 uppercase" 
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-catalog-sub" className="text-xs font-semibold text-muted-foreground">Subtipo / Nombre de Trámite *</Label>
              <Input 
                id="add-catalog-sub" 
                placeholder="Ej. BACHEO" 
                value={addForm.subtipo} 
                onChange={(e) => setAddForm(p => ({ ...p, subtipo: e.target.value }))}
                className="h-10 uppercase" 
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-catalog-comm" className="text-xs font-semibold text-muted-foreground">Comentarios / Instrucción de Derivación</Label>
              <Input 
                id="add-catalog-comm" 
                placeholder="Ej. Derivar a Obras Públicas" 
                value={addForm.comentarios} 
                onChange={(e) => setAddForm(p => ({ ...p, comentarios: e.target.value }))}
                className="h-10" 
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Switch 
                checked={addForm.derivar} 
                onCheckedChange={(checked) => setAddForm(p => ({ ...p, derivar: checked }))}
                id="add-catalog-derivar"
                className="scale-75"
              />
              <Label htmlFor="add-catalog-derivar" className="text-xs font-semibold">Se deriva por PAI</Label>
            </div>
            
            {addForm.derivar && (
              <div className="space-y-1.5 pt-2 border-t border-border/40">
                <Label className="text-xs font-semibold text-muted-foreground">Asignar Contacto Predeterminado</Label>
                <Select value={addForm.contactId} onValueChange={(v) => setAddForm(p => ({ ...p, contactId: v }))}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Seleccionar contacto" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin contacto asignado</SelectItem>
                    {contacts.filter(c => c.is_active).map(c => (
                      <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)} className="flex-1">Cancelar</Button>
              <Button type="submit" disabled={saving} className="flex-1 gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Agregar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminás este subtipo?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción lo quitará del catálogo del PAI.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-white hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
