export type ActivityView =
  | "routers"
  | "templates"
  | "flows"
  | "desk"
  | "bots"
  | "plugins"
  | "downloads"
  | "inactivity"
  | "logs";

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

/** Keep complete session payloads; redact credentials at every depth, including JSON strings. */
export function sanitizeActivityValue(value: unknown, ancestors = new Set<object>()): unknown {
  if (typeof value === "string") {
    if (/^\s*[[{]/.test(value)) {
      try {
        return JSON.stringify(sanitizeActivityValue(JSON.parse(value), ancestors));
      } catch {
        // Plain text and malformed JSON are still useful diagnostics.
      }
    }
    return value
      .replace(/\b(?:Key|Bearer)\s+[A-Za-z0-9+/_=.-]+/gi, "[credencial oculta]")
      .replace(
        /([?&](?:access[_-]?token|api[_-]?key|key|token|password|secret)=)[^&#\s]*/gi,
        "$1[oculto]",
      )
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[token oculto]")
      .replace(
        /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
        "[chave privada oculta]",
      );
  }
  if (value && typeof value === "object") {
    if (ancestors.has(value)) return "[referência circular]";
    const next = new Set(ancestors).add(value);
    if (value instanceof Error)
      return { name: value.name, message: sanitizeActivityValue(value.message) };
    if (Array.isArray(value)) return value.map((item) => sanitizeActivityValue(item, next));
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /authorization|(?:access|router|builder|api|private)[_-]?keys?|secret|token|password|cookie|certificate|credential/i.test(
          key,
        )
          ? "[oculto]"
          : sanitizeActivityValue(item, next),
      ]),
    );
  }
  return value;
}

export function startActivity(kind: ActivityEntry["kind"], title: string, payload?: unknown) {
  const id = crypto.randomUUID();
  publish([
    {
      id,
      view: activeView,
      kind,
      title: String(sanitizeActivityValue(title)),
      status: "running",
      payload: sanitizeActivityValue(payload),
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
            payload: payload === undefined ? entry.payload : sanitizeActivityValue(payload),
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
