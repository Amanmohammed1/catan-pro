import { useMemo } from "react";
import {
  hexCornerPixels,
  hexToPixel,
  nodeToPixel,
  type BoardGraph,
  type Building,
  type EdgeId,
  type Layout,
  type NodeId,
  type PlayerId,
  type Terrain,
  type TileId,
} from "@hexport/engine";

/**
 * The playable board.
 *
 * CLAUDE.md, "Client rules": this is a view of engine state and holds no game
 * logic. It does not know the distance rule or what a road costs. Every
 * highlighted spot is passed in, derived from legalMoves by the caller, which is
 * what keeps the engine the single source of truth (golden rule 3).
 *
 * It takes only public board data, never a GameState, so the same component
 * renders a hot-seat game and a redacted online one.
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

const TERRAIN_LABEL: Record<Terrain, string> = {
  forest: "lumber",
  pasture: "wool",
  field: "grain",
  hill: "brick",
  mountain: "ore",
  desert: "desert",
  gold: "gold",
  sea: "sea",
};

export interface BoardViewProps {
  readonly board: BoardGraph;
  readonly roads: Readonly<Record<EdgeId, PlayerId>>;
  readonly buildings: Readonly<Record<NodeId, Building>>;
  readonly robber: TileId;
  /** Seat colours, indexed by player. */
  readonly colors: readonly string[];
  readonly highlightNodes: ReadonlySet<NodeId>;
  readonly highlightEdges: ReadonlySet<EdgeId>;
  readonly highlightTiles: ReadonlySet<TileId>;
  readonly onNode?: ((node: NodeId) => void) | undefined;
  readonly onEdge?: ((edge: EdgeId) => void) | undefined;
  readonly onTile?: ((tile: TileId) => void) | undefined;
  readonly showIds?: boolean;
}

export function BoardView({
  board,
  roads,
  buildings,
  robber,
  colors,
  highlightNodes,
  highlightEdges,
  highlightTiles,
  onNode,
  onEdge,
  onTile,
  showIds = false,
}: BoardViewProps): React.JSX.Element {
  const geometry = useMemo(() => {
    const positions = new Map<string, readonly [number, number]>();
    for (const id of Object.keys(board.nodes)) {
      positions.set(id, nodeToPixel(LAYOUT, id));
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of positions.values()) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    const pad = 0.8;
    return {
      positions,
      viewBox: [minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2]
        .map((n) => n.toFixed(3))
        .join(" "),
    };
  }, [board]);

  const colorOf = (player: number): string => colors[player] ?? "#888";

  return (
    <svg viewBox={geometry.viewBox} className="board" role="img">
      <title>Game board</title>

      {/* terrain */}
      {Object.values(board.tiles).map((tile) => {
        const points = hexCornerPixels(LAYOUT, tile.coord)
          .map(([x, y]) => `${String(x)},${String(y)}`)
          .join(" ");
        const [cx, cy] = hexToPixel(LAYOUT, tile.coord);
        const red = tile.number === 6 || tile.number === 8;
        const targetable = highlightTiles.has(tile.id);

        return (
          <g
            key={tile.id}
            className={targetable ? "tile targetable" : "tile"}
            onClick={targetable ? () => onTile?.(tile.id) : undefined}
          >
            <polygon
              points={points}
              fill={TERRAIN_FILL[tile.terrain]}
              stroke="#1d1d1d"
              strokeWidth={0.025}
            />
            <title>
              {`${TERRAIN_LABEL[tile.terrain]}${tile.number === null ? "" : ` ${String(tile.number)}`}`}
            </title>

            {tile.number !== null && (
              <>
                <circle
                  cx={cx}
                  cy={cy}
                  r={0.3}
                  fill="#f6f1e2"
                  stroke="#2b2b2b"
                  strokeWidth={0.025}
                />
                <text
                  x={cx}
                  y={cy - 0.03}
                  className="token"
                  fill={red ? "#b00020" : "#222"}
                >
                  {tile.number}
                </text>
                <text
                  x={cx}
                  y={cy + 0.17}
                  className="pips"
                  fill={red ? "#b00020" : "#444"}
                >
                  {pips(tile.number)}
                </text>
              </>
            )}

            {targetable && (
              <polygon
                points={points}
                fill="#ffffff"
                opacity={0.35}
                className="tile-highlight"
              />
            )}
          </g>
        );
      })}

      {/* the robber */}
      {(() => {
        const tile = board.tiles[robber];
        if (tile === undefined) return null;
        const [x, y] = hexToPixel(LAYOUT, tile.coord);
        return (
          <g className="robber" pointerEvents="none">
            <ellipse
              cx={x}
              cy={y + 0.42}
              rx={0.17}
              ry={0.05}
              fill="#000"
              opacity={0.35}
            />
            <path
              d={`M ${String(x - 0.15)} ${String(y + 0.4)}
                  q 0 -0.34 0.15 -0.42
                  q 0.15 0.08 0.15 0.42 Z`}
              fill="#2b2b2b"
            />
            <circle cx={x} cy={y - 0.12} r={0.11} fill="#2b2b2b" />
          </g>
        );
      })()}

      {/* roads */}
      {Object.values(board.edges).map((edge) => {
        const a = geometry.positions.get(edge.nodes[0]);
        const b = geometry.positions.get(edge.nodes[1]);
        if (a === undefined || b === undefined) return null;
        const owner = roads[edge.id];
        const targetable = highlightEdges.has(edge.id);

        return (
          <g key={edge.id}>
            {owner !== undefined && (
              <line
                x1={a[0]}
                y1={a[1]}
                x2={b[0]}
                y2={b[1]}
                stroke={colorOf(owner)}
                strokeWidth={0.13}
                strokeLinecap="round"
                className="road"
              />
            )}
            {targetable && (
              <line
                x1={a[0]}
                y1={a[1]}
                x2={b[0]}
                y2={b[1]}
                className="edge-target"
                onClick={() => onEdge?.(edge.id)}
              />
            )}
            {showIds && (
              <text x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2} className="tiny">
                {edge.id.slice(2, 10)}
              </text>
            )}
          </g>
        );
      })}

      {/* harbors */}
      {Object.values(board.ports).map((port) => {
        const a = geometry.positions.get(port.nodes[0]);
        const b = geometry.positions.get(port.nodes[1]);
        if (a === undefined || b === undefined) return null;
        const mx = (a[0] + b[0]) / 2;
        const my = (a[1] + b[1]) / 2;
        return (
          <g key={port.id} className="port" pointerEvents="none">
            <circle
              cx={mx}
              cy={my}
              r={0.21}
              fill="#f6f1e2"
              stroke="#1f4d6d"
              strokeWidth={0.04}
            />
            <text x={mx} y={my} className="port-label">
              {port.kind === "generic" ? "3:1" : `2:1`}
            </text>
            {port.kind === "resource" && (
              <text x={mx} y={my + 0.28} className="port-resource">
                {port.resource}
              </text>
            )}
          </g>
        );
      })}

      {/* buildings */}
      {Object.entries(buildings).map(([nodeId, building]) => {
        const p = geometry.positions.get(nodeId);
        if (p === undefined) return null;
        const [x, y] = p;
        const fill = colorOf(building.player);

        if (building.kind === "city") {
          return (
            <g key={nodeId} className="building" pointerEvents="none">
              <rect
                x={x - 0.15}
                y={y - 0.11}
                width={0.3}
                height={0.22}
                fill={fill}
                stroke="#1d1d1d"
                strokeWidth={0.03}
              />
              <polygon
                points={`${String(x - 0.15)},${String(y - 0.11)} ${String(x)},${String(y - 0.26)} ${String(x + 0.15)},${String(y - 0.11)}`}
                fill={fill}
                stroke="#1d1d1d"
                strokeWidth={0.03}
              />
            </g>
          );
        }

        return (
          <g key={nodeId} className="building" pointerEvents="none">
            <polygon
              points={`${String(x - 0.11)},${String(y + 0.11)} ${String(x - 0.11)},${String(y - 0.04)} ${String(x)},${String(y - 0.16)} ${String(x + 0.11)},${String(y - 0.04)} ${String(x + 0.11)},${String(y + 0.11)}`}
              fill={fill}
              stroke="#1d1d1d"
              strokeWidth={0.03}
            />
          </g>
        );
      })}

      {/* placement targets */}
      {[...highlightNodes].map((nodeId) => {
        const p = geometry.positions.get(nodeId);
        if (p === undefined) return null;
        return (
          <circle
            key={nodeId}
            cx={p[0]}
            cy={p[1]}
            r={0.17}
            className="node-target"
            onClick={() => onNode?.(nodeId)}
          />
        );
      })}

      {showIds &&
        Object.keys(board.nodes).map((nodeId) => {
          const p = geometry.positions.get(nodeId);
          if (p === undefined) return null;
          return (
            <text key={nodeId} x={p[0]} y={p[1] - 0.2} className="tiny">
              {nodeId.slice(2, 10)}
            </text>
          );
        })}
    </svg>
  );
}

/** Probability dots under a number token, as printed on the real tiles (p.10). */
function pips(value: number): string {
  const ways = 6 - Math.abs(7 - value);
  return "•".repeat(Math.max(0, ways));
}
