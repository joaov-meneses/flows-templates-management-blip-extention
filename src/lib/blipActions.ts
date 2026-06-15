export const BLIP_ACTIONS = {
  GET_ACCOUNT: "getAccount",
  GET_APPLICATION: "getApplication",
  SEND_COMMAND: "sendCommand",
  HEIGHT_CHANGE: "heightChange",
} as const;

export const COMMAND_METHODS = {
  GET: "get",
  SET: "set",
  MERGE: "merge",
  DELETE: "delete",
  SUBSCRIBE: "subscribe",
  UNSUBSCRIBE: "unsubscribe",
  OBSERVE: "observe",
} as const;
