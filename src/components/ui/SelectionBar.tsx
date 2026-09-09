import type { ReactNode } from "react";
import { CopyPlus, Network, X } from "lucide-react";
import { Button } from "./Button";

export function SelectionBar({
  count,
  targets,
  loading,
  disabled,
  onTargets,
  onReplicate,
  onClear,
  children,
}: {
  count: number;
  targets: number;
  loading: boolean;
  disabled?: boolean;
  onTargets: () => void;
  onReplicate: () => void;
  onClear: () => void;
  children?: ReactNode;
}) {
  if (!count) return null;
  return (
    <div className="selection-bar" role="region" aria-label="Ações da seleção">
      <div className="selection-count">
        <Button
          variant="ghost"
          size="sm"
          className="icon-only"
          aria-label="Limpar seleção"
          onClick={onClear}
          disabled={loading}
        >
          <X size={16} aria-hidden="true" />
        </Button>
        <strong aria-live="polite">
          {count} {count === 1 ? "selecionado" : "selecionados"}
        </strong>
      </div>
      <div className="selection-actions">
        <Button onClick={onTargets} disabled={loading}>
          <Network size={16} aria-hidden="true" />
          {targets ? `Destinos (${targets})` : "Selecionar destinos"}
        </Button>
        {children}
        <Button variant="primary" onClick={onReplicate} loading={loading} disabled={disabled}>
          {!loading && <CopyPlus size={16} aria-hidden="true" />}
          {loading ? "Replicando…" : "Replicar"}
        </Button>
      </div>
    </div>
  );
}
