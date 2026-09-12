import { useMemo, useState } from "react";
import {
  buildBoardGraph,
  seedRng,
  hexCornerPixels,
  hexToPixel,
  nodeToPixel,
  type BoardGraph,
  type Layout,
  type Terrain,
} from "@hexport/engine";
import { loadScenario, SCENARIO_IDS } from "@hexport/scenarios";

/**
 * The ugly 2D SVG debug renderer.
 *
 * PLAN.md is explicit that this is the highest-leverage thing in M0: it makes
 * rules debugging far faster than a 3D scene would, and it stays in the repo as
 * a dev tool forever. When the 3D client lands in M3 this moves behind ?debug=1
 * and the 3D scene becomes a pure view swap over the same engine state.
 *
 * It holds no game logic. Every position on screen is derived from the board
 * graph, and the board graph is derived from a scenario plus a seed.
 */

const LAYOUT: Layout = { orientation: "pointy", size: 1, origin: [0, 0] };

const TERRAIN_FILL: Record<Terrain, string> = {
  forest: "#2f6b3f",
  pasture: "#8cc06a",
  field: "#e3c04f",
  hill: "#b4653a",
  mountain: "#8b8f94",
  desert: "#e6d8ae",
  gold: "#f2c200",
  sea: "#2f6f9f",
};

const EDGE_STROKE: Record<string, string> = {
  land: "#3a3a3a",
  coast: "#d2691e",
  sea: "#1f4d6d",
};

function useQueryParam(name: string, fallback: string): string {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) ?? fallback;
  }, [name, fallback]);
}

function setQueryParam(name: string, value: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set(name, value);
  window.location.href = url.toString();
}

interface Stats {
  tiles: number;
  nodes: number;
  edges: number;
  ports: number;
  edgeKinds: Record<string, number>;
  nodeTileCounts: Record<number, number>;
}

function summarize(board: BoardGraph): Stats {
  const edgeKinds: Record<string, number> = {};
  for (const edge of Object.values(board.edges)) {
    edgeKinds[edge.kind] = (edgeKinds[edge.kind] ?? 0) + 1;
  }
  const nodeTileCounts: Record<number, number> = {};
  for (const node of Object.values(board.nodes)) {
    nodeTileCounts[node.tiles.length] = (nodeTileCounts[node.tiles.length] ?? 0) + 1;
  }
  return {
    tiles: Object.keys(board.tiles).length,
    nodes: Object.keys(board.nodes).length,
    edges: Object.keys(board.edges).length,
    ports: Object.keys(board.ports).length,
    edgeKinds,
    nodeTileCounts,
  };
}

export function DebugBoard(): React.JSX.Element {
  const initialSeed = useQueryParam("seed", "hexport");
  const initialScenario = useQueryParam("scenario", "classic-3-4");

  const [seed, setSeed] = useState(initialSeed);
  const [scenarioId, setScenarioId] = useState(initialScenario);
  const [showNodeIds, setShowNodeIds] = useState(false);
  const [showEdgeIds, setShowEdgeIds] = useState(false);
  const [showNumbers, setShowNumbers] = useState(true);
  const [hovered, setHovered] = useState<string | null>(null);

  const { board, error } = useMemo(() => {
    try {
      const scenario = loadScenario(scenarioId);
      return {
        board: buildBoardGraph(scenario, seedRng(seed)).board,
        error: null as string | null,
      };
    } catch (cause) {
      return {
        board: null,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }, [scenarioId, seed]);

  const geometry = useMemo(() => {
    if (board === null) return null;

    const nodePositions = new Map<string, readonly [number, number]>();
    for (const id of Object.keys(board.nodes)) {
      nodePositions.set(id, nodeToPixel(LAYOUT, id));
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of nodePositions.values()) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    const pad = 0.6;
    return {
      nodePositions,
      viewBox: `${String(minX - pad)} ${String(minY - pad)} ${String(
        maxX - minX + pad * 2,
      )} ${String(maxY - minY + pad * 2)}`,
    };
  }, [board]);

  const stats = useMemo(() => (board === null ? null : summarize(board)), [board]);

  return (
    <div className="debug-root">
      <aside className="panel">
        <h1>hexport board debug</h1>
        <p className="sub">M0 — geometry only. No rules, no game state.</p>

        <label>
          Scenario
          <select
            value={scenarioId}
            onChange={(e) => {
              setScenarioId(e.target.value);
            }}
          >
            {SCENARIO_IDS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>

        <label>
          Seed
          <input
            value={seed}
            onChange={(e) => {
              setSeed(e.target.value);
            }}
          />
        </label>

        <div className="row">
          <button
            onClick={() => {
              setSeed(Math.random().toString(36).slice(2, 10));
            }}
          >
            Random seed
          </button>
          <button
            onClick={() => {
              setQueryParam("seed", seed);
            }}
          >
            Link to this board
          </button>
        </div>

        <fieldset>
          <legend>Overlays</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={showNumbers}
              onChange={(e) => {
                setShowNumbers(e.target.checked);
              }}
            />
            Number tokens
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={showNodeIds}
              onChange={(e) => {
                setShowNodeIds(e.target.checked);
              }}
            />
            Node ids
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={showEdgeIds}
              onChange={(e) => {
                setShowEdgeIds(e.target.checked);
              }}
            />
            Edge ids
          </label>
        </fieldset>

        {stats !== null && (
          <dl className="stats">
            <div>
              <dt>tiles</dt>
              <dd>{stats.tiles}</dd>
            </div>
            <div>
              <dt>nodes</dt>
              <dd>{stats.nodes}</dd>
            </div>
            <div>
              <dt>edges</dt>
              <dd>{stats.edges}</dd>
            </div>
            <div>
              <dt>ports</dt>
              <dd>{stats.ports}</dd>
            </div>
            {Object.entries(stats.edgeKinds).map(([kind, count]) => (
              <div key={kind}>
                <dt>{kind} edges</dt>
                <dd>{count}</dd>
              </div>
            ))}
            {Object.entries(stats.nodeTileCounts)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([tiles, count]) => (
                <div key={tiles}>
                  <dt>nodes touching {tiles}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
          </dl>
        )}

        {hovered !== null && <pre className="hovered">{hovered}</pre>}
      </aside>

      <main className="stage">
        {error !== null && <pre className="error">{error}</pre>}
        {board !== null && geometry !== null && (
          <svg viewBox={geometry.viewBox} className="board">
            {/* tiles */}
            {Object.values(board.tiles).map((tile) => {
              const points = hexCornerPixels(LAYOUT, tile.coord)
                .map(([x, y]) => `${String(x)},${String(y)}`)
                .join(" ");
              const [cx, cy] = hexToPixel(LAYOUT, tile.coord);
              const red = tile.number === 6 || tile.number === 8;
              return (
                <g
                  key={tile.id}
                  onMouseEnter={() => {
                    setHovered(
                      `${tile.id}\ncoord ${String(tile.coord[0])},${String(tile.coord[1])}\n${tile.terrain}${
                        tile.number === null ? "" : ` ${String(tile.number)}`
                      }\nisland ${tile.island ?? "none"}`,
                    );
                  }}
                >
                  <polygon
                    points={points}
                    fill={TERRAIN_FILL[tile.terrain]}
                    stroke="#222"
                    strokeWidth={0.02}
                  />
                  {showNumbers && tile.number !== null && (
                    <>
                      <circle
                        cx={cx}
                        cy={cy}
                        r={0.28}
                        fill="#f4efdf"
                        stroke="#333"
                        strokeWidth={0.02}
                      />
                      <text
                        x={cx}
                        y={cy}
                        className="token"
                        fill={red ? "#b00020" : "#222"}
                      >
                        {tile.number}
                      </text>
                    </>
                  )}
                </g>
              );
            })}

            {/* edges */}
            {Object.values(board.edges).map((edge) => {
              const a = geometry.nodePositions.get(edge.nodes[0]);
              const b = geometry.nodePositions.get(edge.nodes[1]);
              if (a === undefined || b === undefined) return null;
              return (
                <g key={edge.id}>
                  <line
                    x1={a[0]}
                    y1={a[1]}
                    x2={b[0]}
                    y2={b[1]}
                    stroke={EDGE_STROKE[edge.kind] ?? "#000"}
                    strokeWidth={0.035}
                    opacity={0.75}
                    onMouseEnter={() => {
                      setHovered(
                        `${edge.id}\nkind ${edge.kind}\ntiles ${String(edge.tiles.length)}`,
                      );
                    }}
                  />
                  {showEdgeIds && (
                    <text x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2} className="tiny">
                      {edge.id.slice(2, 12)}
                    </text>
                  )}
                </g>
              );
            })}

            {/* ports */}
            {Object.values(board.ports).map((port) => {
              const a = geometry.nodePositions.get(port.nodes[0]);
              const b = geometry.nodePositions.get(port.nodes[1]);
              if (a === undefined || b === undefined) return null;
              const mx = (a[0] + b[0]) / 2;
              const my = (a[1] + b[1]) / 2;
              return (
                <g key={port.id}>
                  <circle
                    cx={mx}
                    cy={my}
                    r={0.22}
                    fill="#fff"
                    stroke="#b00020"
                    strokeWidth={0.04}
                  />
                  <text x={mx} y={my} className="port">
                    {port.kind === "generic"
                      ? "3:1"
                      : `${port.resource?.slice(0, 2) ?? "??"}`}
                  </text>
                </g>
              );
            })}

            {/* nodes */}
            {Object.values(board.nodes).map((node) => {
              const p = geometry.nodePositions.get(node.id);
              if (p === undefined) return null;
              return (
                <g key={node.id}>
                  <circle
                    cx={p[0]}
                    cy={p[1]}
                    r={0.08}
                    fill={node.port === null ? "#111" : "#b00020"}
                    onMouseEnter={() => {
                      setHovered(
                        `${node.id}\ntiles ${String(node.tiles.length)}\nedges ${String(
                          node.edges.length,
                        )}\nport ${node.port ?? "none"}`,
                      );
                    }}
                  />
                  {showNodeIds && (
                    <text x={p[0]} y={p[1] - 0.14} className="tiny">
                      {node.id.slice(2, 10)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </main>
    </div>
  );
}
