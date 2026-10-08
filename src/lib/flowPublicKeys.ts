import type { FlowPublicKeyStatus } from "../../shared/flowPublicKey.mjs";
import { postJson } from "./api.ts";

export type FlowPublicKeyRouter = { shortName: string; key?: string };
export type FlowRouterKeyResolver = (
  shortName: string,
) => Promise<{ shortName: string; key: string }>;

export async function lookupFlowPublicKey(
  router: FlowPublicKeyRouter,
  resolveKey?: FlowRouterKeyResolver,
): Promise<FlowPublicKeyStatus> {
  let key = router.key?.trim();
  if (!key && resolveKey) {
    const resolved = await resolveKey(router.shortName);
    if (resolved.shortName !== router.shortName) {
      throw new Error("A consulta da key respondeu por outro router. Tente novamente.");
    }
    key = resolved.key.trim();
  }
  if (!key) throw new Error("Não foi possível obter a key do router selecionado.");

  // Authenticate as the selected router. Setting `from` on a Portal command
  // instead creates a delegated envelope, which requires `pp` and permission.
  const status = await postJson<FlowPublicKeyStatus>("/api/flows/public-key", {
    sourceRouterKey: key,
  });
  if (typeof status.exists !== "boolean") {
    throw new Error("A consulta da public key retornou dados incompletos.");
  }
  return status;
}
