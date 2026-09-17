/**
 * Runtime schema for the Action union.
 *
 * This is the security boundary. CLAUDE.md golden rule 2: the server is the only
 * authority and clients never compute outcomes. A client can send any bytes it
 * likes, so every inbound command is parsed here before it reaches the engine,
 * and the engine's own legality check runs after that. Two independent gates:
 * shape, then rules.
 *
 * The union below must mirror `Action` in @hexport/engine exactly. The
 * `satisfies` check at the bottom fails to compile if the two drift apart.
 */

import { z } from "zod";
import type { Action } from "@hexport/engine";

/** Ids are opaque strings the server generated; bound the length. */
const id = z.string().min(1).max(200);
const player = z.number().int().min(0).max(5);

const resource = z.enum(["brick", "lumber", "wool", "grain", "ore"]);

const resourceCounts = z.object({
  brick: z.number().int().min(0).max(100),
  lumber: z.number().int().min(0).max(100),
  wool: z.number().int().min(0).max(100),
  grain: z.number().int().min(0).max(100),
  ore: z.number().int().min(0).max(100),
});

export const actionSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("setupSettlement"), player, node: id }),
  z.object({ t: z.literal("setupRoad"), player, edge: id }),

  z.object({ t: z.literal("rollDice"), player }),
  z.object({ t: z.literal("endTurn"), player }),

  z.object({ t: z.literal("discard"), player, resources: resourceCounts }),
  z.object({ t: z.literal("moveRobber"), player, tile: id }),
  z.object({ t: z.literal("steal"), player, target: player.nullable() }),

  z.object({ t: z.literal("buildRoad"), player, edge: id }),
  z.object({ t: z.literal("buildSettlement"), player, node: id }),
  z.object({ t: z.literal("buildCity"), player, node: id }),
  z.object({ t: z.literal("buyDevCard"), player }),

  z.object({ t: z.literal("playKnight"), player }),
  z.object({ t: z.literal("playRoadBuilding"), player }),
  z.object({ t: z.literal("endRoadBuilding"), player }),
  z.object({
    t: z.literal("playYearOfPlenty"),
    player,
    // Readonly, to match the engine's `readonly [ResourceKind, ResourceKind]`.
    // A mutable tuple is not assignable to a readonly one, and the drift check
    // below catches exactly that.
    resources: z.tuple([resource, resource]).readonly(),
  }),
  z.object({ t: z.literal("playMonopoly"), player, resource }),

  z.object({
    t: z.literal("bankTrade"),
    player,
    give: resource,
    receive: resource,
    rate: z.number().int().min(2).max(4),
  }),
  z.object({
    t: z.literal("offerTrade"),
    player,
    give: resourceCounts,
    receive: resourceCounts,
  }),
  z.object({ t: z.literal("respondTrade"), player, accept: z.boolean() }),
  z.object({
    t: z.literal("counterTrade"),
    player,
    give: resourceCounts,
    receive: resourceCounts,
  }),
  z.object({ t: z.literal("confirmTrade"), player, with: player }),
  z.object({ t: z.literal("cancelTrade"), player }),

  z.object({ t: z.literal("passSpecialBuild"), player }),

  // Seafarers (ADR 0008). Accepted at the wire boundary for every game; the
  // engine still refuses them unless the scenario loaded the module.
  z.object({ t: z.literal("buildShip"), player, edge: id }),
  z.object({ t: z.literal("moveShip"), player, from: id, to: id }),
  z.object({ t: z.literal("takeGold"), player, resource }),
  z.object({ t: z.literal("movePirate"), player, tile: id }),
]);

export type WireAction = z.infer<typeof actionSchema>;

/**
 * Compile-time proof that the schema covers the engine's union and nothing more.
 * If an action is added to the engine without being added here, this line stops
 * compiling — which is the point.
 */
export type ActionSchemaMatchesEngine = WireAction extends Action
  ? Action extends WireAction
    ? true
    : {
        error: "Engine action not accepted by the schema";
        missingTags: Exclude<Action["t"], WireAction["t"]>;
        // An empty `missingTags` means every tag is present but some field
        // shape differs — readonly-ness and nullability are the usual causes.
      }
  : {
      error: "Schema accepts something the engine does not define";
      extraTags: Exclude<WireAction["t"], Action["t"]>;
    };

const _actionsMatch: ActionSchemaMatchesEngine = true;
void _actionsMatch;

/** Parse an untrusted value into an Action, or explain why it is not one. */
export function parseAction(
  input: unknown,
): { ok: true; action: Action } | { ok: false; reason: string } {
  const result = actionSchema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    return {
      ok: false,
      reason:
        first === undefined
          ? "Malformed action."
          : `${first.path.join(".") || "action"}: ${first.message}`,
    };
  }
  return { ok: true, action: result.data as Action };
}
