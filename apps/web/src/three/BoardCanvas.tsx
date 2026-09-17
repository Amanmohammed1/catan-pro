import { Suspense, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import type {
  Action,
  BoardGraph,
  Building,
  EdgeId,
  NodeId,
  PlayerId,
  TileId,
} from "@hexport/engine";
import { frameCamera, Scene, type OrbitHandle } from "./Scene.js";
import { Tiles } from "./Tiles.js";
import { Props } from "./Props.js";
import { Roads, Buildings } from "./Pieces.js";
import { NumberTokens } from "./NumberTokens.js";
import { Robber } from "./Robber.js";
import { Harbors } from "./Harbors.js";
import { Frame } from "./Frame.js";
import { Effects } from "./Effects.js";
import { EdgePlacements, NodePlacements } from "./Placement.js";
import { FrameMeter, type FrameStats } from "./FrameMeter.js";
import { boardBounds, CAMERA_FOV } from "./layout3d.js";
import { useUi } from "../store/ui.js";

/**
 * The 3D board.
 *
 * A view of engine state and nothing more (CLAUDE.md, "Client rules"). Every
 * highlighted intersection, path and hex is passed in, derived by the caller
 * from legalMoves. This component could not tell you what a settlement costs.
 */

export interface BoardCanvasProps {
  readonly board: BoardGraph;
  readonly roads: Readonly<Record<EdgeId, PlayerId>>;
  readonly buildings: Readonly<Record<NodeId, Building>>;
  readonly robber: TileId;
  readonly colors: readonly string[];
  /** Intersections the player may build on right now, and with what. */
  readonly nodeTargets: ReadonlyMap<NodeId, Action>;
  readonly edgeTargets: ReadonlyMap<EdgeId, Action>;
  readonly tileTargets: ReadonlyMap<TileId, Action>;
  /** Which piece the ghost should show at an intersection. */
  readonly nodeGhost: "settlement" | "city";
  readonly onAction: (action: Action) => void;
  readonly youColor: string;
  readonly showStats?: boolean;
  /** Hexes that just paid out; flashed briefly. Driven by the event log. */
  readonly producing?: ReadonlySet<TileId> | undefined;
}

export function BoardCanvas({
  board,
  roads,
  buildings,
  robber,
  colors,
  nodeTargets,
  edgeTargets,
  tileTargets,
  nodeGhost,
  onAction,
  youColor,
  showStats = false,
  producing,
}: BoardCanvasProps): React.JSX.Element {
  const controls = useRef<OrbitHandle>(null);
  const [stats, setStats] = useState<FrameStats | null>(null);
  const setLowPower = useUi((s) => s.setLowPower);
  const bounds = useMemo(() => boardBounds(board), [board]);

  const nodeKeys = useMemo(() => new Set(nodeTargets.keys()), [nodeTargets]);
  const edgeKeys = useMemo(() => new Set(edgeTargets.keys()), [edgeTargets]);
  const tileKeys = useMemo(() => new Set(tileTargets.keys()), [tileTargets]);

  return (
    <div className="relative h-full w-full">
      <Canvas
        shadows
        dpr={[1, 1.75]}
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
        }}
        camera={{ fov: CAMERA_FOV, near: 0.5, far: 200 }}
        // Decorative: the board is described in text elsewhere for anyone who
        // cannot see it, and every move is reachable from the DOM controls.
        aria-hidden="true"
      >
        <color attach="background" args={["#120b07"]} />
        <PerformanceMonitor
          onDecline={() => {
            setLowPower(true);
          }}
        />

        <Suspense fallback={null}>
          <Scene bounds={bounds} controlsRef={controls} />
          <Frame board={board} />

          <Tiles
            board={board}
            highlighted={tileKeys}
            producing={producing}
            onPick={(tile) => {
              const action = tileTargets.get(tile);
              if (action !== undefined) onAction(action);
            }}
          />
          <Props board={board} />
          <NumberTokens board={board} blockedTile={robber} />
          <Harbors board={board} />
          <Roads board={board} roads={roads} colors={colors} />
          <Buildings buildings={buildings} colors={colors} />
          <Robber board={board} tile={robber} />

          <NodePlacements
            nodes={nodeKeys}
            kind={nodeGhost}
            color={youColor}
            onPick={(node) => {
              const action = nodeTargets.get(node);
              if (action !== undefined) onAction(action);
            }}
          />
          <EdgePlacements
            board={board}
            edges={edgeKeys}
            color={youColor}
            onPick={(edge) => {
              const action = edgeTargets.get(edge);
              if (action !== undefined) onAction(action);
            }}
          />

          <Effects />
        </Suspense>

        {showStats && <FrameMeter onSample={setStats} />}
      </Canvas>

      <button
        type="button"
        onClick={() => {
          const current = controls.current;
          if (current === null) return;
          frameCamera(current.object, current, bounds);
        }}
        className="absolute right-3 bottom-3 rounded-full border border-gold/25 bg-surface-800/85 px-3.5 py-1.5 text-xs font-medium text-ink-300 shadow-lift backdrop-blur transition hover:border-gold/50 hover:text-ink-100"
      >
        Reset view
      </button>

      {showStats && stats !== null && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-surface-900/85 px-2.5 py-1.5 font-mono text-[11px] text-ink-300 tabular-nums">
          {stats.fps} fps · {stats.frameMs} ms · {stats.drawCalls} draws ·{" "}
          {stats.triangles.toLocaleString()} tris
        </div>
      )}
    </div>
  );
}
