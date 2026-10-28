import { useReducer, useRef } from "react";
import { TemplateCatalogCache, type CatalogTemplate } from "../../shared/templateLibrary.mjs";
import { postJson } from "../lib/api";

export function useTemplateCatalog(scope: string) {
  const cache = useRef(new TemplateCatalogCache());
  const [, notify] = useReducer((n) => n + 1, 0);
  const entry = cache.current.entry(scope);
  async function load(sourceScope: string, resolveKey: () => Promise<string>, refresh = false) {
    const pending = cache.current.load(
      sourceScope,
      async () => {
        const sourceRouterKey = await resolveKey();
        return postJson<{ templates: CatalogTemplate[]; complete: boolean }>(
          "/api/templates/catalog",
          { sourceRouterKey },
        );
      },
      refresh,
    );
    notify();
    try {
      return await pending;
    } finally {
      notify();
    }
  }
  function register(sourceScope: string, template: CatalogTemplate) {
    cache.current.register(sourceScope, template);
    notify();
  }
  return { entry, load, register };
}
