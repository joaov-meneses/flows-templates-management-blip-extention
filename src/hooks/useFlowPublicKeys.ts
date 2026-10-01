import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildFlowPublicKeyCommand,
  readFlowPublicKeyStatus,
  type FlowPublicKeyStatus,
} from "../../shared/flowPublicKey.mjs";
import { sendBlipCommand } from "../lib/blipProxy";
import { postJson } from "../lib/api";

type Router = { shortName: string; key?: string };
type KeyStatus = FlowPublicKeyStatus & { shortName: string };
type State = {
  scope: string;
  status: "loading" | "ready" | "error";
  entries: KeyStatus[];
  error: string;
};

export function useFlowPublicKeys(routers: Router[], enabled: boolean, embedded: boolean) {
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
      for (const router of JSON.parse(scope) as Router[]) {
        let status: FlowPublicKeyStatus;
        if (embedded) {
          const response = await sendBlipCommand(
            buildFlowPublicKeyCommand(router.shortName, crypto.randomUUID()),
            { destination: "BlipService", timeout: 30000 },
          );
          status = readFlowPublicKeyStatus(response, router.shortName);
        } else {
          status = await postJson<FlowPublicKeyStatus>("/api/flows/public-key", {
            sourceRouterKey: router.key,
          });
          if (typeof status.exists !== "boolean")
            throw new Error("A consulta da public key retornou dados incompletos.");
        }
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
  }, [scope, embedded]);
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
