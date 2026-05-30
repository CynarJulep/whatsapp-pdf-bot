import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, Plus, RefreshCw, Edit, Trash2, Save, X, Loader2, Play
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
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

export default function SubtypesCatalogDialog({ 
  open, 
  onOpenChange, 
  catalog, 
  loading, 
  onReload, 
  showToast, 
  supabase,
  prefill,
  onClearPrefill
}) {
  const [search, setSearch] = useState('');
  const [tipoFilter, setTipoFilter] = useState('all');
  const [derivacionFilter, setDerivacionFilter] = useState('all');
  
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ tipo: 'RECLAMO', categoria: '', subtipo: '', derivar: true, comentarios: '' });
  
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({ tipo: 'RECLAMO', categoria: '', subtipo: '', derivar: true, comentarios: '' });
  
  const [deleteId, setDeleteId] = useState(null);
  const [saving, setSaving] = useState(false);

  // Handle prefill from new uploaded PDF subtitypes
  useEffect(() => {
    if (prefill && open) {
      setAddForm({
        tipo: prefill.tipo || 'RECLAMO',
        categoria: prefill.categoria || '',
        subtipo: prefill.subtipo || '',
        derivar: prefill.derivar !== undefined ? prefill.derivar : true,
        comentarios: prefill.comentarios || ''
      });
      setAddOpen(true);
      if (onClearPrefill) onClearPrefill();
    }
  }, [prefill, open, onClearPrefill]);

  // Filter logic
  const filtered = useMemo(() => {
    return catalog.filter(item => {
      const term = search.toLowerCase().trim();
      const matchesSearch = !term ||
        (item.tipo || '').toLowerCase().includes(term) ||
        (item.categoria || '').toLowerCase().includes(term) ||
        (item.subtipo || '').toLowerCase().includes(term) ||
        (item.comentarios || '').toLowerCase().includes(term);
        
      const matchesTipo = tipoFilter === 'all' || item.tipo === tipoFilter;
      const matchesDerivacion = derivacionFilter === 'all' || 
        (derivacionFilter === 'derivar' && item.derivar) ||
        (derivacionFilter === 'no' && !item.derivar);
        
      return matchesSearch && matchesTipo && matchesDerivacion;
    });
  }, [catalog, search, tipoFilter, derivacionFilter]);

  const uniqueTipos = useMemo(() => {
    const set = new Set();
    catalog.forEach(item => {
      if (item.tipo) set.add(item.tipo);
    });
    return [...set].sort();
  }, [catalog]);

  const handleToggleDerivar = async (item) => {
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

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!addForm.categoria.trim() || !addForm.subtipo.trim()) {
      showToast('Completá Categoría y Subtipo', 'error');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('subtypes_catalog')
        .insert([{
          tipo: addForm.tipo,
          categoria: addForm.categoria.trim().toUpperCase(),
          subtipo: addForm.subtipo.trim().toUpperCase(),
          derivar: addForm.derivar,
          comentarios: addForm.comentarios.trim() || null
        }]);
      if (error) throw error;
      showToast('Subtipo agregado al catálogo ✓');
      setAddForm({ tipo: 'RECLAMO', categoria: '', subtipo: '', derivar: true, comentarios: '' });
      setAddOpen(false);
      onReload();
    } catch (err) {
      showToast(err.message.includes('23505') ? 'Este subtipo ya existe en el catálogo' : err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (item) => {
    setEditId(item.id);
    setEditForm({
      tipo: item.tipo,
      categoria: item.categoria,
      subtipo: item.subtipo,
      derivar: item.derivar,
      comentarios: item.comentarios || ''
    });
  };

  const handleSaveEdit = async () => {
    if (!editForm.categoria.trim() || !editForm.subtipo.trim()) {
      showToast('Completá Categoría y Subtipo', 'error');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('subtypes_catalog')
        .update({
          tipo: editForm.tipo,
          categoria: editForm.categoria.trim().toUpperCase(),
          subtipo: editForm.subtipo.trim().toUpperCase(),
          derivar: editForm.derivar,
          comentarios: editForm.comentarios.trim() || null
        })
        .eq('id', editId);
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
      const { error } = await supabase
        .from('subtypes_catalog')
        .delete()
        .eq('id', deleteId);
      if (error) throw error;
      showToast('Subtipo eliminado del catálogo');
      setDeleteId(null);
      onReload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pr-6">
              <div>
                <DialogTitle className="text-xl font-bold flex items-center gap-2">
                  <Search className="w-5 h-5 text-primary" />
                  Buscador y Catálogo PAI
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Gestión centralizada de subtipos de reclamos, áreas y reglas de derivación.
                </DialogDescription>
              </div>
              <Button onClick={() => setAddOpen(true)} size="sm" className="gap-1.5 text-sm h-9 self-start sm:self-auto">
                <Plus className="w-4 h-4" /> Agregar Subtipo
              </Button>
            </div>
          </DialogHeader>

          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center mt-2 pb-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder="Buscar por subtipo, categoría o comentarios..." 
                value={search} 
                onChange={(e) => setSearch(e.target.value)} 
                className="pl-10 h-10 text-sm"
              />
            </div>

            <Select value={tipoFilter} onValueChange={setTipoFilter}>
              <SelectTrigger className="w-[180px] h-10 text-sm">
                <SelectValue placeholder="Filtrar por Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                {uniqueTipos.map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={derivacionFilter} onValueChange={setDerivacionFilter}>
              <SelectTrigger className="w-[180px] h-10 text-sm">
                <SelectValue placeholder="¿Se deriva?" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">¿Se deriva? (todos)</SelectItem>
                <SelectItem value="derivar">Se deriva</SelectItem>
                <SelectItem value="no">No se deriva</SelectItem>
              </SelectContent>
            </Select>
            
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
          <div className="mt-2">
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
            ) : (
              <ScrollArea className="h-[50vh] rounded-2xl border bg-card shadow-inner">
                <div className="p-2 space-y-1.5">
                  {filtered.map(item => {
                    const isEditing = editId === item.id;
                    return (
                      <div 
                        key={item.id} 
                        className={`flex flex-col md:flex-row md:items-center gap-4 p-4 rounded-xl border transition-all text-sm font-medium
                          ${isEditing 
                            ? 'border-primary/30 bg-primary/5' 
                            : item.derivar 
                              ? 'border-emerald-500/10 bg-emerald-500/[0.01] hover:bg-emerald-500/[0.03] dark:bg-emerald-500/[0.005] dark:hover:bg-emerald-500/[0.02]' 
                              : 'border-transparent hover:border-border hover:bg-muted/40'
                          }`}
                      >
                        {isEditing ? (
                          <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3 bg-muted/20 p-3 rounded-lg border border-primary/10">
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
                                placeholder="Ej: IMUSA" 
                                className="h-8 text-xs uppercase" 
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] font-semibold text-muted-foreground">Subtipo (Trámite)</Label>
                              <Input 
                                value={editForm.subtipo} 
                                onChange={(e) => setEditForm(p => ({ ...p, subtipo: e.target.value }))}
                                placeholder="Ej: CASTRACION" 
                                className="h-8 text-xs uppercase" 
                              />
                            </div>
                            <div className="md:col-span-3 space-y-1">
                              <Label className="text-[10px] font-semibold text-muted-foreground">Instrucción / Comentario de Derivación</Label>
                              <Input 
                                value={editForm.comentarios} 
                                onChange={(e) => setEditForm(p => ({ ...p, comentarios: e.target.value }))}
                                placeholder="Instrucciones de envío (ej. Derivar a Melina Salzmann)" 
                                className="h-8 text-xs" 
                              />
                            </div>
                            <div className="md:col-span-3 flex items-center gap-2 pt-1">
                              <Switch 
                                checked={editForm.derivar} 
                                onCheckedChange={(checked) => setEditForm(p => ({ ...p, derivar: checked }))}
                                id={`edit-derivar-${item.id}`}
                                className="scale-75"
                              />
                              <Label htmlFor={`edit-derivar-${item.id}`} className="text-xs font-semibold">Se deriva por PAI</Label>
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
                                  className={`text-[9px] font-extrabold h-4 px-1.5 ${item.derivar ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'text-muted-foreground hover:bg-muted'} cursor-pointer select-none`}
                                  onClick={() => handleToggleDerivar(item)}
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

                            {/* Comentarios */}
                            <div className="md:col-span-5 min-w-0">
                              {item.comentarios ? (
                                <p className="text-xs text-muted-foreground truncate">
                                  💡 {item.comentarios}
                                </p>
                              ) : (
                                <span className="text-[10px] text-muted-foreground/40 italic">Sin observaciones</span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 self-end md:self-auto flex-shrink-0">
                          {isEditing ? (
                            <>
                              <Button variant="ghost" size="icon" onClick={handleSaveEdit} disabled={saving}
                                className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50">
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => setEditId(null)}
                                className="h-8 w-8 text-muted-foreground hover:text-foreground">
                                <X className="w-4 h-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button variant="ghost" size="icon" onClick={() => startEdit(item)}
                                className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent transition-all">
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => setDeleteId(item.id)}
                                className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all">
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
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
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
