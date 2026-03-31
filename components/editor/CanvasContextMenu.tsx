'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as RadixContextMenu from '@radix-ui/react-context-menu';
import { 
    Root, Trigger, Portal, Content, Item, 
    Sub, SubTrigger, SubContent 
} from '@radix-ui/react-context-menu';
import { NodeType, AiModel } from '@/lib/nodes/types';
import { useAppStore } from '@/lib/store/app-store';
import * as Icons from 'lucide-react';
import { Plus, ChevronRight, Search as SearchIcon, Loader2, Inbox, LayoutGrid, Box } from 'lucide-react';

interface ContextMenuItem {
    id: string;
    parent_id: string | null;
    title: string;
    item_type: 'header' | 'submenu' | 'node_type' | 'ai_model' | 'static_node' | 'provider';
    action_value: string | null;
    icon: string | null;
    badge: string | null;
    sort_order: number;
    children?: ContextMenuItem[];
}

interface CanvasContextMenuProps {
    position: { x: number; y: number };
    onSelectNode: (type: NodeType, position: { x: number; y: number }, nodeTypeId?: string, modelId?: number) => void;
    onClose: () => void;
    models?: AiModel[];
}

const MENU_WIDTH = 260;
const MENU_PADDING = 8;

export default function CanvasContextMenu({
    position,
    onSelectNode,
    onClose,
    models,
}: CanvasContextMenuProps) {
    const triggerRef = useRef<HTMLSpanElement>(null);
    const tree = useAppStore(state => state.menuTree);
    const flatList = useAppStore(state => state.menuFlat);
    const isMenuLoading = useAppStore(state => state.isMenuLoading);
    
    const [searchQuery, setSearchQuery] = useState('');
    const searchInputRef = useRef<HTMLInputElement>(null);

    // No longer needs on-demand fetch here as it is pre-fetched by SharedWorkflowEditor

    // Fire a synthetic contextmenu event on the invisible trigger on mount
    useEffect(() => {
        if (!triggerRef.current) return;
        const event = new MouseEvent('contextmenu', {
            bubbles: true, 
            cancelable: true, 
            clientX: position.x, 
            clientY: position.y,
        });
        // Flag it so the parent knows not to trigger another context menu
        Object.defineProperty(event, '_isSynthetic', { value: true });
        triggerRef.current.dispatchEvent(event);
    }, []);

    const handleNodeClick = (item: ContextMenuItem) => {
        // Assume non-static types spawn an AI node that expects the configuration value
        let typePath: NodeType = 'ai_generator'; 
        let nodeTypeId: string | undefined = item.action_value || undefined;
        let modelId: number | undefined = undefined;

        if (item.item_type === 'static_node') {
            typePath = item.action_value as NodeType || 'prompt';
            nodeTypeId = undefined;
        } else if (item.item_type === 'ai_model') {
            // Find the model to get its node_type_id correctly
            const modelIdNum = parseInt(item.action_value || '0');
            const model = models?.find(m => m.id === modelIdNum);
            if (model) {
                nodeTypeId = model.node_type_id || undefined;
                modelId = model.id;
            } else {
                // Fallback: If model catalog hasn't loaded yet, we still treat action_value as a model_id
                // though this is less ideal as we might guess the wrong node_type_id
                modelId = modelIdNum;
                nodeTypeId = 'image_generation'; // Default safe fallback
            }
        }
        
        onSelectNode(typePath, position, nodeTypeId, modelId);
        onClose();
    };

    const searchResults = useMemo(() => {
        if (!searchQuery) return [];
        const query = searchQuery.toLowerCase();
        
        // Filter by type and query
        const filtered = flatList.filter(item => 
            ['static_node', 'ai_model', 'node_type'].includes(item.item_type) &&
            item.title.toLowerCase().includes(query)
        );

        // Deduplicate by title to avoid visual clutter in search results
        const seen = new Set<string>();
        return filtered.filter(item => {
            const lowerTitle = item.title.toLowerCase();
            if (seen.has(lowerTitle)) return false;
            seen.add(lowerTitle);
            return true;
        });
    }, [searchQuery, flatList]);

    const renderIcon = (iconName: string | null) => {
        if (!iconName) return <Box className="w-4 h-4" />;
        
        // Check if it's a URL (http or https)
        if (iconName.startsWith('http')) {
            return <img src={iconName} alt="" className="w-4 h-4 object-contain rounded-sm" />;
        }

        const iconComponent = (Icons as any)[iconName] || Box;
        const FinalIcon = iconComponent;
        return <FinalIcon className="w-4 h-4" />;
    };

    const renderItem = (item: ContextMenuItem) => {
        return (
            <Item
                key={item.id}
                onSelect={() => handleNodeClick(item)}
                className="w-full px-2 py-2 flex items-center justify-between transition-colors duration-100 group outline-none cursor-pointer data-[highlighted]:bg-white/10 rounded-lg"
            >
                <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-md flex items-center justify-center bg-white/5 border border-white/10 group-data-[highlighted]:scale-110 group-data-[highlighted]:bg-accent-primary/20 group-data-[highlighted]:border-accent-primary/30 group-data-[highlighted]:text-accent-primary transition-all duration-150 text-content-tertiary shadow-inner">
                        {renderIcon(item.icon)}
                    </div>
                    <span className="text-xs font-semibold text-content-secondary group-data-[highlighted]:text-content-primary">
                        {item.title}
                    </span>
                </div>
                {item.badge && (
                    <span className="px-1.5 py-0.5 bg-accent-primary/20 text-accent-primary text-[9px] font-bold uppercase rounded-md shadow-sm">
                        {item.badge}
                    </span>
                )}
            </Item>
        );
    };

    const renderTree = (nodes: ContextMenuItem[]) => {
        return nodes.map(node => {
            if (node.item_type === 'header') {
                return (
                    <div key={node.id} className="px-3 pt-4 pb-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-accent-primary/70">
                            {node.title}
                        </span>
                    </div>
                );
            }
            if (node.item_type === 'submenu' || node.item_type === 'provider') {
                return (
                    <Sub key={node.id}>
                        <SubTrigger className="w-full px-2 py-2 flex items-center justify-between outline-none cursor-pointer data-[state=open]:bg-white/10 data-[highlighted]:bg-white/10 rounded-lg group text-content-secondary data-[highlighted]:text-content-primary">
                            <div className="flex items-center gap-3">
                                <div className="w-7 h-7 rounded-md flex items-center justify-center bg-white/5 border border-white/10 group-data-[highlighted]:scale-110 group-data-[highlighted]:text-white transition-all duration-150 text-content-tertiary">
                                    {renderIcon(node.icon)}
                                </div>
                                <span className="text-xs font-semibold">{node.title}</span>
                            </div>
                            <ChevronRight className="w-4 h-4 opacity-40 group-data-[highlighted]:opacity-100 transition-opacity" />
                        </SubTrigger>
                        <Portal>
                            <SubContent
                                className="z-[9999] min-w-[220px] bg-surface-elevated/95 backdrop-blur-2xl rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.6)] border border-white/10 p-1.5 flex flex-col gap-0.5 animate-in slide-in-from-left-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
                                sideOffset={4}
                                alignOffset={-4}
                            >
                                {renderTree(node.children || [])}
                            </SubContent>
                        </Portal>
                    </Sub>
                );
            }
            return renderItem(node);
        });
    };

    return (
        <Root onOpenChange={(open) => { if (!open) onClose(); }}>
            <Trigger asChild>
                <span ref={triggerRef} style={{ position: 'fixed', left: position.x, top: position.y, width: 1, height: 1, pointerEvents: 'none' }} />
            </Trigger>

            <Portal>
                <Content
                    style={{ width: MENU_WIDTH }}
                    collisionPadding={MENU_PADDING}
                    className="z-[9999] bg-surface-elevated/95 backdrop-blur-2xl rounded-2xl shadow-[0_0_60px_rgba(0,0,0,0.7)] border border-stroke-subtle overflow-hidden flex flex-col data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:hide origin-top-left"
                    onEscapeKeyDown={onClose}
                    onInteractOutside={onClose}
                >
                    {/* Search Component */}
                    <div className="p-2 border-b border-white/5 bg-gradient-to-b from-white/5 to-transparent">
                        <div className="relative group">
                            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-content-tertiary group-focus-within:text-accent-primary transition-colors" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                placeholder="Search..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full bg-black/40 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs font-medium text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-1 focus:ring-accent-primary transition-all shadow-inner"
                                onKeyDown={e => e.stopPropagation()}
                                autoFocus
                            />
                        </div>
                    </div>

                    {/* Hierarchy/Results list */}
                    <div className="p-1.5 max-h-[360px] overflow-y-auto custom-scrollbar flex flex-col gap-0.5 relative">
                        {searchQuery ? (
                            searchResults.length > 0 ? (
                                searchResults.map(item => renderItem(item))
                            ) : (
                                <div className="py-10 text-center flex flex-col items-center justify-center gap-2">
                                    <Inbox className="w-6 h-6 text-content-tertiary opacity-40" />
                                    <p className="text-xs font-medium text-content-tertiary">No matching nodes.</p>
                                </div>
                            )
                        ) : (
                            isMenuLoading && tree.length === 0 ? (
                                <div className="p-1.5 flex flex-col gap-2">
                                    {[1, 2, 3, 4, 5].map(i => (
                                        <div key={i} className="flex items-center gap-3 px-2 py-2 animate-pulse">
                                            <div className="w-7 h-7 rounded-md bg-white/5" />
                                            <div className="h-3 w-24 bg-white/5 rounded-full" />
                                        </div>
                                    ))}
                                </div>
                            ) : tree.length > 0 ? (
                                renderTree(tree)
                            ) : (
                                <div className="py-10 text-center flex flex-col items-center justify-center gap-2 px-4 border border-dashed border-white/5 mx-2 my-2 rounded-xl bg-white/[0.02]">
                                    <LayoutGrid className="w-5 h-5 text-accent-primary opacity-50 animate-pulse" />
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-content-secondary">Neural Menu Offline</p>
                                        <p className="text-[9px] text-content-tertiary leading-relaxed">No active items found in the registry. Configure your menu in the Admin Panel.</p>
                                    </div>
                                </div>
                            )
                        )}
                    </div>
                </Content>
            </Portal>
        </Root>
    );
}
