'use client';

import React, { useState, useEffect, useMemo } from 'react';
import * as LucideIcons from 'lucide-react';
import { 
    Plus, Trash2, Edit2, ChevronRight, ChevronDown, GripVertical, 
    Save, X, AlertCircle, CheckCircle2 
} from 'lucide-react';
import { modelsAdminApi } from '@/lib/api/admin';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import { motion, AnimatePresence } from 'framer-motion';

interface ContextMenuItem {
    id: string;
    parent_id: string | null;
    title: string;
    item_type: 'header' | 'submenu' | 'node_type' | 'ai_model' | 'static_node' | 'provider';
    action_value: string | null;
    icon: string | null;
    badge: string | null;
    sort_order: number;
    is_active: boolean;
    children?: ContextMenuItem[];
}

export function ContextMenuBuilder() {
    const [items, setItems] = useState<ContextMenuItem[]>([]);

    // DnD State (declared early so previewItems can read it)
    const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<{ id: string, position: 'top' | 'bottom' | 'inside' } | null>(null);

    // During drag, render the tree as if the drop already happened — items shift
    // live to show their new positions instead of a placeholder line.
    const previewItems = useMemo(() => {
        if (!draggedItemId || !dropTarget) return items;
        return computeMove(items, draggedItemId, dropTarget.id, dropTarget.position);
    }, [items, draggedItemId, dropTarget]);

    const tree = useMemo(() => buildTree(previewItems), [previewItems]);
    
    // Reference data
    const [models, setModels] = useState<any[]>([]);
    const [nodeTypes, setNodeTypes] = useState<any[]>([]);
    const [providers, setProviders] = useState<any[]>([]);
    const staticNodes = Object.keys(sharedRegistry).map(key => ({
        id: key,
        name: sharedRegistry[key as keyof typeof sharedRegistry].meta?.label || key,
        icon: sharedRegistry[key as keyof typeof sharedRegistry].meta?.icon || 'Box'
    }));

    // State
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState<{type: 'success'|'error', msg: string}|null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    
    // Form State
    const [editingItem, setEditingItem] = useState<ContextMenuItem | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);
    
    const defaultForm: Partial<ContextMenuItem> = {
        title: '',
        item_type: 'static_node',
        action_value: '',
        parent_id: null,
        icon: 'Box',
        badge: '',
        sort_order: 0,
        is_active: true
    };
    const [form, setForm] = useState<Partial<ContextMenuItem>>(defaultForm);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setLoading(true);
        try {
            const [fetchedItems, fetchedModels, fetchedTypes, fetchedProviders] = await Promise.all([
                modelsAdminApi.listContextMenuItems(),
                modelsAdminApi.listModels(),
                modelsAdminApi.listNodeTypes(),
                modelsAdminApi.listProviders()
            ]);
            
            setItems(fetchedItems);
            setModels(fetchedModels);
            setNodeTypes(fetchedTypes);
            setProviders(fetchedProviders);
            
            // Expand all by default
            setExpanded(new Set(fetchedItems.map((i: any) => i.id)));
        } catch (err: any) {
            console.error(err);
            setStatus({ type: 'error', msg: 'Failed to load menu items.' });
        } finally {
            setLoading(false);
        }
    }

    function buildTree(flatItems: ContextMenuItem[], parentId: string | null = null): ContextMenuItem[] {
        return [...flatItems]
            .filter(item => item.parent_id === parentId)
            .sort((a, b) => (a.sort_order - b.sort_order) || a.id.localeCompare(b.id))
            .map(item => ({
                ...item,
                children: buildTree(flatItems, item.id)
            }));
    }

    // Pure move: returns a new flat items array with sourceId moved to the
    // requested position relative to targetId. Used both for live drag preview
    // and the final committed move on drop.
    function computeMove(
        flatItems: ContextMenuItem[],
        sourceId: string,
        targetId: string,
        position: 'top' | 'bottom' | 'inside'
    ): ContextMenuItem[] {
        if (sourceId === targetId) return flatItems;
        const next = flatItems.map(i => ({ ...i }));
        const source = next.find(i => i.id === sourceId);
        const target = next.find(i => i.id === targetId);
        if (!source || !target) return flatItems;

        if (position === 'inside') {
            source.parent_id = targetId;
            const siblings = next.filter(i => i.parent_id === targetId && i.id !== sourceId);
            source.sort_order = siblings.length > 0
                ? Math.max(...siblings.map(s => s.sort_order)) + 10
                : 0;
        } else {
            source.parent_id = target.parent_id;
            source.sort_order = position === 'top'
                ? target.sort_order - 5
                : target.sort_order + 5;
        }

        return normalizeSortOrdersPure(next);
    }

    function normalizeSortOrdersPure(flatItems: ContextMenuItem[]): ContextMenuItem[] {
        const result = flatItems.map(i => ({ ...i }));
        const parents = Array.from(new Set(result.map(i => i.parent_id)));
        parents.forEach(pid => {
            const siblings = result
                .filter(i => i.parent_id === pid)
                .sort((a, b) => (a.sort_order - b.sort_order) || a.id.localeCompare(b.id));
            siblings.forEach((item, idx) => {
                item.sort_order = idx * 10;
            });
        });
        return result;
    }

    // DnD Handlers
    const handleDragStart = (e: React.DragEvent, id: string) => {
        e.stopPropagation();
        setDraggedItemId(id);
        e.dataTransfer.setData('itemId', id);
        e.dataTransfer.effectAllowed = 'move';
        // No setDragImage — let the browser use its default (a translucent
        // snapshot of the row) so the user sees the layer being dragged out.
    };

    const handleDragOver = (e: React.DragEvent, targetId: string, itemType: string) => {
        e.preventDefault();
        e.stopPropagation();
        if (draggedItemId === targetId) return;

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const y = e.clientY - rect.top;
        const h = rect.height;

        let position: 'top' | 'bottom' | 'inside' = 'inside';
        const canHaveChildren = ['submenu', 'provider'].includes(itemType);

        if (canHaveChildren) {
            if (y < h * 0.25) position = 'top';
            else if (y > h * 0.75) position = 'bottom';
            else position = 'inside';
        } else {
            position = y < h * 0.5 ? 'top' : 'bottom';
        }

        // Parent-into-child safeguard — can't drop a folder inside its own descendant.
        if (position === 'inside' && isChildOf(draggedItemId!, targetId, items)) {
            setDropTarget(prev => prev === null ? prev : null);
            return;
        }

        // Auto-expand a folder when hovering "inside" so the user sees the live shift.
        if (position === 'inside' && canHaveChildren) {
            setExpanded(prev => prev.has(targetId) ? prev : new Set([...prev, targetId]));
        }

        // Skip no-op updates so dragover doesn't churn re-renders pixel-by-pixel.
        setDropTarget(prev => {
            if (prev?.id === targetId && prev.position === position) return prev;
            return { id: targetId, position };
        });
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!draggedItemId || !dropTarget) {
            setDraggedItemId(null);
            setDropTarget(null);
            return;
        }

        const sourceId = draggedItemId;
        const targetId = dropTarget.id;
        const position = dropTarget.position;

        setDraggedItemId(null);
        setDropTarget(null);

        if (sourceId === targetId) return;

        // previewItems already reflects the desired final state — commit it.
        setItems(prev => computeMove(prev, sourceId, targetId, position));
        setHasChanges(true);
    };

    const isChildOf = (parentId: string, targetId: string, allItems: ContextMenuItem[]): boolean => {
        let current = allItems.find(i => i.id === targetId);
        while (current && current.parent_id) {
            if (current.parent_id === parentId) return true;
            current = allItems.find(i => i.id === current!.parent_id);
        }
        return false;
    };

    const toggleExpand = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const next = new Set(expanded);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExpanded(next);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        const prevItems = [...items];
        try {
            if (isCreating) {
                // Calculate next sort_order for siblings
                const siblings = items.filter(i => i.parent_id === form.parent_id);
                const nextOrder = siblings.length > 0 
                    ? Math.max(...siblings.map(s => s.sort_order)) + 1 
                    : 0;
                
                // Strip children before creating
                const { children, ...cleanForm } = form as any;
                const newItem = await modelsAdminApi.createContextMenuItem({ ...cleanForm, sort_order: nextOrder });
                setItems(prev => [...prev, newItem]);
                setStatus({ type: 'success', msg: 'Item created.' });
            } else if (editingItem) {
                // Strip children before updating
                const { children, ...cleanForm } = form as any;
                const updatedItem = await modelsAdminApi.updateContextMenuItem(editingItem.id, cleanForm);
                setItems(prev => prev.map(i => i.id === editingItem.id ? updatedItem : i));
                setStatus({ type: 'success', msg: 'Item updated.' });
            }
            setEditingItem(null);
            setIsCreating(false);
            setForm(defaultForm);
            // Invalidate global menu cache so canvas is updated
            useAppStore.getState().fetchMenuData(true);
            // No need to loadData() as we updated the state directly
        } catch (err: any) {
            setItems(prevItems);
            setStatus({ type: 'error', msg: err.message });
        }
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm('Are you sure you want to delete this item and all its children?')) return;
        
        const prevItems = [...items];
        // Recursive helper to get all IDs to delete
        const getDescendantIds = (parentId: string, allItems: ContextMenuItem[]): string[] => {
            const children = allItems.filter(i => i.parent_id === parentId);
            return [parentId, ...children.flatMap(c => getDescendantIds(c.id, allItems))];
        };
        const idsToRemove = getDescendantIds(id, items);

        try {
            // Optimistic update
            setItems(prev => prev.filter(i => !idsToRemove.includes(i.id)));
            
            await modelsAdminApi.deleteContextMenuItem(id);
            setStatus({ type: 'success', msg: 'Item deleted.' });
            // Invalidate global menu cache
            useAppStore.getState().fetchMenuData(true);
        } catch (err: any) {
            setItems(prevItems);
            setStatus({ type: 'error', msg: err.message });
        }
    };

    const startEdit = (item: ContextMenuItem, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingItem(item);
        setIsCreating(false);
        setForm(item);
    };

    const startCreate = (parentId: string | null = null) => {
        setIsCreating(true);
        setEditingItem(null);
        setForm({ ...defaultForm, parent_id: parentId });
    };

    // Robust reordering based on array indices
    const moveItemWithArrow = (item: ContextMenuItem, direction: 'up' | 'down', e: React.MouseEvent) => {
        e.stopPropagation();
        
        // 1. Get current sorted siblings
        const siblings = items
            .filter(i => i.parent_id === item.parent_id)
            .sort((a, b) => (a.sort_order - b.sort_order) || a.id.localeCompare(b.id));
        
        const currentIndex = siblings.findIndex(i => i.id === item.id);
        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

        if (targetIndex < 0 || targetIndex >= siblings.length) return;

        // 2. Perform a true array move
        const updatedSiblings = [...siblings];
        const [movedItem] = updatedSiblings.splice(currentIndex, 1);
        updatedSiblings.splice(targetIndex, 0, movedItem);

        // 3. Assign new sort_orders based on array position
        const updates = updatedSiblings.map((sib, index) => ({
            id: sib.id,
            sort_order: index
        }));

        // 4. Update local state immediately and mark as dirty
        setItems(prev => prev.map(i => {
            const update = updates.find(u => u.id === i.id);
            return update ? { ...i, sort_order: update.sort_order } : i;
        }));
        
        setHasChanges(true); // Queue for manual save
    };

    const refreshProviderModels = async (providerItem: ContextMenuItem) => {
        if (!providerItem.action_value) return;
        setLoading(true);
        setStatus({ type: 'success', msg: `Syncing models for ${providerItem.title}...` });
        
        try {
            // 1. Find all models for this provider
            const providerModels = models.filter(m => m.provider_id === providerItem.action_value);
            
            // 2. Get existing children to avoid duplicates
            const existingChildren = items.filter(i => i.parent_id === providerItem.id);
            const existingActionValues = new Set(existingChildren.map(i => i.action_value));

            // 3. Prepare new items
            const newItems: any[] = [];
            for (let m of providerModels) {
                if (!existingActionValues.has(m.id.toString())) {
                    const newItem: any = {
                        title: m.display_name,
                        item_type: 'ai_model' as const,
                        action_value: m.id.toString(),
                        icon: m.providers?.logo_url || null,
                        badge: m.is_beta ? 'Beta' : null,
                        parent_id: providerItem.id,
                        sort_order: (existingChildren.length + newItems.length)
                    };
                    newItems.push(newItem);
                }
            }

            if (newItems.length === 0) {
                setStatus({ type: 'success', msg: 'No new models found.' });
                setLoading(false);
                return;
            }

            // 4. Create items one by one
            const createdItems: any[] = [];
            for (let item of newItems) {
                // Explicitly ensure no children property
                const { children, ...cleanItem } = item;
                const created = await modelsAdminApi.createContextMenuItem(cleanItem);
                createdItems.push(created);
            }

            setItems(prev => [...prev, ...createdItems]);
            setStatus({ type: 'success', msg: `Added ${createdItems.length} models.` });
            setHasChanges(true);
        } catch (err: any) {
            console.error('Failed to refresh models', err);
            setStatus({ type: 'error', msg: `Refresh failed: ${err.message}` });
        } finally {
            setLoading(false);
        }
    };

    const handleSync = async () => {
        if (!hasChanges) return;
        setLoading(true);
        setStatus({ type: 'success', msg: 'Saving changes...' });
        
        try {
            // Robustly strip ALL non-database fields (like 'children') 
            // even if they were added via buildTree or other client logic
            const itemsToSync = items.map(item => {
                const { children, ...cleanItem } = item as any;
                return cleanItem;
            });

            await modelsAdminApi.reorder(itemsToSync);
            
            setHasChanges(false);
            setStatus({ type: 'success', msg: 'Changes saved successfully!' });
            
            // Invalidate global menu cache for canvas
            useAppStore.getState().fetchMenuData(true);
        } catch (err: any) {
            console.error('Failed to sync', err);
            setStatus({ type: 'error', msg: `Save failed: ${err.message}` });
        } finally {
            setLoading(false);
        }
    };

    const renderTree = (nodes: ContextMenuItem[], level = 0) => {
        return nodes.map(node => {
            const Icon = (LucideIcons[node.icon as keyof typeof LucideIcons] as React.ComponentType<any>) || LucideIcons.Box;
            const hasChildren = node.children && node.children.length > 0;
            const isExpanded = expanded.has(node.id);

            const isDraggingThis = draggedItemId === node.id;
            const isInsideTarget = dropTarget?.id === node.id && dropTarget.position === 'inside';

            return (
                <div key={node.id} className="flex flex-col relative text-left">
                    <motion.div
                        layoutId={node.id}
                        transition={{ type: 'spring', stiffness: 500, damping: 40, mass: 0.6 }}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className={cn(
                            "relative group cursor-grab active:cursor-grabbing",
                            isDraggingThis && "z-30 scale-[1.02]"
                        )}
                        draggable
                        onDragStart={(e) => handleDragStart(e as any, node.id)}
                        onDragOver={(e) => handleDragOver(e as any, node.id, node.item_type)}
                        onDrop={(e) => handleDrop(e as any)}
                        onDragEnd={() => {
                            setDraggedItemId(null);
                            setDropTarget(null);
                        }}
                    >
                        <div className={cn(
                            "flex items-center justify-between p-3 rounded-xl border border-transparent hover:border-white/10 hover:bg-white/5 transition-all group/row",
                            editingItem?.id === node.id && "bg-accent-primary/5 border-accent-primary/30",
                            isInsideTarget && "bg-accent-primary/10 border-accent-primary/40 ring-1 ring-accent-primary/30",
                            isDraggingThis && "bg-white/10 border-accent-primary/40 ring-2 ring-accent-primary/40 shadow-2xl shadow-black/50"
                        )}>
                        <div className="flex items-center gap-3">
                            <div className="p-1 text-content-tertiary/40 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                <GripVertical className="w-4 h-4" />
                            </div>
                            
                            {['submenu', 'provider'].includes(node.item_type) && (
                                <button 
                                    onClick={(e) => toggleExpand(node.id, e)}
                                    className="p-1 hover:bg-white/10 rounded transition-colors"
                                >
                                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                </button>
                            )}
                            
                            {Icon && (
                                <div className="w-8 h-8 rounded-lg bg-black/40 border border-white/5 flex items-center justify-center shadow-inner group-hover/row:scale-110 transition-transform">
                                    {node.icon?.startsWith('http') ? (
                                        <img src={node.icon} alt="" className="w-5 h-5 object-contain" />
                                    ) : (
                                        <Icon className="w-4 h-4 text-content-secondary" />
                                    )}
                                </div>
                            )}
                            
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-content-primary">{node.title}</span>
                                    {node.badge && (
                                        <span className="px-1.5 py-0.5 bg-accent-primary/20 text-accent-primary text-[9px] font-bold uppercase rounded">{node.badge}</span>
                                    )}
                                </div>
                                <div className="text-[10px] text-content-tertiary font-mono uppercase mt-0.5">
                                    {node.item_type} • {node.action_value || 'No Action'}
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-1 opacity-10 group-hover:opacity-100 transition-opacity">
                            <button onClick={(e) => moveItemWithArrow(node, 'up', e)} className="p-1.5 hover:bg-white/10 rounded text-content-tertiary">
                                <LucideIcons.ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={(e) => moveItemWithArrow(node, 'down', e)} className="p-1.5 hover:bg-white/10 rounded text-content-tertiary">
                                <LucideIcons.ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            {['submenu', 'provider'].includes(node.item_type) && (
                                <div className="flex items-center gap-1">
                                    <button 
                                        onClick={() => startCreate(node.id)} 
                                        className="p-1.5 hover:bg-white/10 rounded text-content-tertiary"
                                        title="Add child"
                                    >
                                        <Plus className="w-3.5 h-3.5" />
                                    </button>
                                    {node.item_type === 'provider' && (
                                        <button 
                                            onClick={() => refreshProviderModels(node)} 
                                            className="p-1.5 hover:bg-white/10 rounded text-content-tertiary hover:text-accent-primary transition-colors"
                                            title="Sync provider models"
                                        >
                                            <LucideIcons.RefreshCw className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>
                            )}
                            <button onClick={(e) => startEdit(node, e)} className="p-1.5 hover:bg-white/10 rounded text-content-tertiary">
                                <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={(e) => handleDelete(node.id, e)} className="p-1.5 hover:bg-red-500/20 rounded text-red-400">
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                    
                    {['submenu', 'provider'].includes(node.item_type) && hasChildren && (
                        <AnimatePresence initial={false}>
                            {isExpanded && (
                                <motion.div
                                    key="children"
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2, ease: 'easeOut' }}
                                    style={{ overflow: 'hidden' }}
                                    className="flex flex-col ml-4 border-l border-white/5 pl-2"
                                >
                                    {renderTree(node.children!, level + 1)}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    )}
                    </motion.div>
                </div>
            );
        });
    };

    // Helper for padding
    function max(a: number, b: number) { return a > b ? a : b; }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left: Tree View */}
            <div className="lg:col-span-2 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-xl font-black text-content-primary uppercase tracking-tighter">Menu Structure</h3>
                        <p className="text-xs text-content-tertiary">Organize your canvas context menu.</p>
                    </div>
                    <div className="flex items-center gap-3">
                        {hasChanges && (
                            <button 
                                onClick={handleSync}
                                className="px-5 py-2.5 bg-accent-primary text-white hover:bg-accent-primary/80 border border-accent-primary/30 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)] animate-pulse hover:animate-none group flex items-center gap-2"
                            >
                                <LucideIcons.Save className="w-4 h-4 group-hover:scale-110 transition-transform" /> Save Changes
                            </button>
                        )}
                        <button 
                            onClick={() => startCreate(null)}
                            className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-widest transition-colors flex items-center gap-2"
                        >
                            <Plus className="w-4 h-4" /> Root Item
                        </button>
                    </div>
                </div>

                <div className="bg-surface-elevated border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
                    {loading ? (
                        <div className="p-12 flex justify-center"><LucideIcons.Loader2 className="w-6 h-6 animate-spin text-accent-primary" /></div>
                    ) : tree.length > 0 ? (
                        <div className="flex flex-col p-2">
                            <AnimatePresence mode="popLayout">
                                {renderTree(tree)}
                            </AnimatePresence>
                        </div>
                    ) : (
                        <div className="p-12 text-center text-content-tertiary text-sm">
                            No menu items found. Create your first root item.
                        </div>
                    )}
                </div>
            </div>

            {/* Right: Editor Form */}
            <div className="lg:col-span-1">
                <div className="sticky top-24 bg-surface-elevated border border-white/10 rounded-2xl p-6 shadow-2xl">
                    <h3 className="text-lg font-black text-content-primary uppercase tracking-tighter mb-6">
                        {isCreating ? 'Create Item' : editingItem ? 'Edit Item' : 'Editor'}
                    </h3>
                    
                    {!isCreating && !editingItem ? (
                        <div className="py-12 text-center text-content-tertiary text-sm border border-dashed border-white/10 rounded-xl">
                            Select an item to edit or create a new one.
                        </div>
                    ) : (
                        <form onSubmit={handleSave} className="space-y-4">
                            <Input
                                label="Title"
                                value={form.title || ''}
                                onChange={e => setForm({ ...form, title: e.target.value })}
                                required
                            />
                            
                            <Select
                                label="Item Type"
                                value={form.item_type || ''}
                                onChange={e => setForm({ ...form, item_type: e.target.value as any })}
                                options={[
                                    { id: 'header', display_name: 'Header (Label)' },
                                    { id: 'submenu', display_name: 'Submenu (Folder)' },
                                    { id: 'provider', display_name: 'AI Model Provider (Folder)' },
                                    { id: 'static_node', display_name: 'Static Node (Ephemeral)' },
                                    { id: 'ai_model', display_name: 'AI Model' },
                                    { id: 'node_type', display_name: 'Node Type (Category)' },
                                ]}
                            />

                            {/* Action Value Contextual Input */}
                            {form.item_type === 'static_node' && (
                                <Select
                                    label="Target Node"
                                    value={form.action_value || ''}
                                    onChange={e => {
                                        const node = staticNodes.find(n => n.id === e.target.value);
                                        setForm({ 
                                            ...form, 
                                            action_value: e.target.value, 
                                            title: node?.name || form.title,
                                            icon: node?.icon || form.icon 
                                        });
                                    }}
                                    options={[
                                        ...staticNodes.map(n => ({ id: n.id, display_name: n.name }))
                                    ]}
                                    placeholder="Select Node..."
                                    required
                                />
                            )}
                            
                            {form.item_type === 'ai_model' && (
                                <Select
                                    label="Target AI Model"
                                    value={form.action_value || ''}
                                    onChange={e => {
                                        const model = models.find(m => m.id.toString() === e.target.value);
                                        setForm({ 
                                            ...form, 
                                            action_value: e.target.value,
                                            title: model?.display_name || form.title,
                                            icon: model?.providers?.logo_url || form.icon
                                        });
                                    }}
                                    options={[
                                        ...models.map(m => ({ id: m.id.toString(), display_name: m.display_name }))
                                    ]}
                                    placeholder="Select Model..."
                                    required
                                />
                            )}
                            
                            {form.item_type === 'node_type' && (
                                <Select
                                    label="Target Node Type"
                                    value={form.action_value || ''}
                                    onChange={e => {
                                        const nt = nodeTypes.find(m => m.id === e.target.value);
                                        setForm({
                                            ...form,
                                            action_value: e.target.value,
                                            title: nt?.display_name || form.title,
                                            icon: nt?.icon_reference || form.icon
                                        });
                                    }}
                                    options={[
                                        ...nodeTypes.map(m => ({ id: m.id, display_name: m.display_name }))
                                    ]}
                                    placeholder="Select Node Type..."
                                    required
                                />
                            )}

                            {form.item_type === 'provider' && (
                                <Select
                                    label="Select Provider"
                                    value={form.action_value || ''}
                                    onChange={e => {
                                        const provider = providers.find(p => p.id === e.target.value);
                                        setForm({ 
                                            ...form, 
                                            action_value: e.target.value,
                                            title: provider?.name || form.title,
                                            icon: provider?.logo_url || form.icon
                                        });
                                    }}
                                    options={providers.map(p => ({ id: p.id, display_name: p.name }))}
                                />
                            )}

                            {!['header', 'provider', 'ai_model'].includes(form.item_type as string) && (
                                <div className="grid grid-cols-2 gap-4">
                                    <Input
                                        label="Icon (Lucide)"
                                        value={form.icon || ''}
                                        onChange={e => setForm({ ...form, icon: e.target.value })}
                                    />
                                    <Input
                                        label="Badge (Optional)"
                                        value={form.badge || ''}
                                        onChange={e => setForm({ ...form, badge: e.target.value })}
                                        placeholder="e.g. Beta, New"
                                    />
                                </div>
                            )}
                            
                            <Select
                                label="Parent folder"
                                value={form.parent_id || 'root'}
                                onChange={e => setForm({ ...form, parent_id: e.target.value === 'root' ? null : e.target.value })}
                                options={[
                                    { id: 'root', display_name: '-- Root Level --' },
                                    ...items.filter(i => ['submenu', 'provider'].includes(i.item_type)).map(i => ({ id: i.id, display_name: i.title }))
                                ]}
                            />

                            <div className="pt-4 flex gap-3">
                                <button type="submit" className="flex-1 bg-accent-primary text-white py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-accent-primary/80 transition-colors">
                                    Save Item
                                </button>
                                <button type="button" onClick={() => { setIsCreating(false); setEditingItem(null); }} className="px-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-content-tertiary transition-colors">
                                    Cancel
                                </button>
                            </div>
                        </form>
                    )}
                    
                    {status && (
                        <div className={cn("mt-6 p-4 rounded-xl flex gap-3 text-sm", status.type === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400')}>
                            {status.type === 'success' ? <CheckCircle2 className="w-5 h-5 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 flex-shrink-0" />}
                            <span className="font-medium">{status.msg}</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
