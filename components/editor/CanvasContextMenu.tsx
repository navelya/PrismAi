'use client';

import React, { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import * as RadixContextMenu from '@radix-ui/react-context-menu';
import { 
    Root, Trigger, Portal, Content, Item, 
    Sub, SubTrigger, SubContent 
} from '@radix-ui/react-context-menu';
import { NodeType, AiModel } from '@/lib/nodes/types';
import { useAppStore } from '@/lib/store/app-store';
import { cn } from '@/lib/utils';
import * as Icons from 'lucide-react';
import { Plus, ChevronRight, Search as SearchIcon, Loader2, Inbox, LayoutGrid, Box } from 'lucide-react';
import {
    PendingConnection,
    findCompatibleHandle,
} from '@/lib/editor/handle-compatibility';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';

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
    onSelectNode: (
        type: NodeType,
        position: { x: number; y: number },
        nodeTypeId?: string,
        modelId?: number,
        autoConnectHandleId?: string
    ) => void;
    onClose: () => void;
    models?: AiModel[];
    /**
     * When set, the menu is opened by dropping a wire on the canvas. Items are
     * filtered down to those that have at least one handle compatible with the
     * dragged wire's data type, and selecting one produces an auto-connect.
     */
    pendingConnection?: PendingConnection | null;
}

const MENU_WIDTH = 210;
const MENU_PADDING = 8;

export default function CanvasContextMenu({
    position,
    onSelectNode,
    onClose,
    models,
    pendingConnection,
}: CanvasContextMenuProps) {
    const triggerRef = useRef<HTMLSpanElement>(null);
    const tree = useAppStore(state => state.menuTree);
    const flatList = useAppStore(state => state.menuFlat);
    const isMenuLoading = useAppStore(state => state.isMenuLoading);
    
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // No longer needs on-demand fetch here as it is pre-fetched by SharedWorkflowEditor

    // Fire a synthetic contextmenu event on the invisible trigger on mount.
    // useLayoutEffect (not useEffect) so the dispatch happens before paint —
    // otherwise the browser paints one blank frame before Radix opens, which
    // shows up as a perceptible "nothing happens" delay on right-click.
    useLayoutEffect(() => {
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

        // If the menu was opened by a dragged wire, resolve the handle on the new
        // node that will receive the auto-connect.
        let autoConnectHandleId: string | undefined;
        if (pendingConnection && models) {
            const compat = findCompatibleHandle(item, pendingConnection, models, sharedRegistry);
            autoConnectHandleId = compat?.id;
        }

        onSelectNode(typePath, position, nodeTypeId, modelId, autoConnectHandleId);
        onClose();
    };

    // Tree-structured filter for wire-drop mode. Recursively prunes branches
    // whose leaves have no compatible handles. Keeps the full hierarchy
    // (headers, providers, submenus) for the user to navigate.
    const filteredTree = useMemo<ContextMenuItem[]>(() => {
        if (!pendingConnection || !models) return tree;
        const prune = (nodes: ContextMenuItem[]): ContextMenuItem[] => {
            const out: ContextMenuItem[] = [];
            for (const n of nodes) {
                if (n.item_type === 'static_node' || n.item_type === 'ai_model' || n.item_type === 'node_type') {
                    if (findCompatibleHandle(n, pendingConnection, models, sharedRegistry)) {
                        out.push(n);
                    }
                } else if (n.item_type === 'submenu' || n.item_type === 'provider') {
                    const kids = prune(n.children || []);
                    if (kids.length > 0) out.push({ ...n, children: kids });
                } else if (n.item_type === 'header') {
                    // Header is kept only if it has at least one compatible sibling/descendant
                    // that follows it in the parent's order. Headers don't carry children,
                    // so we keep them — they will be removed in a second pass if all
                    // following items in the same parent are filtered out.
                    out.push(n);
                }
            }
            // Drop trailing/orphan headers (no leaf items following them in the same level).
            const cleaned: ContextMenuItem[] = [];
            for (let i = 0; i < out.length; i++) {
                const cur = out[i];
                if (cur.item_type === 'header') {
                    const next = out[i + 1];
                    if (!next || next.item_type === 'header') continue;
                }
                cleaned.push(cur);
            }
            return cleaned;
        };
        return prune(tree);
    }, [pendingConnection, models, tree]);

    const searchResults = useMemo(() => {
        if (!searchQuery) return [];
        const query = searchQuery.toLowerCase();

        // Filter by type and query, plus wire-drop compatibility when active.
        const filtered = flatList.filter(item => {
            if (!['static_node', 'ai_model', 'node_type'].includes(item.item_type)) return false;
            if (!item.title.toLowerCase().includes(query)) return false;
            if (pendingConnection && models) {
                return !!findCompatibleHandle(item, pendingConnection, models, sharedRegistry);
            }
            return true;
        });

        // Deduplicate by title to avoid visual clutter in search results
        const seen = new Set<string>();
        const results = filtered.filter(item => {
            const lowerTitle = item.title.toLowerCase();
            if (seen.has(lowerTitle)) return false;
            seen.add(lowerTitle);
            return true;
        });

        // Reset index when results change
        setSelectedIndex(0);
        return results;
    }, [searchQuery, flatList, pendingConnection, models]);

    // Scroll selected item into view
    useEffect(() => {
        if (searchQuery && listRef.current) {
            const selectedElement = listRef.current.children[selectedIndex] as HTMLElement;
            if (selectedElement) {
                selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }, [selectedIndex, searchQuery]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        // Block Radix's typeahead — any printable key would otherwise be caught
        // by the Content's matching logic and steal focus to a menu item.
        // Arrow/Enter are handled explicitly below; Escape is left to bubble.
        if (e.key !== 'Escape') {
            e.stopPropagation();
        }

        if (searchQuery) {
            // Search Navigation
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(prev => Math.min(prev + 1, searchResults.length - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(prev => Math.max(prev - 1, 0));
            } else if (e.key === 'Enter' && searchResults[selectedIndex]) {
                e.preventDefault();
                handleNodeClick(searchResults[selectedIndex]);
            }
        } else {
            // Tree Navigation Bridge
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                // Find the first focusable radix item in the list
                const firstItem = listRef.current?.querySelector('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]') as HTMLElement;
                if (firstItem) firstItem.focus();
            }
        }
    };

    const renderIcon = (iconName: string | null) => {
        if (!iconName) return <Box className="w-3.5 h-3.5" />;

        // Check if it's a URL (http or https)
        if (iconName.startsWith('http')) {
            return <img src={iconName} alt="" className="w-3.5 h-3.5 object-contain rounded-sm" />;
        }

        const iconComponent = (Icons as any)[iconName] || Box;
        const FinalIcon = iconComponent;
        return <FinalIcon className="w-3.5 h-3.5" />;
    };

    const renderItem = (item: ContextMenuItem, index?: number) => {
        const isHighlightedByKbd = searchQuery && selectedIndex === index;

        return (
            <Item
                key={item.id}
                onSelect={() => handleNodeClick(item)}
                className={cn(
                    "w-full px-2 py-1.5 flex items-center justify-between gap-2 outline-none cursor-pointer rounded-md text-content-secondary",
                    "data-[highlighted]:bg-white/5 data-[highlighted]:text-content-primary",
                    isHighlightedByKbd && "bg-white/5 text-content-primary"
                )}
            >
                <div className="flex items-center gap-2 min-w-0">
                    <span className={cn(
                        "shrink-0 text-content-tertiary",
                        "group-data-[highlighted]:text-accent-primary",
                        isHighlightedByKbd && "text-accent-primary"
                    )}>
                        {renderIcon(item.icon)}
                    </span>
                    <span className="text-[11px] font-semibold tracking-wide truncate">
                        {item.title}
                    </span>
                </div>
                {item.badge && (
                    <span className="px-1.5 py-0.5 bg-accent-primary/10 text-accent-primary text-[9px] font-bold uppercase rounded-full">
                        {item.badge}
                    </span>
                )}
            </Item>
        );
    };

    const renderTree = (nodes: ContextMenuItem[]) => {
        return nodes.map((node, i) => {
            if (node.item_type === 'header') {
                return (
                    <div key={node.id} className={cn("px-2 pb-1", i === 0 ? "pt-1" : "pt-3")}>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-content-tertiary/70">
                            {node.title}
                        </span>
                    </div>
                );
            }
            if (node.item_type === 'submenu' || node.item_type === 'provider') {
                return (
                    <Sub key={node.id}>
                        <SubTrigger className="w-full px-2 py-1.5 flex items-center justify-between gap-2 outline-none cursor-pointer rounded-md text-content-secondary data-[state=open]:bg-white/5 data-[state=open]:text-content-primary data-[highlighted]:bg-white/5 data-[highlighted]:text-content-primary">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="shrink-0 text-content-tertiary">
                                    {renderIcon(node.icon)}
                                </span>
                                <span className="text-[11px] font-semibold tracking-wide truncate">{node.title}</span>
                            </div>
                            <ChevronRight className="w-3.5 h-3.5 opacity-40 shrink-0" />
                        </SubTrigger>
                        <Portal>
                            <SubContent
                                className="popover-animate z-[9999] min-w-[180px] bg-surface-elevated/80 backdrop-blur-md rounded-2xl shadow-xl shadow-black/20 border border-stroke-subtle p-1 flex flex-col gap-0.5 origin-top-left"
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
                    className="popover-animate z-[9999] bg-surface-elevated/80 backdrop-blur-md rounded-2xl shadow-xl shadow-black/20 border border-stroke-subtle overflow-hidden flex flex-col origin-top-left"
                    onEscapeKeyDown={onClose}
                    onInteractOutside={onClose}
                >
                    {/* Search Component */}
                    <div className="p-1.5 border-b border-stroke-subtle/60">
                        <div className="relative group">
                            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-content-tertiary group-focus-within:text-accent-primary transition-colors" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                placeholder={pendingConnection ? 'Search compatible nodes...' : 'Search...'}
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                onKeyDown={handleKeyDown}
                                className="w-full bg-white/[0.03] border border-stroke-subtle rounded-md pl-7 pr-2 py-1.5 text-[11px] font-medium text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-accent-primary/40 transition-colors"
                                autoFocus
                            />
                        </div>
                    </div>

                    {/* Hierarchy/Results list */}
                    <div
                        ref={listRef}
                        className="p-1 max-h-[360px] overflow-y-auto custom-scrollbar flex flex-col gap-0.5 relative"
                    >
                        {searchQuery ? (
                            searchResults.length > 0 ? (
                                searchResults.map((item, idx) => renderItem(item, idx))
                            ) : (
                                <div className="py-8 text-center flex flex-col items-center justify-center gap-1.5">
                                    <Inbox className="w-4 h-4 text-content-tertiary opacity-40" />
                                    <p className="text-[11px] font-medium text-content-tertiary">
                                        {pendingConnection ? (
                                            <>No compatible matches for {Array.isArray(pendingConnection.dataType) ? pendingConnection.dataType.join(' / ') : pendingConnection.dataType}.</>
                                        ) : 'No matching nodes.'}
                                    </p>
                                </div>
                            )
                        ) : pendingConnection ? (
                            filteredTree.length > 0 ? (
                                renderTree(filteredTree)
                            ) : (
                                <div className="py-8 text-center flex flex-col items-center justify-center gap-1.5">
                                    <Inbox className="w-4 h-4 text-content-tertiary opacity-40" />
                                    <p className="text-[11px] font-medium text-content-tertiary">
                                        No compatible nodes for {Array.isArray(pendingConnection.dataType) ? pendingConnection.dataType.join(' / ') : pendingConnection.dataType}.
                                    </p>
                                </div>
                            )
                        ) : (
                            isMenuLoading && tree.length === 0 ? (
                                <div className="p-1 flex flex-col gap-1">
                                    {[1, 2, 3, 4, 5].map(i => (
                                        <div key={i} className="flex items-center gap-2 px-2 py-1.5 animate-pulse">
                                            <div className="w-3.5 h-3.5 rounded-sm bg-white/5" />
                                            <div className="h-2.5 w-24 bg-white/5 rounded-full" />
                                        </div>
                                    ))}
                                </div>
                            ) : tree.length > 0 ? (
                                renderTree(tree)
                            ) : (
                                <div className="py-8 text-center flex flex-col items-center justify-center gap-1.5 px-4 mx-1 my-1">
                                    <LayoutGrid className="w-4 h-4 text-content-tertiary opacity-40" />
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-content-secondary">Menu empty</p>
                                        <p className="text-[10px] text-content-tertiary leading-relaxed">Configure items in the Admin Panel.</p>
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
