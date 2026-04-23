'use client';

import { EdgeProps, EdgeLabelRenderer, getBezierPath, useReactFlow } from 'reactflow';

export default function GradientEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  animated,
}: EdgeProps) {
  const { setEdges } = useReactFlow();
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const gradientId = `gradient-edge-${id}`;

  return (
    <>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#0D9488" />
        </linearGradient>
      </defs>

      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={2}
        style={
          animated
            ? { strokeDasharray: '6 3', animation: 'gradient-dash 0.6s linear infinite' }
            : undefined
        }
      />

      {/* Disconnect button — shown at midpoint of edge */}
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
        >
          <button
            title="Disconnect"
            onClick={e => {
              e.stopPropagation();
              setEdges(eds => eds.filter(ed => ed.id !== id));
            }}
            style={{
              width: 18, height: 18, borderRadius: '50%',
              border: '1px solid var(--studio-border)',
              background: 'var(--studio-surface)',
              color: 'var(--studio-text-muted)',
              cursor: 'pointer',
              fontSize: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1, padding: 0,
              transition: 'color 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e => {
              const b = e.currentTarget;
              b.style.color = '#F43F5E';
              b.style.borderColor = '#F43F5E44';
              b.style.background = '#F43F5E11';
            }}
            onMouseLeave={e => {
              const b = e.currentTarget;
              b.style.color = 'var(--studio-text-muted)';
              b.style.borderColor = 'var(--studio-border)';
              b.style.background = 'var(--studio-surface)';
            }}
          >
            ×
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
