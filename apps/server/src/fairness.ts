/**
 * Dice fairness.
 *
 * CLAUDE.md: "Server rolls with the seeded PRNG. It publishes sha256(seed) at
 * game start and reveals seed at game end so anyone can verify."
 *
 * The engine cannot do this itself — it has no crypto and no entropy by rule —
 * so the commitment lives here, on the authority side.
 */

import { createHash, randomBytes } from "node:crypto";

/** A fresh, unguessable match seed. */
export function generateSeed(): string {
  return randomBytes(24).toString("base64url");
}

/** The public commitment published when the game starts. */
export function commitToSeed(seed: string): string {
  return createHash("sha256").update(seed, "utf8").digest("hex");
}

/**
 * Check a revealed seed against its commitment.
 *
 * Exposed so the client, a test, or a suspicious player can run the same check
 * the server claims to honour.
 */
export function verifySeed(seed: string, commitment: string): boolean {
  return commitToSeed(seed) === commitment;
}
