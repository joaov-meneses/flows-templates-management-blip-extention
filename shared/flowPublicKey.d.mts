export type FlowPublicKeyStatus = { exists: boolean; signatureStatus: string | null };
export const FLOW_PUBLIC_KEY_URI: string;
export function readFlowPublicKeyStatus(response: unknown, shortName?: string): FlowPublicKeyStatus;
export function buildFlowPublicKeyCommand(
  shortName: string,
  id: string,
): {
  id: string;
  from: string;
  to: string;
  method: "get";
  uri: string;
};
