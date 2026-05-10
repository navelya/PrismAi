'use client';

/**
 * Shared Konva layer renderer for the Compositor.
 *
 * Used by both the in-canvas preview ([CompositorNode](../canvas/CompositorNode.tsx))
 * and the full-screen editor ([CompositorEditorModal](./CompositorEditorModal.tsx)).
 *
 * What's shared: the per-layer Konva node setup (image/text props, transforms,
 * blend modes, typography) — so pixel output is identical between preview and
 * editor and there's no drift in scaling math.
 *
 * What's not shared: the Stage itself, because preview and editor have
 * fundamentally different stage management (preview = fit-scaled Group inside a
 * resize-observed container; editor = user-controlled zoom/pan with Transformer
 * and dimmer overlay). Each caller wraps these layer nodes in its own Stage.
 */

import React, { memo, useEffect, useMemo, useRef } from 'react';
import { Image as KonvaImage, Text as KonvaText } from 'react-konva';
import useImage from 'use-image';
import { CompositorLayer, LayerTransform } from '../definition';

/**
 * What the shared renderer needs to draw one layer:
 *   - the layer record (transform, visibility, etc.)
 *   - its resolved upstream value: an image object `{ url, ... }`, a text
 *     string, or null when the upstream hasn't produced anything yet
 */
export interface RenderableLayer {
    layer: CompositorLayer;
    resolved: { url?: string } | string | null;
}

interface CompositorLayerNodesProps {
    layers: RenderableLayer[];
    interactive?: boolean;
    selectedLayerId?: string | null;
    onSelectLayer?: (layerId: string) => void;
    onTransformLayer?: (layerId: string, updates: Partial<LayerTransform>) => void;
    onLayerImageLoad?: (layerId: string, img: HTMLImageElement) => void;
    /** Set isDragging on the global store while a layer is being transformed (autosave gate). */
    onInteractStart?: () => void;
    onInteractEnd?: () => void;
}

function safeImageUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('data:')) return url;
    return url + (url.includes('?') ? '&' : '?') + 'notaint=1';
}

const LayerImage = memo(function LayerImage({
    layer,
    imageUrl,
    interactive,
    onSelect,
    onTransform,
    onLoad,
    onInteractStart,
    onInteractEnd,
}: {
    layer: CompositorLayer;
    imageUrl: string;
    interactive: boolean;
    onSelect?: () => void;
    onTransform?: (updates: Partial<LayerTransform>) => void;
    onLoad?: (img: HTMLImageElement) => void;
    onInteractStart?: () => void;
    onInteractEnd?: () => void;
}) {
    const safeUrl = useMemo(() => safeImageUrl(imageUrl), [imageUrl]);
    const [img] = useImage(safeUrl, 'anonymous');
    const shapeRef = useRef<any>(null);
    const t = layer.transform;

    useEffect(() => {
        if (img && onLoad) onLoad(img);
    }, [img, onLoad]);

    if (!img) return null;

    const commonProps: any = {
        image: img,
        ref: shapeRef,
        x: t.x,
        y: t.y,
        width: t.width,
        height: t.height,
        rotation: t.rotation,
        opacity: t.opacity,
        scaleX: t.flipX ? -1 : 1,
        scaleY: t.flipY ? -1 : 1,
        offsetX: t.flipX ? t.width : 0,
        offsetY: t.flipY ? t.height : 0,
        globalCompositeOperation: (t.blendMode as any) || 'source-over',
    };

    if (!interactive) {
        // Non-interactive (preview) still needs to know when the image loads
        // so callers can auto-fit the layer to the image's true dimensions.
        // The onLoad effect above runs in both modes; nothing else to wire.
        return <KonvaImage {...commonProps} listening={false} />;
    }

    return (
        <KonvaImage
            {...commonProps}
            // The Transformer in the editor finds the selected node by name.
            name={`img-${layer.id}`}
            draggable={!layer.locked}
            onClick={onSelect}
            onTap={onSelect}
            onDragStart={() => {
                onSelect?.();
                onInteractStart?.();
            }}
            onDragEnd={(e) => {
                onTransform?.({ x: e.target.x(), y: e.target.y() });
                onInteractEnd?.();
            }}
            onTransformStart={() => onInteractStart?.()}
            onTransformEnd={() => {
                const node = shapeRef.current;
                if (!node) {
                    onInteractEnd?.();
                    return;
                }
                const scaleX = node.scaleX();
                const scaleY = node.scaleY();
                node.scaleX(t.flipX ? -1 : 1);
                node.scaleY(t.flipY ? -1 : 1);
                onTransform?.({
                    x: node.x(),
                    y: node.y(),
                    rotation: node.rotation(),
                    width: Math.max(5, node.width() * Math.abs(scaleX)),
                    height: Math.max(5, node.height() * Math.abs(scaleY)),
                });
                onInteractEnd?.();
            }}
        />
    );
});

const LayerText = memo(function LayerText({
    layer,
    text,
    interactive,
    onSelect,
    onTransform,
    onInteractStart,
    onInteractEnd,
}: {
    layer: CompositorLayer;
    text: string;
    interactive: boolean;
    onSelect?: () => void;
    onTransform?: (updates: Partial<LayerTransform>) => void;
    onInteractStart?: () => void;
    onInteractEnd?: () => void;
}) {
    const shapeRef = useRef<any>(null);
    const t = layer.transform;

    const commonProps: any = {
        text,
        ref: shapeRef,
        x: t.x,
        y: t.y,
        width: t.width,
        height: t.height,
        rotation: t.rotation,
        opacity: t.opacity,
        scaleX: t.flipX ? -1 : 1,
        scaleY: t.flipY ? -1 : 1,
        offsetX: t.flipX ? t.width : 0,
        offsetY: t.flipY ? t.height : 0,
        globalCompositeOperation: (t.blendMode as any) || 'source-over',
        fontSize: t.fontSize || 48,
        fontFamily: t.fontFamily || 'Inter',
        fontStyle: t.fontStyle || 'bold',
        fill: t.fillColor || '#ffffff',
        align: t.textAlign || 'center',
        verticalAlign: 'middle',
        lineHeight: t.lineHeight || 1.2,
        letterSpacing: t.letterSpacing || 0,
    };

    if (!interactive) {
        return <KonvaText {...commonProps} listening={false} />;
    }

    return (
        <KonvaText
            {...commonProps}
            name={`img-${layer.id}`}
            draggable={!layer.locked}
            onClick={onSelect}
            onTap={onSelect}
            onDragStart={() => {
                onSelect?.();
                onInteractStart?.();
            }}
            onDragEnd={(e) => {
                onTransform?.({ x: e.target.x(), y: e.target.y() });
                onInteractEnd?.();
            }}
            onTransformStart={() => onInteractStart?.()}
            onTransform={(e) => {
                // Bake scale into width/height each frame and reset scale to 1.
                // Konva applies scaleX/scaleY visually, which would stretch the
                // text glyphs. Translating into width/height instead re-flows
                // the text inside a resized box without distortion.
                const node = e.target;
                const scaleX = node.scaleX();
                const scaleY = node.scaleY();
                const newWidth = Math.max(20, node.width() * Math.abs(scaleX));
                const newHeight = Math.max(20, node.height() * Math.abs(scaleY));
                node.setAttrs({
                    width: newWidth,
                    height: newHeight,
                    scaleX: t.flipX ? -1 : 1,
                    scaleY: t.flipY ? -1 : 1,
                });
            }}
            onTransformEnd={() => {
                const node = shapeRef.current;
                if (!node) {
                    onInteractEnd?.();
                    return;
                }
                const scaleX = node.scaleX();
                const scaleY = node.scaleY();
                node.scaleX(t.flipX ? -1 : 1);
                node.scaleY(t.flipY ? -1 : 1);
                onTransform?.({
                    x: node.x(),
                    y: node.y(),
                    rotation: node.rotation(),
                    width: Math.max(20, node.width() * Math.abs(scaleX)),
                    height: Math.max(20, node.height() * Math.abs(scaleY)),
                });
                onInteractEnd?.();
            }}
        />
    );
});

/**
 * Render the compositor's layers as Konva nodes. Mount inside any Konva `<Layer>`.
 * Pass `interactive` to enable drag/transform/select; omit for static preview.
 */
export const CompositorLayerNodes = memo(function CompositorLayerNodes({
    layers,
    interactive = false,
    onSelectLayer,
    onTransformLayer,
    onLayerImageLoad,
    onInteractStart,
    onInteractEnd,
}: CompositorLayerNodesProps) {
    return (
        <>
            {[...layers].reverse().map(({ layer, resolved }) => {
                if (!layer.visible) return null;
                if (resolved === null || resolved === undefined) return null;

                const asImage =
                    resolved && typeof resolved === 'object' && typeof (resolved as any).url === 'string'
                        ? ((resolved as any).url as string)
                        : null;
                const asText = typeof resolved === 'string' ? resolved : null;

                if (asImage) {
                    return (
                        <LayerImage
                            key={layer.id}
                            layer={layer}
                            imageUrl={asImage}
                            interactive={interactive}
                            onSelect={interactive && onSelectLayer ? () => onSelectLayer(layer.id) : undefined}
                            onTransform={
                                interactive && onTransformLayer
                                    ? (u) => onTransformLayer(layer.id, u)
                                    : undefined
                            }
                            // Auto-center on first image load fires in both
                            // preview and editor — the receiver's idempotency
                            // guard (isAutoCentered) makes this safe.
                            onLoad={
                                onLayerImageLoad
                                    ? (img) => onLayerImageLoad(layer.id, img)
                                    : undefined
                            }
                            onInteractStart={onInteractStart}
                            onInteractEnd={onInteractEnd}
                        />
                    );
                }
                if (asText !== null) {
                    return (
                        <LayerText
                            key={layer.id}
                            layer={layer}
                            text={asText}
                            interactive={interactive}
                            onSelect={interactive && onSelectLayer ? () => onSelectLayer(layer.id) : undefined}
                            onTransform={
                                interactive && onTransformLayer
                                    ? (u) => onTransformLayer(layer.id, u)
                                    : undefined
                            }
                            onInteractStart={onInteractStart}
                            onInteractEnd={onInteractEnd}
                        />
                    );
                }
                return null;
            })}
        </>
    );
});
