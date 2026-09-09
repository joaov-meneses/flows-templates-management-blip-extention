import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./Button";

export function Feedback({
  children,
  title,
  tone = "danger",
  onDismiss,
  action,
  className = "",
}: {
  children: ReactNode;
  title?: string;
  tone?: "danger" | "success" | "warning" | "info";
  onDismiss?: () => void;
  action?: ReactNode;
  className?: string;
}) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "info" ? Info : AlertCircle;
  return (
    <div
      className={`ember-alert ${tone} ${className}`}
      role={tone === "danger" ? "alert" : "status"}
    >
      <Icon size={20} aria-hidden="true" />
      <div className="feedback-copy">
        {title && <strong>{title}</strong>}
        <div>{children}</div>
        {action && <div className="feedback-actions">{action}</div>}
      </div>
      {onDismiss && (
        <Button
          variant="ghost"
          size="sm"
          className="icon-only"
          aria-label="Fechar aviso"
          onClick={onDismiss}
        >
          <X size={16} aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  loading = false,
}: {
  title: string;
  children?: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="empty-state" role="status" aria-live="polite" aria-busy={loading}>
      {loading ? (
        <div className="loading-lines" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <Info size={24} aria-hidden="true" />
      )}
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
