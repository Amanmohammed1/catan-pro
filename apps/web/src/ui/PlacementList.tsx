import { useState } from "react";
import type { Action, BoardGraph, EdgeId, NodeId, TileId } from "@hexport/engine";
import { describeEdge, describeNode, describeTile } from "./describeBoard.js";

/**
 * Every legal placement, as buttons.
 *
 * The board is a WebGL canvas. Clicking a mesh is the fast way to play, but it
 * is unreachable by keyboard and invisible to a screen reader, which would make
 * the game unplayable for anyone who needs either. This is the same set of
 * moves, in the DOM, described in terms of the hexes involved.
 *
 * It is not a fallback bolted on for compliance — it is often the more precise
 * way to pick a spot on a crowded board, so it is available to everyone.
 */
export function PlacementList({
  board,
  nodes,
  edges,
  tiles,
  onAction,
}: {
  readonly board: BoardGraph;
  readonly nodes: ReadonlyMap<NodeId, Action>;
  readonly edges: ReadonlyMap<EdgeId, Action>;
  readonly tiles: ReadonlyMap<TileId, Action>;
  readonly onAction: (action: Action) => void;
}): React.JSX.Element | null {
  const total = nodes.size + edges.size + tiles.size;
  const [open, setOpen] = useState(false);

  if (total === 0) return null;

  const entries: { key: string; label: string; action: Action }[] = [
    ...[...nodes].map(([node, action]) => ({
      key: node,
      label: describeNode(board, node),
      action,
    })),
    ...[...edges].map(([edge, action]) => ({
      key: edge,
      label: describeEdge(board, edge),
      action,
    })),
    ...[...tiles].map(([tile, action]) => ({
      key: tile,
      label: describeTile(board, tile),
      action,
    })),
  ];

  return (
    <section className="mt-2 rounded-card border border-accent/35 bg-accent/8">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="flex w-full items-center justify-between px-2.5 py-1.5 text-xs text-accent"
      >
        <span>
          {total} place{total === 1 ? "" : "s"} to choose from
        </span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <ul className="max-h-56 overflow-y-auto border-t border-accent/25 p-1.5">
          {entries.map((entry) => (
            <li key={entry.key}>
              <button
                type="button"
                data-placement={entry.key}
                onClick={() => {
                  onAction(entry.action);
                }}
                className="w-full rounded px-2 py-1.5 text-left text-xs text-ink-300 transition-colors hover:bg-accent/15 hover:text-accent"
              >
                {entry.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Collapsed, the options still need to be reachable by keyboard and
          readable by a screen reader, so they stay in the accessibility tree. */}
      {!open && (
        <ul className="sr-only">
          {entries.map((entry) => (
            <li key={entry.key}>
              <button
                type="button"
                data-placement={entry.key}
                onClick={() => {
                  onAction(entry.action);
                }}
              >
                {entry.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
