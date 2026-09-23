export type ActivityView = "routers" | "templates" | "flows" | "bots" | "plugins" | "logs";

export type ActivityEntry = {
  id: string;
  view: ActivityView;
  kind: "request" | "result" | "error";
  title: string;
  status: "running" | "success" | "warning" | "error";
  startedAt: string;
  finishedAt?: string;
  detail?: string;
  payload?: unknown;
};

const MAX_ENTRIES = 200;
const listeners = new Set<() => void>();
let entries: ActivityEntry[] = [];
let activeView: ActivityView = "routers";

function publish(next: ActivityEntry[]) {
  entries = next.slice(0, MAX_ENTRIES);
  listeners.forEach((listener) => listener());
}

export function subscribeActivityLog(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getActivityEntries() {
  return entries;
}

export function setActivityView(view: ActivityView) {
  activeView = view;
}

export function clearActivityLog() {
  publish([]);
}

export function sanitizeActivityValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[detalhes omitidos]";
  if (typeof value === "string") {
    const safe = value
      .replace(/Key\s+[A-Za-z0-9+/=]{8,}/g, "Key [oculta]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[token oculto]");
    return safe.length > 1200 ? `${safe.slice(0, 1200)}… [truncado]` : safe;
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, 30).map((item) => sanitizeActivityValue(item, depth + 1));
    if (value.length > 30) items.push(`[mais ${value.length - 30} itens]`);
    return items;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 40)
        .map(([key, item]) => [
          key,
          /authorization|access.?key|router.?key|secret|token|password|cookie/i.test(key)
            ? "[oculto]"
            : sanitizeActivityValue(item, depth + 1),
        ]),
    );
  }
  return value;
}

export function startActivity(kind: ActivityEntry["kind"], title: string) {
  const id = crypto.randomUUID();
  publish([
    {
      id,
      view: activeView,
      kind,
      title: String(sanitizeActivityValue(title)),
      status: "running",
      startedAt: new Date().toISOString(),
    },
    ...entries,
  ]);
  return id;
}

export function finishActivity(
  id: string,
  status: Exclude<ActivityEntry["status"], "running">,
  detail?: string,
  payload?: unknown,
) {
  publish(
    entries.map((entry) =>
      entry.id === id
        ? {
            ...entry,
            status,
            finishedAt: new Date().toISOString(),
            detail: detail ? String(sanitizeActivityValue(detail)) : undefined,
            payload: payload === undefined ? undefined : sanitizeActivityValue(payload),
          }
        : entry,
    ),
  );
}

export function recordActivityResult(
  title: string,
  payload: unknown,
  status: "success" | "warning" | "error" = "success",
  view: ActivityView = activeView,
) {
  publish([
    {
      id: crypto.randomUUID(),
      view,
      kind: status === "error" ? "error" : "result",
      title: String(sanitizeActivityValue(title)),
      status,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      payload: sanitizeActivityValue(payload),
    },
    ...entries,
  ]);
}
