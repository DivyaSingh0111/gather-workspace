import { useRef, useState } from "react";

const BOX_W = 150;
const BOX_H = 52;

// Places AI boxes in neat columns, following the arrows left to right.
export function autoLayout(parsed) {
  const nodes = parsed.nodes.map((node) => ({ ...node }));
  const edges = parsed.edges || [];

  const level = {};
  nodes.forEach((node) => {
    level[node.id] = 0;
  });

  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    edges.forEach((edge) => {
      if (level[edge.from] + 1 > level[edge.to] && level[edge.to] < nodes.length) {
        level[edge.to] = level[edge.from] + 1;
        changed = true;
      }
    });
    if (!changed) break;
  }

  const columns = {};
  nodes.forEach((node) => {
    const key = level[node.id];
    if (!columns[key]) columns[key] = [];
    columns[key].push(node);
  });

  const gapY = BOX_H + 36;
  const gapX = BOX_W + 70;
  const tallest = Math.max(...Object.values(columns).map((list) => list.length));

  Object.keys(columns).forEach((key) => {
    const list = columns[key];
    const topOffset = ((tallest - list.length) * gapY) / 2;
    list.forEach((node, index) => {
      node.x = Math.round(40 + Number(key) * gapX);
      node.y = Math.round(40 + topOffset + index * gapY);
    });
  });

  return { nodes, edges, strokes: [] };
}

// Where an arrow should touch the edge of a box instead of its centre.
function borderPoint(center, other) {
  const dx = other.x - center.x;
  const dy = other.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const scaleX = dx !== 0 ? BOX_W / 2 / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? BOX_H / 2 / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function shortLabel(text) {
  return text.length > 22 ? `${text.slice(0, 21)}…` : text;
}

export default function DrawBoard({
  value,
  onChange,
  readOnly = false,
  compact = false,
  markerId = "arrow-main",
}) {
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const draftRef = useRef(null);

  const [tool, setTool] = useState("select");
  const [selectedId, setSelectedId] = useState(null);
  const [connectFrom, setConnectFrom] = useState(null);
  const [draft, setDraft] = useState(null);

  const board = draft || value;
  const nodeById = {};
  board.nodes.forEach((node) => {
    nodeById[node.id] = node;
  });

  // The visible area grows when boxes or lines go beyond the edge.
  let width = compact ? 600 : 900;
  let height = compact ? 220 : 480;
  board.nodes.forEach((node) => {
    width = Math.max(width, node.x + BOX_W + 40);
    height = Math.max(height, node.y + BOX_H + 40);
  });
  board.strokes.forEach((stroke) =>
    stroke.points.forEach(([x, y]) => {
      width = Math.max(width, x + 20);
      height = Math.max(height, y + 20);
    })
  );

  const selectedNode = selectedId ? nodeById[selectedId] : null;

  function setWorking(next) {
    draftRef.current = next;
    setDraft(next);
  }

  function commit(next) {
    draftRef.current = null;
    setDraft(null);
    onChange(next);
  }

  function pointFromEvent(event) {
    const svg = svgRef.current;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const mapped = point.matrixTransform(svg.getScreenCTM().inverse());
    return { x: mapped.x, y: mapped.y };
  }

  function handleBackgroundDown(event) {
    if (readOnly) return;

    if (tool === "pen") {
      const p = pointFromEvent(event);
      svgRef.current.setPointerCapture(event.pointerId);
      dragRef.current = { type: "pen" };
      setWorking({
        ...value,
        strokes: [
          ...value.strokes,
          { id: `s${Date.now()}`, points: [[Math.round(p.x), Math.round(p.y)]] },
        ],
      });
      return;
    }

    setSelectedId(null);
    setConnectFrom(null);
  }

  function handleNodeDown(event, node) {
    if (readOnly) return;
    event.stopPropagation();

    if (tool === "pen") {
      handleBackgroundDown(event);
      return;
    }

    if (tool === "connect") {
      if (!connectFrom) {
        setConnectFrom(node.id);
        setSelectedId(node.id);
        return;
      }
      if (connectFrom !== node.id) {
        const exists = value.edges.some(
          (edge) => edge.from === connectFrom && edge.to === node.id
        );
        const edges = exists
          ? value.edges.filter((edge) => !(edge.from === connectFrom && edge.to === node.id))
          : [...value.edges, { from: connectFrom, to: node.id }];
        onChange({ ...value, edges });
      }
      setConnectFrom(null);
      return;
    }

    setSelectedId(node.id);
    const p = pointFromEvent(event);
    svgRef.current.setPointerCapture(event.pointerId);
    dragRef.current = { type: "node", id: node.id, dx: p.x - node.x, dy: p.y - node.y };
  }

  function handleMove(event) {
    const drag = dragRef.current;
    if (!drag) return;

    const p = pointFromEvent(event);
    const base = draftRef.current || value;

    if (drag.type === "node") {
      setWorking({
        ...base,
        nodes: base.nodes.map((node) =>
          node.id === drag.id
            ? {
                ...node,
                x: Math.max(0, Math.round(p.x - drag.dx)),
                y: Math.max(0, Math.round(p.y - drag.dy)),
              }
            : node
        ),
      });
    } else {
      const strokes = base.strokes.slice();
      const last = strokes[strokes.length - 1];
      strokes[strokes.length - 1] = {
        ...last,
        points: [...last.points, [Math.round(p.x), Math.round(p.y)]],
      };
      setWorking({ ...base, strokes });
    }
  }

  function handleUp() {
    if (dragRef.current && draftRef.current) {
      commit(draftRef.current);
    }
    dragRef.current = null;
  }

  function addBox() {
    const index = value.nodes.length;
    const node = {
      id: `n${Date.now()}`,
      label: "New box",
      x: 40 + (index % 6) * 40,
      y: 40 + (index % 6) * 40,
    };
    onChange({ ...value, nodes: [...value.nodes, node] });
    setSelectedId(node.id);
    setTool("select");
  }

  function renameSelected(text) {
    onChange({
      ...value,
      nodes: value.nodes.map((node) => (node.id === selectedId ? { ...node, label: text } : node)),
    });
  }

  function deleteSelected() {
    if (!selectedId) return;
    onChange({
      ...value,
      nodes: value.nodes.filter((node) => node.id !== selectedId),
      edges: value.edges.filter((edge) => edge.from !== selectedId && edge.to !== selectedId),
    });
    setSelectedId(null);
    setConnectFrom(null);
  }

  function undoStroke() {
    if (value.strokes.length === 0) return;
    onChange({ ...value, strokes: value.strokes.slice(0, -1) });
  }

  function toolButton(name, label) {
    return (
      <button
        className={tool === name ? "draw-tool active" : "draw-tool"}
        onClick={() => {
          setTool(name);
          setConnectFrom(null);
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div className={compact ? "draw-board compact" : "draw-board"}>
      {!readOnly && (
        <div className="draw-toolbar">
          {toolButton("select", "Move")}
          {toolButton("pen", "Pen")}
          {toolButton("connect", "Connect")}
          <span className="draw-divider" />
          <button className="draw-tool" onClick={addBox}>
            + Box
          </button>
          <button className="draw-tool" onClick={undoStroke}>
            Undo pen
          </button>
          <button className="draw-tool" onClick={deleteSelected} disabled={!selectedId}>
            Delete box
          </button>

          {selectedNode && tool !== "pen" && (
            <input
              className="draw-label-input"
              value={selectedNode.label}
              onChange={(event) => renameSelected(event.target.value)}
              aria-label="Box text"
              placeholder="Box text"
            />
          )}
        </div>
      )}

      {!readOnly && tool === "connect" && (
        <p className="draw-hint">
          {connectFrom
            ? "Now click the box where the arrow should end."
            : "Click the box where the arrow should start. Joining the same two boxes again removes the arrow."}
        </p>
      )}

      <div className="draw-scroll">
        <svg
          ref={svgRef}
          className={`draw-svg tool-${tool}`}
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: "100%", minWidth: compact ? 0 : Math.min(width, 900) }}
          onPointerDown={handleBackgroundDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleUp}
        >
          <defs>
            <marker
              id={markerId}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#8b84b3" />
            </marker>
          </defs>

          {board.strokes.map((stroke) => (
            <polyline
              key={stroke.id}
              points={stroke.points.map((point) => point.join(",")).join(" ")}
              fill="none"
              stroke="#4b4586"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {board.edges.map((edge, index) => {
            const a = nodeById[edge.from];
            const b = nodeById[edge.to];
            if (!a || !b) return null;
            const centerA = { x: a.x + BOX_W / 2, y: a.y + BOX_H / 2 };
            const centerB = { x: b.x + BOX_W / 2, y: b.y + BOX_H / 2 };
            const start = borderPoint(centerA, centerB);
            const end = borderPoint(centerB, centerA);
            return (
              <line
                key={`${edge.from}-${edge.to}-${index}`}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke="#8b84b3"
                strokeWidth="2"
                markerEnd={`url(#${markerId})`}
              />
            );
          })}

          {board.nodes.map((node) => {
            const selected = node.id === selectedId || node.id === connectFrom;
            return (
              <g
                key={node.id}
                className="draw-node"
                onPointerDown={(event) => handleNodeDown(event, node)}
              >
                <rect
                  x={node.x}
                  y={node.y}
                  width={BOX_W}
                  height={BOX_H}
                  rx="12"
                  fill={selected ? "#e7e2fb" : "#f5f3ff"}
                  stroke={selected ? "#6d5bd0" : "#c9c1ee"}
                  strokeWidth={selected ? 2.5 : 1.5}
                />
                <text
                  x={node.x + BOX_W / 2}
                  y={node.y + BOX_H / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="14"
                  fill="#2f2b4d"
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {shortLabel(node.label)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}