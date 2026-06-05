// components/templates/TemplateCanvasPreview.tsx
'use client';
import React, { useMemo } from 'react';
import ReactFlow, { ReactFlowProvider, Background, BackgroundVariant, ConnectionMode } from 'reactflow';
import 'reactflow/dist/style.css';
import { stableNodeTypes, stableEdgeTypes } from '@/components/editor/reactflow-types';

interface Props {
  nodes: any[];
  edges: any[];
  className?: string;
}

const FIT_VIEW_OPTIONS = { padding: 0.25, maxZoom: 1 };
const PRO_OPTIONS = { hideAttribution: true };

/**
 * A non-interactive canvas that renders a saved workflow exactly as it looks in
 * the editor — but the user can only pan and zoom. No selection, dragging,
 * connecting, or editing. Used in the template detail view.
 */
function PreviewInner({ nodes, edges }: { nodes: any[]; edges: any[] }) {
  const flowEdges = useMemo(
    () => (edges ?? []).map((e) => ({ ...e, type: 'default', animated: false, selectable: false })),
    [edges],
  );
  const flowNodes = useMemo(
    () => (nodes ?? []).map((n) => ({ ...n, draggable: false, selectable: false, connectable: false })),
    [nodes],
  );

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      nodeTypes={stableNodeTypes}
      edgeTypes={stableEdgeTypes}
      fitView
      fitViewOptions={FIT_VIEW_OPTIONS}
      minZoom={0.1}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      selectionOnDrag={false}
      selectNodesOnDrag={false}
      panOnDrag
      panOnScroll
      zoomOnScroll={false}
      zoomOnPinch
      zoomOnDoubleClick={false}
      deleteKeyCode={null}
      connectionMode={ConnectionMode.Strict}
      proOptions={PRO_OPTIONS}
      className="bg-transparent"
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="opacity-50" />
    </ReactFlow>
  );
}

export function TemplateCanvasPreview({ nodes, edges, className }: Props) {
  return (
    <div className={className}>
      <ReactFlowProvider>
        <PreviewInner nodes={nodes} edges={edges} />
      </ReactFlowProvider>
    </div>
  );
}
