import { useState, type ComponentProps } from "react";
import { DeskQueuesTab } from "./DeskQueuesTab";
import { DeskBulkTab } from "./DeskBulkTab";
import "../styles/desk-bulk.css";

export type AttendanceProps = ComponentProps<typeof DeskQueuesTab>;
const tabs = [
  { id: "queues", label: "Gerenciamento de filas" },
  { id: "bulk", label: "Finalização em massa" },
] as const;

export function AttendanceTab(props: AttendanceProps) {
  const [tab, setTab] = useState<"queues" | "bulk">("queues");
  const [busy, setBusy] = useState(false);
  const childProps = {
    ...props,
    onBusyChange: (value: boolean) => {
      setBusy(value);
      props.onBusyChange(value);
    },
  };
  return (
    <>
      <div className="ember-subtabs attendance-tabs" role="tablist" aria-label="Atendimento">
        {tabs.map((item, index) => (
          <button
            key={item.id}
            id={`attendance-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`attendance-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            className={tab === item.id ? "active" : ""}
            disabled={busy}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => {
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : event.key === "ArrowRight"
                      ? (index + 1) % tabs.length
                      : event.key === "ArrowLeft"
                        ? (index + tabs.length - 1) % tabs.length
                        : null;
              if (next == null) return;
              event.preventDefault();
              setTab(tabs[next].id);
              document.getElementById(`attendance-tab-${tabs[next].id}`)?.focus();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div id={`attendance-panel-${tab}`} role="tabpanel" aria-labelledby={`attendance-tab-${tab}`}>
        {tab === "queues" ? <DeskQueuesTab {...childProps} /> : <DeskBulkTab {...childProps} />}
      </div>
    </>
  );
}
