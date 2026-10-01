'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { formatCents, formatSignedCents } from '@/src/lib/formatters';

/**
 * Visual and physics configuration constants for SVG graph layout.
 */
const GRAPH_CONFIG = {
  minNodeRadius: 26,
  maxNodeRadiusDelta: 18,
  minStrokeWidth: 1.8,
  maxStrokeWidthDelta: 4.2,
  bendFactor: 0.32,
  centerRadiusRatio: 0.36,
  autoplayIntervalMs: 3200,
};

/**
 * Plain SVG + CSS Debt Graph Visualization (Zero Charting Libraries).
 * 
 * Features:
 * - Nodes: Circles sized proportionally to absolute net balance (|net|),
 *   color-coded by financial state (Celadon = Creditor, Vermilion = Debtor, Brass = Neutral).
 * - Edges: Quadratic bezier curves with thickness scaled to transaction amount.
 * - Morphing Transition: Smoothly switches between raw tangled debts ("Before")
 *   and minimal settlement transactions ("After") with SVG dash and opacity transitions.
 * - Tabular numbers and monospaced typography matching the custom visual identity.
 */
export default function DebtGraph({
  participants = [],
  rawDebts = [],
  settlementDebts = [],
  currency = 'USD',
  width = 640,
  height = 540,
}) {
  const [viewMode, setViewMode] = useState('simplified'); // 'raw' | 'simplified'
  const [isPlaying, setIsPlaying] = useState(false);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);

  // Active node resolved from either mobile touch tap or desktop hover
  const activeNode = selectedNode || hoveredNode;

  // Auto-play loop toggle
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setViewMode(prev => (prev === 'raw' ? 'simplified' : 'raw'));
    }, GRAPH_CONFIG.autoplayIntervalMs);
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Compute Net Balance per participant
  const netBalances = useMemo(() => {
    const map = new Map();
    for (const p of participants) map.set(p, 0);

    for (const { from, to, amount } of rawDebts) {
      map.set(from, (map.get(from) || 0) - amount);
      map.set(to, (map.get(to) || 0) + amount);
    }
    return map;
  }, [participants, rawDebts]);

  // Active edges based on current viewMode
  const activeDebts = viewMode === 'raw' ? rawDebts : settlementDebts;

  // Active debts connected to active node (e.g. Bob)
  const hoverDetails = useMemo(() => {
    if (!activeNode) return null;
    const incoming = activeDebts.filter(d => d.to === activeNode);
    const outgoing = activeDebts.filter(d => d.from === activeNode);
    const connectedNames = new Set([
      ...incoming.map(d => d.from),
      ...outgoing.map(d => d.to),
    ]);
    const balance = netBalances.get(activeNode) || 0;
    return {
      name: activeNode,
      balance,
      incoming,
      outgoing,
      connectedNames,
    };
  }, [activeNode, activeDebts, netBalances]);

  // Calculate layout coordinates (polar arrangement around center)
  const layout = useMemo(() => {
    const cx = width / 2;
    const cy = height / 2 - 10;
    const radius = Math.min(width, height) * GRAPH_CONFIG.centerRadiusRatio;

    let maxAbsBalance = 1;
    for (const bal of netBalances.values()) {
      if (Math.abs(bal) > maxAbsBalance) maxAbsBalance = Math.abs(bal);
    }

    const nodeCoords = new Map();
    const count = participants.length;

    participants.forEach((name, idx) => {
      const angle = (2 * Math.PI * idx) / count - Math.PI / 2; // start from top
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      const balance = netBalances.get(name) || 0;

      // Circle radius scaled proportionally to net balance
      const nodeR =
        GRAPH_CONFIG.minNodeRadius +
        GRAPH_CONFIG.maxNodeRadiusDelta * (Math.abs(balance) / maxAbsBalance);

      nodeCoords.set(name, { x, y, balance, r: nodeR, name });
    });

    return { cx, cy, nodeCoords, maxAbsBalance };
  }, [participants, netBalances, width, height]);

  // Edge max amount for proportional thickness scaling
  const maxDebtAmount = useMemo(() => {
    const all = [...rawDebts, ...settlementDebts];
    return Math.max(...all.map(d => d.amount), 1);
  }, [rawDebts, settlementDebts]);

  // Aggregate metrics
  const rawTotal = rawDebts.reduce((acc, d) => acc + d.amount, 0);
  const settledTotal = settlementDebts.reduce((acc, d) => acc + d.amount, 0);
  const txReduction = rawDebts.length > 0
    ? Math.round(((rawDebts.length - settlementDebts.length) / rawDebts.length) * 100)
    : 0;
  const cashReduction = rawTotal > 0
    ? Math.round(((rawTotal - settledTotal) / rawTotal) * 100)
    : 0;

  if (!participants || participants.length < 2) {
    return (
      <div className="border border-ledger-border bg-ledger-panel p-8 text-center space-y-2">
        <p className="text-xs font-mono text-bone-muted">
          At least 2 members are required to construct a debt graph.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full border border-ledger-border bg-ledger-panel text-bone p-3.5 sm:p-6 font-sans">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-4 sm:pb-5 mb-4 sm:mb-5 border-b border-ledger-border gap-3 sm:gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-credit inline-block shrink-0" />
            <h3 className="font-display text-lg sm:text-xl tracking-tight text-bone font-medium">
              Debt Settlement Topology
            </h3>
          </div>
          <p className="text-xs text-bone-muted font-mono leading-relaxed">
            {viewMode === 'raw'
              ? `Raw obligations: ${rawDebts.length} transfers (${formatCents(rawTotal, currency)} total volume)`
              : `Netted plan: ${settlementDebts.length} bilateral transfers (${formatCents(settledTotal, currency)} total volume)`}
          </p>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full sm:w-auto">
          {/* View mode toggle button */}
          <div className="flex flex-1 sm:flex-initial border border-ledger-border bg-ledger-subpanel p-0.5 text-xs font-mono">
            <button
              onClick={() => {
                setViewMode('raw');
                setIsPlaying(false);
              }}
              type="button"
              className={`flex-1 sm:flex-initial px-2.5 sm:px-3 py-1.5 transition-colors whitespace-nowrap ${
                viewMode === 'raw'
                  ? 'bg-white text-bone font-semibold shadow-sm'
                  : 'text-bone-muted hover:text-bone'
              }`}
            >
              Before netting ({rawDebts.length})
            </button>
            <button
              onClick={() => {
                setViewMode('simplified');
                setIsPlaying(false);
              }}
              type="button"
              className={`flex-1 sm:flex-initial px-2.5 sm:px-3 py-1.5 transition-colors whitespace-nowrap ${
                viewMode === 'simplified'
                  ? 'bg-credit text-white font-semibold shadow-sm'
                  : 'text-bone-muted hover:text-bone'
              }`}
            >
              After netting ({settlementDebts.length})
            </button>
          </div>

          {/* Autoplay morph button */}
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            type="button"
            className={`w-full sm:w-auto px-3 py-1.5 text-xs font-mono border transition-all text-center ${
              isPlaying
                ? 'border-credit bg-credit/10 text-credit font-medium'
                : 'border-ledger-border bg-white text-bone-muted hover:text-bone'
            }`}
          >
            {isPlaying ? 'Pause transition' : 'Animate collapse'}
          </button>
        </div>
      </div>

      {/* Metric Ledger Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 border border-ledger-border bg-ledger-subpanel divide-y sm:divide-y-0 sm:divide-x divide-ledger-border mb-4 sm:mb-5">
        <div className="p-2.5 sm:p-3">
          <span className="text-[10px] sm:text-[11px] font-sans text-bone-muted block mb-0.5">
            Transfers required
          </span>
          <span className="font-mono text-xs sm:text-sm text-bone">
            <strong className="text-credit font-semibold">{settlementDebts.length}</strong>
            <span className="text-bone-dark text-[10px] sm:text-xs ml-1">(was {rawDebts.length})</span>
          </span>
        </div>
        <div className="p-2.5 sm:p-3">
          <span className="text-[10px] sm:text-[11px] font-sans text-bone-muted block mb-0.5">
            Transfer reduction
          </span>
          <span className="font-mono text-xs sm:text-sm text-credit font-semibold">
            -{txReduction}%
          </span>
        </div>
        <div className="p-2.5 sm:p-3">
          <span className="text-[10px] sm:text-[11px] font-sans text-bone-muted block mb-0.5">
            Capital in motion
          </span>
          <span className="font-mono text-xs sm:text-sm text-bone">
            <strong className="text-credit font-semibold">{formatCents(settledTotal, currency)}</strong>
            <span className="text-bone-dark text-[10px] sm:text-xs ml-1 block sm:inline">(was {formatCents(rawTotal, currency)})</span>
          </span>
        </div>
        <div className="p-2.5 sm:p-3">
          <span className="text-[10px] sm:text-[11px] font-sans text-bone-muted block mb-0.5">
            Capital conserved
          </span>
          <span className="font-mono text-xs sm:text-sm text-credit font-semibold">
            -{cashReduction}% cash drag
          </span>
        </div>
      </div>

      {/* SVG Canvas Container */}
      <div
        onClick={() => {
          setSelectedNode(null);
          setHoveredNode(null);
        }}
        className="relative border border-ledger-border bg-white overflow-hidden flex items-center justify-center cursor-default"
      >
        {/* Floating Inspector Card with Touch Dismissal & Mobile Adaptation */}
        {hoverDetails && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute top-2 right-2 left-2 sm:left-auto sm:top-4 sm:right-4 z-20 sm:w-64 max-w-sm bg-white/95 backdrop-blur border border-ledger-border p-3 sm:p-3.5 shadow-lg text-xs font-sans pointer-events-auto transition-all max-h-56 overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-ledger-border pb-2 mb-2 gap-2">
              <div className="flex items-center gap-2 truncate">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    hoverDetails.balance > 0
                      ? 'bg-credit'
                      : hoverDetails.balance < 0
                      ? 'bg-debt'
                      : 'bg-brass'
                  }`}
                />
                <span className="font-semibold text-bone text-sm truncate">{hoverDetails.name}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`font-mono text-xs font-bold tabular-nums ${
                    hoverDetails.balance > 0
                      ? 'text-credit'
                      : hoverDetails.balance < 0
                      ? 'text-debt'
                      : 'text-bone-muted'
                  }`}
                >
                  {formatSignedCents(hoverDetails.balance, currency)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedNode(null);
                    setHoveredNode(null);
                  }}
                  className="w-5 h-5 flex items-center justify-center text-bone-muted hover:text-bone text-xs border border-ledger-border bg-ledger-subpanel hover:bg-ledger-canvas"
                  aria-label="Close details"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="space-y-2 text-[11px] font-mono">
              {hoverDetails.incoming.length > 0 && (
                <div>
                  <span className="text-[10px] font-sans uppercase tracking-wider text-credit font-semibold block mb-0.5">
                    Receives from:
                  </span>
                  {hoverDetails.incoming.map((item, i) => (
                    <div key={i} className="flex justify-between text-bone-muted py-0.5">
                      <span className="text-bone font-medium truncate mr-2">{item.from}</span>
                      <span className="text-credit font-semibold shrink-0">+{formatCents(item.amount, currency)}</span>
                    </div>
                  ))}
                </div>
              )}

              {hoverDetails.outgoing.length > 0 && (
                <div className={hoverDetails.incoming.length > 0 ? 'pt-1.5 border-t border-ledger-subtle' : ''}>
                  <span className="text-[10px] font-sans uppercase tracking-wider text-debt font-semibold block mb-0.5">
                    Pays to:
                  </span>
                  {hoverDetails.outgoing.map((item, i) => (
                    <div key={i} className="flex justify-between text-bone-muted py-0.5">
                      <span className="text-bone font-medium truncate mr-2">{item.to}</span>
                      <span className="text-debt font-semibold shrink-0">-{formatCents(item.amount, currency)}</span>
                    </div>
                  ))}
                </div>
              )}

              {hoverDetails.incoming.length === 0 && hoverDetails.outgoing.length === 0 && (
                <div className="text-bone-dark italic text-center py-1">
                  No transfers in current view
                </div>
              )}
            </div>
          </div>
        )}

        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto max-h-[540px] select-none"
        >
          <defs>
            {/* Arrow Marker: Crimson (Debt / Outgoing) */}
            <marker
              id="arrow-crimson"
              viewBox="0 0 10 10"
              refX="18"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#E11D48" />
            </marker>

            {/* Arrow Marker: Emerald (Credit / Incoming) */}
            <marker
              id="arrow-emerald"
              viewBox="0 0 10 10"
              refX="18"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#059669" />
            </marker>

            {/* Arrow Marker: Neutral Slate */}
            <marker
              id="arrow-slate"
              viewBox="0 0 10 10"
              refX="18"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#CBD5E1" />
            </marker>

            {/* Radial background tint */}
            <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#059669" stopOpacity="0.04" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Background grid ambient circle */}
          <circle
            cx={layout.cx}
            cy={layout.cy}
            r={Math.min(width, height) * GRAPH_CONFIG.centerRadiusRatio}
            fill="url(#centerGlow)"
            stroke="#E2E5E9"
            strokeDasharray="2 4"
          />

          {/* EDGES LAYER */}
          <g className="edges-layer">
            {activeDebts.map((debt, index) => {
              const fromNode = layout.nodeCoords.get(debt.from);
              const toNode = layout.nodeCoords.get(debt.to);
              if (!fromNode || !toNode) return null;

              // Quadratic bezier: bend control point toward center
              const midX = (fromNode.x + toNode.x) / 2;
              const midY = (fromNode.y + toNode.y) / 2;
              const ctrlX = midX + (layout.cx - midX) * GRAPH_CONFIG.bendFactor;
              const ctrlY = midY + (layout.cy - midY) * GRAPH_CONFIG.bendFactor;

              // Quadratic curve point at t=0.5 for label placement
              const labelX = 0.25 * fromNode.x + 0.5 * ctrlX + 0.25 * toNode.x;
              const labelY = 0.25 * fromNode.y + 0.5 * ctrlY + 0.25 * toNode.y;

              // Stroke width proportional to amount
              const strokeW =
                GRAPH_CONFIG.minStrokeWidth +
                GRAPH_CONFIG.maxStrokeWidthDelta * (debt.amount / maxDebtAmount);

              // Directed highlighting relative to active node
              const isIncomingToHovered = activeNode && debt.to === activeNode;
              const isOutgoingFromHovered = activeNode && debt.from === activeNode;
              const isConnectedToHovered = isIncomingToHovered || isOutgoingFromHovered;

              let strokeColor;
              let markerId;
              let edgeOpacity;

              if (activeNode) {
                if (isIncomingToHovered) {
                  strokeColor = '#059669'; // Emerald: money arriving to active node
                  markerId = 'url(#arrow-emerald)';
                  edgeOpacity = 1;
                } else if (isOutgoingFromHovered) {
                  strokeColor = '#E11D48'; // Crimson: money leaving active node
                  markerId = 'url(#arrow-crimson)';
                  edgeOpacity = 1;
                } else {
                  strokeColor = '#CBD5E1'; // Dimmed other edge
                  markerId = 'url(#arrow-slate)';
                  edgeOpacity = 0.12;
                }
              } else {
                strokeColor = viewMode === 'simplified' ? '#059669' : '#E11D48';
                markerId = viewMode === 'simplified' ? 'url(#arrow-emerald)' : 'url(#arrow-crimson)';
                edgeOpacity = 0.75;
              }

              return (
                <g
                  key={`${debt.from}->${debt.to}-${index}`}
                  className="transition-opacity duration-250 ease-out"
                  style={{ opacity: edgeOpacity }}
                >
                  {/* Curved Path */}
                  <path
                    d={`M ${fromNode.x} ${fromNode.y} Q ${ctrlX} ${ctrlY} ${toNode.x} ${toNode.y}`}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={isConnectedToHovered ? strokeW + 0.8 : strokeW}
                    markerEnd={markerId}
                    className="graph-edge-path"
                  />

                  {/* Edge Pill Label */}
                  <g transform={`translate(${labelX}, ${labelY})`} className="graph-edge-label pointer-events-none">
                    <rect
                      x="-24"
                      y="-10"
                      width="48"
                      height="20"
                      rx="2"
                      fill="#FFFFFF"
                      stroke={strokeColor}
                      strokeWidth={isConnectedToHovered ? 1.5 : 1}
                      strokeOpacity="0.8"
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="font-mono text-[10px] font-semibold fill-slate-900 select-none"
                    >
                      {formatCents(debt.amount, currency)}
                    </text>
                  </g>
                </g>
              );
            })}
          </g>

          {/* NODES LAYER */}
          <g className="nodes-layer">
            {Array.from(layout.nodeCoords.values()).map((node) => {
              const isDebtor = node.balance < 0;
              const isCreditor = node.balance > 0;

              let strokeColor = '#D97706'; // Neutral Amber
              let fillColor = '#FFFBEB';
              let badgeColor = 'text-brass';

              if (isCreditor) {
                strokeColor = '#059669'; // Emerald
                fillColor = '#ECFDF5';
                badgeColor = 'text-credit';
              } else if (isDebtor) {
                strokeColor = '#E11D48'; // Crimson
                fillColor = '#FFF1F2';
                badgeColor = 'text-debt';
              }

              const isHovered = activeNode === node.name;
              const isConnectedPeer = hoverDetails?.connectedNames.has(node.name);
              const nodeOpacity = activeNode
                ? isHovered || isConnectedPeer
                  ? 1
                  : 0.22
                : 1;

              const currentRadius = isHovered ? node.r + 3 : node.r;

              return (
                <g
                  key={node.name}
                  transform={`translate(${node.x}, ${node.y})`}
                  className="graph-node cursor-pointer touch-manipulation"
                  style={{ opacity: nodeOpacity }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedNode(prev => (prev === node.name ? null : node.name));
                  }}
                  onMouseEnter={() => setHoveredNode(node.name)}
                  onMouseLeave={() => setHoveredNode(null)}
                >
                  {/* Subtle highlight ring for connected counterparties */}
                  {isConnectedPeer && (
                    <circle
                      r={node.r + 5}
                      fill="none"
                      stroke={
                        hoverDetails.incoming.some(d => d.from === node.name)
                          ? '#059669' // Pays the hovered person
                          : '#E11D48' // Receives from the hovered person
                      }
                      strokeWidth="1.5"
                      strokeDasharray="2 3"
                      opacity="0.8"
                    />
                  )}

                  {/* Outer circle sized by net balance */}
                  <circle
                    r={currentRadius}
                    fill={fillColor}
                    stroke={strokeColor}
                    strokeWidth={isHovered ? 2.5 : 1.5}
                  />

                  {/* Inner crisp white container */}
                  <circle
                    r={Math.max(currentRadius - 4, 12)}
                    fill="#FFFFFF"
                    stroke="#E2E5E9"
                    strokeWidth="1"
                  />

                  {/* Participant Name */}
                  <text
                    y="-5"
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="font-sans font-medium text-xs fill-slate-900 tracking-tight"
                  >
                    {node.name}
                  </text>

                  {/* Net Balance */}
                  <text
                    y="10"
                    textAnchor="middle"
                    dominantBaseline="central"
                    className={`font-mono text-[10px] font-semibold ${badgeColor}`}
                    fill={isCreditor ? '#059669' : isDebtor ? '#E11D48' : '#D97706'}
                  >
                    {formatSignedCents(node.balance, currency)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Legend */}
        <div className="absolute bottom-2 left-2 right-2 sm:right-auto sm:bottom-3 sm:left-3 flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-4 bg-white/95 border border-ledger-border px-2.5 sm:px-3 py-1.5 text-[9px] sm:text-[10px] font-mono text-bone-muted backdrop-blur-sm shadow-sm pointer-events-none">
          <div className="flex items-center gap-1.5">
            <span className="w-2 sm:w-2.5 h-2 sm:h-2.5 rounded-full border border-credit bg-credit/20 shrink-0" />
            <span>Creditor (Receives)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 sm:w-2.5 h-2 sm:h-2.5 rounded-full border border-debt bg-debt/20 shrink-0" />
            <span>Debtor (Pays)</span>
          </div>
          <div className="hidden xs:flex sm:flex items-center gap-1.5">
            <span className="w-2.5 sm:w-3 h-0.5 bg-credit shrink-0" />
            <span>Thickness scales with amount</span>
          </div>
        </div>
      </div>
    </div>
  );
}
