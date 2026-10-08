import { useCallback, useEffect, useRef, useState } from "react";
import type { FlowPublicKeyStatus } from "../../shared/flowPublicKey.mjs";
import {
  lookupFlowPublicKey,
  type FlowPublicKeyRouter,
  type FlowRouterKeyResolver,
} from "../lib/flowPublicKeys";

type KeyStatus = FlowPublicKeyStatus & { shortName: string };
type State = {
  scope: string;
  status: "loading" | "ready" | "error";
  entries: KeyStatus[];
  error: string;
};

export function useFlowPublicKeys(
  routers: FlowPublicKeyRouter[],
  enabled: boolean,
  resolveKey?: FlowRouterKeyResolver,
) {
  const scope = JSON.stringify(routers);
  const [state, setState] = useState<State | null>(null);
  const requestId = useRef(0);
  const cancel = useCallback(() => {
    requestId.current++;
  }, []);
  const verify = useCallback(async () => {
    const id = ++requestId.current;
    setState({ scope, status: "loading", entries: [], error: "" });
    try {
      const entries: KeyStatus[] = [];
      for (const router of JSON.parse(scope) as FlowPublicKeyRouter[]) {
        const status = await lookupFlowPublicKey(router, resolveKey);
        if (id !== requestId.current) {
          throw new Error("A seleção de routers mudou durante a consulta. Tente novamente.");
        }
        entries.push({ ...status, shortName: router.shortName });
      }
      if (id === requestId.current) setState({ scope, status: "ready", entries, error: "" });
      return entries;
    } catch (error) {
      if (id === requestId.current)
        setState({
          scope,
          status: "error",
          entries: [],
          error:
            "Não foi possível verificar a public key dos routers selecionados. Confira seu acesso e tente novamente.",
        });
      throw error;
    }
  }, [scope, resolveKey]);
  useEffect(() => {
    if (enabled && routers.length) void verify().catch(() => {});
    return cancel;
  }, [enabled, scope, verify, routers.length, cancel]);
  const current = enabled && state?.scope === scope ? state : null;
  return {
    status: current?.status ?? "loading",
    entries: current?.entries ?? [],
    missing: current?.entries.filter((entry) => !entry.exists) ?? [],
    error: current?.error ?? "",
    verify,
  };
}
