/**
 * @hexport/protocol — the client/server wire contract.
 *
 * Depends on the engine for types only. It never reaches into game logic; its
 * whole job is to make sure nothing malformed gets that far.
 */

export {
  actionSchema,
  parseAction,
  type ActionSchemaMatchesEngine,
  type WireAction,
} from "./action.js";

export {
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  clientMessageSchema,
  decodeClientFrame,
  encode,
  parseClientMessage,
  type ChatLine,
  type ClientMessage,
  type ErrorCode,
  type RoomSeat,
  type RoomView,
  type ServerMessage,
  type TimerState,
  type WireView,
} from "./messages.js";
