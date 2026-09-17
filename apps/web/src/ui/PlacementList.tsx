import type { Action, BoardGraph, EdgeId, NodeId, TileId } from "@hexport/engine";
import { describeEdge, describeNode, describeTile } from "./describeBoard.js";
import { useUi } from "../store/ui.js";

/**
 * Every legal placement, as buttons.
 *
 * The board is a WebGL canvas. Clicking a mesh is the fast way to play, but it
 * is unreachable by keyboard and invisible to a screen reader, which would make
 * the game unplayable for anyone who needs either. This is the same set of
 * moves, in the DOM, described in terms of the hexes involved.
 *
 * It is not a fallback bolted on for compliance — it is often the more precise
 * way to pick a spot on a crowded board, so it is available to everyone, and
 * whether it is expanded is a saved preference (the "List" toggle in the bar).
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
  const open = useUi((s) => s.listView);
  const toggle = useUi((s) => s.toggleListView);
  const total = nodes.size + edges.size + tiles.size;

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

  const buttons = entries.map((entry) => (
    <li key={entry.key}>
      <button
        type="button"
        data-placement={entry.key}
        onClick={() => {
          onAction(entry.action);
        }}
        className="w-full rounded-[8px] px-2.5 py-2 text-left text-xs text-ink-300 transition-colors hover:bg-gold/15 hover:text-gold"
      >
        {entry.label}
      </button>
    </li>
  ));

  return (
    <section className="mt-3 overflow-hidden rounded-[11px] border border-gold/30 bg-gold/8">
      <button
        type="button"
        aria-expanded={open}
        data-action="toggle-list"
        onClick={toggle}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-gold"
      >
        <span>
          {total} place{total === 1 ? "" : "s"} to choose from
        </span>
        <span aria-hidden="true" className="text-sm">
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <ul className="max-h-64 overflow-y-auto border-t border-gold/20 p-1.5">{buttons}</ul>
      )}

      {/* Collapsed, the options still need to be reachable by keyboard and
          readable by a screen reader, so they stay in the accessibility tree. */}
      {!open && <ul className="sr-only">{buttons}</ul>}
    </section>
  );
}
