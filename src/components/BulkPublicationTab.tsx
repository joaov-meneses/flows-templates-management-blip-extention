import { useRef, useState } from "react";
import { Bot, Send, X } from "lucide-react";
import { postJson } from "../lib/api";
import { showBlipAlert } from "../lib/blipProxy";
import { recordActivityResult } from "../lib/activityLog";
import type { PortalApplicationAccount, ResolvedRouterKey } from "../types/templates";
import { Button } from "./ui/Button";
import { EmptyState, Feedback } from "./ui/Feedback";
import "../styles/bulk-publication.css";

type PublicationResult = {
  builderShortName: string;
  published: boolean;
  states?: number;
  publicationIndex?: number;
  error?: string;
};

export function BulkPublicationTab({
  applications,
  onSelect,
  onRemove,
  resolveKey,
  embedded,
  onBusyChange,
}: {
  applications: PortalApplicationAccount[];
  onSelect: () => void;
  onRemove: (shortName: string) => void;
  resolveKey: (shortName: string) => Promise<ResolvedRouterKey>;
  embedded: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [results, setResults] = useState<Record<string, PublicationResult>>({});
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const [activeBot, setActiveBot] = useState("");

  async function publish() {
    if (lock.current || !applications.length || !embedded) return;
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setConfirming(true);
    try {
      const confirmed = await showBlipAlert({
        variant: "warning",
        icon: "warning",
        title: "Publicar os fluxos em massa?",
        body: `O rascunho completo de ${applications.length} Builder(s) será publicado e passará a valer no atendimento: ${applications.map((app) => app.name).join(", ")}. Todas as alterações pendentes de cada fluxo serão incluídas. Deseja continuar?`,
        buttons: { cancel: "Cancelar", confirm: "Publicar fluxos" },
      });
      if (!confirmed) return;
      setConfirming(false);
      setResults({});
      setSummary("");
      setProgress({ processed: 0, total: applications.length });
      let published = 0;
      let failed = 0;
      let warnings = 0;
      for (const [index, application] of applications.entries()) {
        setActiveBot(application.shortName);
        let result: PublicationResult;
        try {
          const { key } = await resolveKey(application.shortName);
          result = await postJson<PublicationResult>("/api/builders/publish", {
            builderShortName: application.shortName,
            builderKey: key,
          });
          if (
            result.builderShortName !== application.shortName ||
            typeof result.published !== "boolean"
          )
            throw new Error(
              "A resposta não confirmou o Builder selecionado. Confira o fluxo no Builder antes de repetir.",
            );
        } catch (caughtError) {
          result = {
            builderShortName: application.shortName,
            published: false,
            error:
              caughtError instanceof Error
                ? caughtError.message
                : "Não foi possível confirmar a publicação. Confira o Builder antes de repetir.",
          };
        }
        if (result.published) published++;
        else failed++;
        if (result.published && result.error) warnings++;
        setResults((current) => ({ ...current, [application.shortName]: result }));
        setProgress({ processed: index + 1, total: applications.length });
        recordActivityResult(
          `Publicação em massa: ${application.name}`,
          result,
          result.error ? (result.published ? "warning" : "error") : "success",
          "bots",
        );
      }
      setSummary(
        `${published} fluxo(s) com publicação confirmada${warnings ? ` · ${warnings} com aviso de registro` : ""}${failed ? ` · ${failed} sem publicação confirmada` : ""}.`,
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Não foi possível abrir a confirmação de publicação.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
      setConfirming(false);
      setActiveBot("");
      onBusyChange(false);
    }
  }

  return (
    <div className="bulk-publication" aria-label="Publicação em Massa">
      <div className="bulk-publication-actions">
        <p>{applications.length} Builder(s) selecionado(s)</p>
        <Button onClick={onSelect} disabled={!embedded || busy}>
          <Bot size={18} aria-hidden="true" /> Selecionar Builders
        </Button>
        <Button
          variant="primary"
          onClick={() => void publish()}
          loading={busy}
          disabled={!embedded || !applications.length}
        >
          {!busy && <Send size={18} aria-hidden="true" />} Publicar {applications.length} bot(s)
        </Button>
      </div>
      {!embedded && (
        <Feedback tone="info">
          Abra a extensão no Portal Blip para selecionar e publicar os Builders.
        </Feedback>
      )}
      <p className="bulk-publication-note">
        Publica o rascunho completo de cada Builder, incluindo as alterações pendentes. Os bots são
        processados individualmente.
      </p>
      {error && (
        <Feedback title="Publicação não iniciada" onDismiss={() => setError("")}>
          {error}
        </Feedback>
      )}
      {summary && <Feedback tone="info">{summary}</Feedback>}
      {busy && (
        <p role="status" aria-live="polite">
          {confirming
            ? "Aguardando confirmação de publicação…"
            : `Publicando ${progress.processed}/${progress.total} bot(s)…`}
        </p>
      )}
      {applications.length === 0 ? (
        <EmptyState title="Selecione os Builders para publicar">
          Escolha os Builders do roteador ou todos aos quais você tem acesso no contrato.
        </EmptyState>
      ) : (
        <ul className="bulk-publication-list">
          {applications.map((application) => {
            const result = results[application.shortName];
            return (
              <li key={application.shortName} className="bulk-publication-row">
                <div className="bulk-publication-bot">
                  <span className="router-application-avatar" aria-hidden="true">
                    {application.imageUri ? (
                      <img src={application.imageUri} alt="" />
                    ) : (
                      application.name.slice(0, 1).toUpperCase()
                    )}
                  </span>
                  <div>
                    <strong>{application.name}</strong>
                    <span>{application.shortName}</span>
                  </div>
                </div>
                <span className="bulk-publication-status" role="status">
                  {activeBot === application.shortName
                    ? "Publicando…"
                    : result
                      ? result.published
                        ? `Publicado${result.publicationIndex ? ` · versão ${result.publicationIndex}` : ""}${result.error ? " · com aviso" : ""}`
                        : "Publicação não confirmada"
                      : "Aguardando publicação"}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remover ${application.name}`}
                  onClick={() => onRemove(application.shortName)}
                  disabled={busy}
                >
                  <X size={16} aria-hidden="true" /> Remover
                </Button>
                {result?.error && (
                  <Feedback
                    className="bulk-publication-error"
                    tone={result.published ? "warning" : "danger"}
                  >
                    {result.error}
                  </Feedback>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
