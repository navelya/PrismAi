'use client';

import React, { memo } from 'react';
import { Handle, Position, useReactFlow, useEdges, Connection } from 'reactflow';
import { Play, Copy, X, Loader2, Check, Circle, FastForward } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import { NodeHeader } from './NodeHeader';

export interface BaseNodeProps extends React.HTMLAttributes<HTMLDivElement> {
    id: string;
    type: string;
    label?: string;
    selected?: boolean;
    children?: React.ReactNode;
    width?: string | number;
    // Handle controls
    renderInputs?: boolean;
    renderOutput?: boolean;
    customInputs?: Array<{ id: string; label: string; color: string; type?: string; isArray?: boolean; isMandatory?: boolean }>;
    customOutputs?: Array<{ id: string; label: string; color: string; type?: string; isArray?: boolean; isMandatory?: boolean }>;
    // Additional styling
    contentClassName?: string;
    badgeCount?: number;
    // Custom header actions
    customActions?: React.ReactNode;
    icon?: string;
}

const BaseNode = React.forwardRef<HTMLDivElement, BaseNodeProps>(({
    id,
    type,
    label,
    selected,
    children,
    width = 'w-[280px]',
    renderInputs = true,
    renderOutput = true,
    customInputs,
    customOutputs,
    contentClassName = 'p-1',
    className,
    badgeCount,
    customActions,
    icon,
    ...props
}, ref) => {
    const sharedDef = sharedRegistry[type as keyof typeof sharedRegistry];
    const metadata = sharedDef?.meta;

    // Status and Store Actions
    const status = useAppStore((state) => state.nodeStatuses[id] || 'idle');
    const triggerRunFromNode = useAppStore((state) => state.triggerRunFromNode);
    const { addNodes, getNode, getNodes, deleteElements } = useReactFlow();
    const edges = useEdges();

    // Node Color
    const nodeColor = metadata?.color || 'rgb(var(--accent-primary))';
    const displayLabel = label || metadata?.label || 'Node';

    // Labels
    const defaultInputLabel = sharedDef?.handles?.inputs?.[0]?.label;
    const defaultOutputLabel = sharedDef?.handles?.outputs?.[0]?.label;
    const defaultOutputId = sharedDef?.handles?.outputs?.[0]?.id || 'output';

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        // Standard React Flow deletion - bubbles up to onNodesDelete in SharedWorkflowEditor
        deleteElements({ nodes: [{ id }] });
    };

    const handleDuplicate = (e: React.MouseEvent) => {
        e.stopPropagation();
        const currentNode = getNode(id);

        if (currentNode) {
            const nodes = getNodes();
            const maxZ = Math.max(0, ...nodes.map(n => n.zIndex || 0));

            const newNode = {
                ...JSON.parse(JSON.stringify(currentNode)),
                id: `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                zIndex: maxZ + 1,
                position: {
                    x: currentNode.position.x + 50,
                    y: currentNode.position.y + 50,
                },
                selected: false,
                data: {
                    ...currentNode.data,
                    label: `${currentNode.data.label || displayLabel} (Copy)`,
                }
            };
            addNodes(newNode);
        }
    };

    const handleRunSolo = (e: React.MouseEvent) => {
        e.stopPropagation();
        triggerRunFromNode(id, 'solo');
    };

    const handleRunChain = (e: React.MouseEvent) => {
        e.stopPropagation();
        triggerRunFromNode(id, 'chain');
    };

    // --- DRY Connection Validation ---
    const models = useAppStore(state => state.models);

    const validateConnection = React.useCallback((connection: Connection) => {
        if (connection.source === connection.target) return false;

        const sourceNode = getNode(connection.source!);
        const targetNode = getNode(connection.target!);
        if (!sourceNode || !targetNode) return false;

        // 1. Resolve Source Handle Metadata
        let sourceHandleData: any = null;
        const sourceHandleId = connection.sourceHandle || 'output';

        if (sourceNode.type === 'ai_generator') {
            const modelId = sourceNode.data?.config?.model_id;
            const model = models.find(m => m.id === modelId);
            sourceHandleData = model?.outputs_schema?.handles?.find(h => (h.api_mapping_key || h.name || 'output') === sourceHandleId);
        } else {
            const sourceDef = sharedRegistry[sourceNode.type as keyof typeof sharedRegistry];
            sourceHandleData = sourceDef?.handles?.outputs?.find(h => (h.id || 'output') === sourceHandleId);
            // Fallback to dynamic schema if any (not used much now but for future-proofing)
            if (!sourceHandleData) {
                sourceHandleData = (sourceNode.data as any)?.outputs_schema?.handles?.find((h: any) => (h.api_mapping_key || 'output') === sourceHandleId);
            }
        }

        // 2. Resolve Target Handle Metadata
        let targetHandleData: any = null;
        const targetHandleId = connection.targetHandle;

        if (targetNode.type === 'ai_generator') {
            const modelId = targetNode.data?.config?.model_id;
            const model = models.find(m => m.id === modelId);
            targetHandleData = model?.inputs_schema?.handles?.find(h => (h.api_mapping_key || h.name) === targetHandleId);
        } else {
            const targetDef = sharedRegistry[targetNode.type as keyof typeof sharedRegistry];
            // Match by ID or treat first handle as default if ID is null/empty
            targetHandleData = targetDef?.handles?.inputs?.find(h => h.id === targetHandleId) || targetDef?.handles?.inputs?.[0];
            
            // Fallback to custom props or dynamic schema
            if (!targetHandleData && targetNode.id === id && customInputs) {
                targetHandleData = customInputs.find(h => h.id === targetHandleId);
            }
        }

        // 3. Type Validation
        const sourceType = String(sourceHandleData?.type || sourceHandleData?.dataType || 'any').toLowerCase();
        const targetType = String(targetHandleData?.type || targetHandleData?.expectedType || 'any').toLowerCase();

        if (sourceType !== 'any' && targetType !== 'any') {
            const normSource = sourceType.replace('_array', '');
            const normTarget = targetType.replace('_array', '');
            if (normSource !== normTarget) return false;
        }

        // 4. Connection Limit
        const isTargetArray = targetHandleData?.isArray || targetHandleData?.is_array;
        if (!isTargetArray) {
            const existingEdges = edges.filter(e => e.target === connection.target && e.targetHandle === targetHandleId);
            if (existingEdges.length >= 1) return false;
        }

        return true;
    }, [getNode, models, edges, id, customInputs]);

    // Determine inputs to render
    const inputsToRender = customInputs || sharedDef?.handles?.inputs;

    return (
        <div
            ref={ref}
            className={cn(
                "rounded-2xl border backdrop-blur-xl relative group bg-bg-primary/40",
                "transition-[border-color,box-shadow,background-color] duration-500 ease-out",
                selected ? "border-accent-primary shadow-[0_0_20px_rgb(var(--accent-primary)/0.15)] ring-1 ring-accent-primary/20" : "border-stroke-subtle shadow-xl",
                "hover:border-stroke-strong hover:bg-surface-elevated/50 hover:shadow-2xl",
                typeof width === 'string' ? width : '',
                className
            )}
            style={{
                width: typeof width === 'number' ? width : undefined,
                willChange: 'transform',
                ...props.style
            }}
            {...props}
        >
            {/* Action Buttons */}
            <div className="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 z-10">
                {sharedDef?.category === 'generative' && (
                    <>
                        <button
                            onClick={handleRunSolo}
                            className="w-6 h-6 rounded-lg bg-accent-primary/20 border border-accent-primary/30 backdrop-blur-md
                                       flex items-center justify-center shadow-lg hover:scale-110 hover:bg-accent-primary transition-all duration-200 group/btn"
                            title="Run Solo (This node only)"
                        >
                            <Play className="w-3 h-3 text-accent-primary group-hover/btn:text-white fill-current" />
                        </button>
                        <button
                            onClick={handleRunChain}
                            className="w-6 h-6 rounded-lg bg-accent-secondary/20 border border-accent-secondary/30 backdrop-blur-md
                                       flex items-center justify-center shadow-lg hover:scale-110 hover:bg-accent-secondary transition-all duration-200 group/btn"
                            title="Run Chain (This node + all downstream)"
                        >
                            <FastForward className="w-3.5 h-3.5 text-accent-secondary group-hover/btn:text-white fill-current" />
                        </button>
                    </>
                )}
                {/* Input nodes don't have manual triggers anymore. Utility nodes compute reactively. */}
                {customActions}
                <button
                    onClick={handleDuplicate}
                    className="w-6 h-6 rounded-lg bg-white/5 border border-white/10 backdrop-blur-md
                                flex items-center justify-center shadow-lg hover:scale-110 hover:bg-white/10 transition-all duration-200"
                    title="Duplicate node"
                >
                    <Copy className="w-3 h-3 text-content-primary" />
                </button>
                <button
                    onClick={handleDelete}
                    className="w-6 h-6 rounded-lg bg-accent-error/10 border border-accent-error/20 backdrop-blur-md
                                flex items-center justify-center shadow-lg hover:scale-110 hover:bg-accent-error hover:text-content-inverted transition-all duration-200 group/del"
                    title="Delete node"
                >
                    <X className="w-3.5 h-3.5 text-accent-error group-hover/del:text-content-inverted" />
                </button>
            </div>

            {/* Status Badge */}
            {status !== 'idle' && (
                <div
                    className={cn(
                        "absolute -top-2 -left-2 w-7 h-7 rounded-full flex items-center justify-center",
                        "shadow-lg border-2 border-surface-primary transition-all duration-300",
                        status === 'pending' && "bg-slate-500",
                        status === 'running' && "bg-accent-primary animate-pulse shadow-[0_0_10px_rgba(6,182,212,0.5)]",
                        status === 'success' && "bg-accent-secondary shadow-[0_0_10px_rgba(20,184,166,0.5)]",
                        status === 'error' && "bg-accent-error"
                    )}
                >
                    {status === 'running' && <Loader2 className="w-4 h-4 animate-spin text-content-inverted" />}
                    {status === 'success' && <Check className="w-4 h-4 text-content-inverted" />}
                    {status === 'error' && <X className="w-4 h-4 text-content-inverted" />}
                    {status === 'pending' && <Circle className="w-2 h-2 text-content-inverted fill-current" />}
                </div>
            )}

            {/* Input Handles */}
            {renderInputs && (
                inputsToRender && inputsToRender.length > 0 ? (
                    inputsToRender.map((input, index) => {
                        const totalHandles = inputsToRender.length;
                        const spacing = 36;
                        const totalHeight = (totalHandles - 1) * spacing;
                        const offset = (index * spacing) - (totalHeight / 2);

                        return (
                            <React.Fragment key={input.id}>
                                <Handle
                                    type="target"
                                    position={Position.Left}
                                    id={input.id}
                                    isValidConnection={validateConnection}
                                    className={cn(
                                        "w-2.5 h-2.5 !border-2 !border-surface-primary hover:!scale-125 transition-all duration-200",
                                        "before:content-[''] before:absolute before:w-12 before:h-12 before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full",
                                        (input as any).isMandatory && !edges.some(e => e.target === id && e.targetHandle === input.id) && "animate-pulse shadow-[0_0_8px_rgba(255,255,255,0.4)]"
                                    )}
                                    style={{
                                        background: input.color || nodeColor,
                                        boxShadow: (input as any).isMandatory && !edges.some(e => e.target === id && e.targetHandle === input.id)
                                            ? `0 0 12px ${input.color || nodeColor}80`
                                            : `0 0 10px ${input.color || nodeColor}40`,
                                        left: -5,
                                        top: `calc(50% + ${offset}px)`,
                                    }}
                                >
                                    {input.label && (() => {
                                        const isMissing = (input as any).isMandatory && !edges.some(e => e.target === id && e.targetHandle === input.id);
                                        const isErrorState = status === 'error' && isMissing;

                                        return (
                                            <div className={cn(
                                                "absolute bottom-full right-1/2 mb-1 mr-1 opacity-0 group-hover:opacity-100 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 drop-shadow-md",
                                                isErrorState ? "text-accent-error font-extrabold" : "text-content-primary"
                                            )} style={!isErrorState ? { color: input.color || nodeColor } : undefined}>
                                                {input.label}{(input as any).isMandatory ? ' *' : ''}
                                            </div>
                                        );
                                    })()}
                                </Handle>
                            </React.Fragment>
                        );
                    })
                ) : (
                    <Handle
                        type="target"
                        position={Position.Left}
                        isValidConnection={validateConnection}
                        className="w-2.5 h-2.5 !border-2 !border-surface-primary hover:!scale-125 transition-all duration-200
                                  before:content-[''] before:absolute before:w-12 before:h-12 before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full"
                        style={{
                            background: nodeColor,
                            boxShadow: `0 0 10px ${nodeColor}40`,
                            left: -5,
                        }}
                    >
                        {defaultInputLabel && (() => {
                            const defaultInput = sharedDef?.handles?.inputs?.[0];
                            const isMissing = defaultInput?.isMandatory && !edges.some(e => e.target === id && (!e.targetHandle || e.targetHandle === defaultInput.id));
                            const isErrorState = status === 'error' && isMissing;

                            return (
                                <div className={cn(
                                    "absolute bottom-full right-1/2 mb-1 mr-1 opacity-0 group-hover:opacity-100 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 drop-shadow-md",
                                    isErrorState ? "text-accent-error font-extrabold" : "text-content-primary"
                                )} style={!isErrorState ? { color: nodeColor } : undefined}>
                                    {defaultInputLabel}{defaultInput?.isMandatory ? ' *' : ''}
                                </div>
                            );
                        })()}
                    </Handle>
                )
            )}

            <NodeHeader
                icon={icon || metadata?.icon || 'Box'}
                label={displayLabel}
                color={nodeColor}
                badgeCount={badgeCount}
            />

            {/* Content Area */}
            <div className={contentClassName}>
                {children}
            </div>

            {/* Output Handles */}
            {renderOutput && (
                customOutputs && customOutputs.length > 0 ? (
                    customOutputs.map((output, index) => {
                        const totalHandles = customOutputs.length;
                        const spacing = 36;
                        const totalHeight = (totalHandles - 1) * spacing;
                        const offset = (index * spacing) - (totalHeight / 2);

                        return (
                                <Handle
                                    key={output.id}
                                    type="source"
                                    position={Position.Right}
                                    id={output.id}
                                    isValidConnection={validateConnection}
                                className="w-2.5 h-2.5 !border-2 !border-surface-primary hover:!scale-125 transition-all duration-200
                                          before:content-[''] before:absolute before:w-12 before:h-12 before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full"
                                style={{
                                    background: output.color || nodeColor,
                                    boxShadow: `0 0 10px ${output.color || nodeColor}40`,
                                    right: -5,
                                    top: `calc(50% + ${offset}px)`
                                }}
                            >
                                <div className="absolute bottom-full left-1/2 mb-1 ml-1 opacity-0 group-hover:opacity-100 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 text-content-primary drop-shadow-md" style={{ color: output.color || nodeColor }}>
                                    {output.label}
                                </div>
                            </Handle>
                        );
                    })
                ) : (
                    <Handle
                        type="source"
                        position={Position.Right}
                        id={defaultOutputId}
                        isValidConnection={validateConnection}
                        className="w-2.5 h-2.5 !border-2 !border-surface-primary hover:!scale-125 transition-all duration-200
                                  before:content-[''] before:absolute before:w-12 before:h-12 before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full"
                        style={{
                            background: nodeColor,
                            boxShadow: `0 0 10px ${nodeColor}40`,
                            right: -5,
                        }}
                    >
                        {defaultOutputLabel && (
                            <div className="absolute bottom-full left-1/2 mb-1 ml-1 opacity-0 group-hover:opacity-100 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider pointer-events-none transition-all duration-300 text-content-primary drop-shadow-md" style={{ color: nodeColor }}>
                                {defaultOutputLabel}
                            </div>
                        )}
                    </Handle>
                )
            )}
        </div>
    );
});

BaseNode.displayName = 'BaseNode';

export default memo(BaseNode);
