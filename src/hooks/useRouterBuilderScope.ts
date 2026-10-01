import { useEffect, useState } from "react";
import { postJson } from "../lib/api";
import type { ResolvedRouterKey, RouterServicesResponse } from "../types/templates";

type ScopeState = {
  routerShortName: string;
  status: "idle" | "loading" | "ready" | "error";
  ids: Set<string> | null;
  error: string;
};

export function useRouterBuilderScope(
  routerShortName: string,
  enabled: boolean,
  resolveKey: (shortName: string) => Promise<ResolvedRouterKey>,
) {
  const [state, setState] = useState<ScopeState>({
    routerShortName: "",
    status: "idle",
    ids: null,
    error: "",
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState({ routerShortName, status: "loading", ids: null, error: "" });
    async function load() {
      try {
        if (!routerShortName)
          throw new Error("Selecione o roteador de origem para consultar seus Builders.");
        const { key } = await resolveKey(routerShortName);
        if (cancelled) return;
        const response = await postJson<RouterServicesResponse>("/api/routers/services", {
          routerShortName,
          routerKey: key,
        });
        if (cancelled) return;
        if (
          response.routerShortName !== routerShortName ||
          !Array.isArray(response.services) ||
          response.services.some((service) => typeof service.shortName !== "string")
        ) {
          throw new Error(
            "A API não retornou os serviços do roteador selecionado. Atualize a lista para tentar novamente.",
          );
        }
        setState({
          routerShortName,
          status: "ready",
          ids: new Set(response.services.map((service) => service.shortName)),
          error: "",
        });
      } catch (error) {
        if (!cancelled)
          setState({
            routerShortName,
            status: "error",
            ids: null,
            error:
              error instanceof Error
                ? error.message
                : "Não foi possível consultar os Builders do roteador.",
          });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [routerShortName, enabled, resolveKey, attempt]);
  const matchesRouter = state.routerShortName === routerShortName;
  return {
    ids: enabled && matchesRouter && state.status === "ready" ? state.ids : null,
    loading: enabled && (!matchesRouter || state.status === "idle" || state.status === "loading"),
    error: enabled && matchesRouter ? state.error : "",
    refresh: () => setAttempt((current) => current + 1),
  };
}
