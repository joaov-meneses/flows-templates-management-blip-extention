import type { OperationProgress as Progress } from "../../lib/api";

type Props = {
  progress: Progress;
  label: string;
  failed?: number;
  tone?: "primary" | "danger";
};

export function OperationProgress({ progress, label, failed = 0, tone = "primary" }: Props) {
  const percent = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
  return (
    <div className={`operation-progress ${tone}`} role="status" aria-live="polite">
      <div className="operation-progress-copy">
        <strong>{progress.stage}</strong>
        <span>
          {progress.total > 0
            ? `${progress.processed} de ${progress.total} ${label}`
            : "Preparando…"}
          {failed > 0 ? `, ${failed} falha(s)` : ""}
        </span>
      </div>
      <div
        className="operation-progress-track"
        role="progressbar"
        aria-label={progress.stage}
        aria-valuemin={0}
        aria-valuemax={progress.total || 1}
        aria-valuenow={progress.processed}
      >
        <span style={{ transform: `scaleX(${percent / 100})` }} />
      </div>
    </div>
  );
}
