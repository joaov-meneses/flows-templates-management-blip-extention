export function StatusBadge({ status }: { status?: string }) {
  return <span className={`ember-status ${(status || "").toLowerCase()}`}>{status || "N/D"}</span>;
}
