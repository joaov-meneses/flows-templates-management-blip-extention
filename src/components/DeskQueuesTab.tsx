import { useEffect, useRef, useState } from "react";
import { Bot, CopyPlus, Download, Headset, LoaderCircle, Pencil, RefreshCw, X } from "lucide-react";
import { useModalFocus } from "../hooks/useModalFocus";
import { postJson } from "../lib/api";
import { saveDownload } from "../lib/builderDownload";
import { showBlipAlert } from "../lib/blipProxy";
import { filterBuilderPickerApplications } from "../lib/builderPicker";
import type { PortalApplicationAccount, ResolvedRouterKey } from "../types/templates";
import type { DeskAction, DeskPreview, DeskQueue, DeskResult } from "../types/desk";
import { Button } from "./ui/Button";
import { EmptyState, Feedback } from "./ui/Feedback";
import "../styles/desk-queues.css";

export function DeskQueuesTab({
  application,
  onSelectBuilder,
  applications,
  resolveKey,
  embedded,
  loading,
  loadError,
  onRefresh,
  onBusyChange,
}: {
  application: PortalApplicationAccount | null;
  onSelectBuilder: () => void;
  applications: PortalApplicationAccount[];
  resolveKey: (id: string) => Promise<ResolvedRouterKey>;
  embedded: boolean;
  loading: boolean;
  loadError: string;
  onRefresh: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const builderId = application?.shortName || "";
  const [queueQuery, setQueueQuery] = useState("");
  const [queues, setQueues] = useState<DeskQueue[]>([]);
  const [loadedId, setLoadedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<{ queue: DeskQueue; action: DeskAction; name: string } | null>(
    null,
  );
  const [preview, setPreview] = useState<DeskPreview | null>(null);
  const [operationId, setOperationId] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [forceFinalization, setForceFinalization] = useState(false);
  const lock = useRef(false);
  const sequence = useRef(0);
  const selectedId = useRef(builderId);
  selectedId.current = builderId;
  const close = () => {
    if (!lock.current) {
      setDraft(null);
      setPreview(null);
    }
  };
  useModalFocus(draft ? "desk-queue" : null, close);
  const builders = filterBuilderPickerApplications(applications, {
    scope: "all",
    routerBuilderIds: null,
  });
  const builder = builders.find((app) => app.shortName === builderId);
  const visible =
    loadedId === builderId && builder
      ? queues.filter((q) =>
          q.name.toLocaleLowerCase("pt-BR").includes(queueQuery.toLocaleLowerCase("pt-BR")),
        )
      : [];

  function start(message: string) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setStage(message);
    setError("");
    onBusyChange(true);
    return true;
  }
  function finish() {
    lock.current = false;
    setBusy(false);
    setStage("");
    onBusyChange(false);
  }
  async function credentials(id: string) {
    const app = builders.find((item) => item.shortName === id);
    if (!app) throw new Error("Selecione novamente um Builder ao qual você tenha acesso.");
    const resolved = await resolveKey(id);
    if (resolved.shortName !== id)
      throw new Error("O acesso retornado não corresponde ao Builder selecionado.");
    return {
      builderShortName: id,
      builderKey: resolved.key,
      ...(app.tenantId ? { tenantId: app.tenantId } : {}),
    };
  }
  async function load(id: string) {
    const request = ++sequence.current;
    setQueues([]);
    setLoadedId("");
    setDraft(null);
    setPreview(null);
    setNotice("");
    if (!id || !embedded || !start("Consultando filas e vínculos…")) return;
    try {
      const result = await postJson<{
        builderShortName: string;
        total: number;
        queues: DeskQueue[];
      }>("/api/desk/queues/search", await credentials(id));
      if (
        result.builderShortName !== id ||
        !Array.isArray(result.queues) ||
        result.total !== result.queues.length
      )
        throw new Error("A resposta não confirmou todas as filas deste Builder.");
      if (request === sequence.current && selectedId.current === id) {
        setQueues(result.queues);
        setLoadedId(id);
      }
    } catch (caught) {
      if (request === sequence.current)
        setError(caught instanceof Error ? caught.message : "Não foi possível consultar as filas.");
    } finally {
      finish();
    }
  }
  const loadSelection = useRef(load);
  loadSelection.current = load;
  useEffect(() => {
    setQueueQuery("");
    void loadSelection.current(builderId);
  }, [builderId]);

  function open(queue: DeskQueue, action: DeskAction) {
    if (lock.current) return;
    setError("");
    setNotice("");
    setPreview(null);
    setAttempted(false);
    setForceFinalization(false);
    setDraft({
      queue,
      action,
      name: action === "duplicate" ? `${queue.name} - Cópia` : queue.name,
    });
  }
  async function review() {
    if (!draft || !builder || !start("Preparando a conferência da fila…")) return;
    try {
      const result = await postJson<DeskPreview>("/api/desk/queues/preview", {
        ...(await credentials(builderId)),
        queueId: draft.queue.id,
        action: draft.action,
        name: draft.name,
        forceFinalization,
      });
      if (
        result.builderShortName !== builderId ||
        result.queue.id !== draft.queue.id ||
        result.action !== draft.action ||
        !result.revision ||
        !result.backup ||
        result.forceFinalization !== forceFinalization ||
        !Number.isInteger(result.activeTicketCount) ||
        result.activeTicketCount < 0
      )
        throw new Error("A prévia não confirmou a fila solicitada.");
      setPreview(result);
      setOperationId(crypto.randomUUID());
      setAttempted(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível preparar a alteração.");
    } finally {
      finish();
    }
  }
  function downloadBackup() {
    if (!preview) return;
    saveDownload(
      new Blob([JSON.stringify(preview.backup, null, 2)], { type: "application/json" }),
      `backup-fila-${builderId}-${preview.queue.id}.json`,
    );
  }
  async function apply() {
    if (!preview || !builder || attempted || !start("Aguardando confirmação…")) return;
    let reload = false;
    let successMessage = "";
    try {
      const approved = await showBlipAlert({
        variant: "warning",
        icon: "warning",
        title:
          preview.action === "rename"
            ? preview.activeTicketCount
              ? "Finalizar atendimentos e renomear?"
              : "Renomear esta fila?"
            : "Duplicar esta fila?",
        body: `Builder: ${builder.name} (${builderId})\nFila: ${preview.queue.name}\nNovo nome: ${preview.name}\n\n${preview.activeTicketCount ? `${preview.activeTicketCount} atendimento(s) ativo(s) desta fila serão finalizados antes de renomear. Isso não pode ser desfeito, mesmo se a renomeação falhar.\n\n` : ""}${preview.action === "rename" ? "A fila ficará temporariamente sem vínculos enquanto seus atendentes e regras são restaurados." : "Os mesmos atendentes e condições de atendimento serão associados à nova fila."}`,
        buttons: {
          cancel: "Cancelar",
          confirm: preview.activeTicketCount
            ? "Finalizar e renomear"
            : preview.action === "rename"
              ? "Renomear fila"
              : "Duplicar fila",
        },
      });
      if (!approved) return;
      if (selectedId.current !== builderId)
        throw new Error("O Builder selecionado mudou. Prepare a prévia novamente.");
      const access = await credentials(builderId);
      downloadBackup();
      setAttempted(true);
      setStage(
        preview.action === "rename"
          ? "Renomeando e restaurando os vínculos…"
          : "Duplicando configurações e vínculos…",
      );
      const result = await postJson<DeskResult>("/api/desk/queues/apply", {
        ...access,
        action: preview.action,
        queueId: preview.queue.id,
        name: preview.name,
        forceFinalization: preview.forceFinalization,
        revision: preview.revision,
        operationId,
      });
      if (result.builderShortName !== builderId)
        throw new Error(
          "A resposta não confirmou o Builder solicitado. Atualize a lista antes de repetir.",
        );
      if (result.status !== "success") {
        setError(
          `${result.finalizedTickets ? `${result.finalizedTickets} atendimento(s) finalizado(s); esses encerramentos não serão desfeitos. ` : ""}${result.finalizationUncertain ? "Não foi possível confirmar o último encerramento. Confira os atendimentos no Desk antes de repetir. " : ""}${result.message || "Não foi possível concluir a alteração."} ${result.configurationUnchanged ? "A configuração da fila não foi alterada." : result.status === "recovered" ? "A configuração anterior foi restaurada e conferida." : "A recuperação não foi concluída. Confira o Desk e use a cópia de segurança antes de fazer outra alteração."}`,
        );
        return;
      }
      successMessage = `Fila ${result.action === "rename" ? "renomeada" : "duplicada"}: ${result.queue?.name || preview.name}. Atendentes, regras, tags e configurações conferidos.${result.finalizedTickets ? ` ${result.finalizedTickets} atendimento(s) finalizado(s).` : ""}`;
      setNotice(successMessage);
      setQueues([]);
      setLoadedId("");
      setDraft(null);
      setPreview(null);
      reload = true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível concluir. Confira o Desk antes de repetir.",
      );
    } finally {
      finish();
    }
    if (reload) {
      await load(builderId);
      setNotice(successMessage);
    }
  }

  return (
    <section className="ember-panel results-panel desk-queues" aria-label="Filas de atendimento">
      <div className="ember-panel-title results-title">
        <div>
          <h2>Filas de atendimento</h2>
          <p>Duplique ou renomeie filas preservando atendentes, regras e configurações.</p>
        </div>
        {embedded && builder && (
          <Button
            disabled={busy || loading}
            onClick={() => {
              onRefresh();
              void load(builderId);
            }}
          >
            <RefreshCw size={18} /> Atualizar filas
          </Button>
        )}
      </div>
      {!embedded ? (
        <Feedback tone="info">
          Abra a extensão pelo Portal Blip para gerenciar as filas de um Builder.
        </Feedback>
      ) : (
        <>
          <div className="desk-builder-selection">
            <span className="bot-clone-field-label">Builder</span>
            <div className="bot-clone-selector">
              <span className="router-summary-main">
                <span className="router-summary-avatar" aria-hidden="true">
                  {builder?.imageUri ? <img src={builder.imageUri} alt="" /> : <Bot size={18} />}
                </span>
                <span className="router-summary-copy">
                  <strong>{builder?.name || "Nenhum Builder selecionado"}</strong>
                  <span>
                    {builder?.shortName || "Selecione o Builder para consultar suas filas"}
                  </span>
                </span>
              </span>
              <Button variant="secondary" size="sm" onClick={onSelectBuilder} disabled={busy}>
                <Pencil size={16} aria-hidden="true" />
                {builder ? "Alterar Builder" : "Selecionar Builder"}
              </Button>
            </div>
          </div>
          {builder && (
            <div className="desk-queue-filters">
              <label className="blip-native-field">
                Buscar fila
                <input
                  value={queueQuery}
                  onChange={(e) => setQueueQuery(e.target.value)}
                  disabled={busy}
                  placeholder="Nome da fila"
                />
              </label>
            </div>
          )}
          {loadError && (
            <Feedback title="Não foi possível listar os Builders">{loadError}</Feedback>
          )}
          {error && (
            <Feedback title="Confira a operação" onDismiss={() => setError("")}>
              {error}
            </Feedback>
          )}
          {notice && (
            <Feedback tone="success" onDismiss={() => setNotice("")}>
              {notice}
            </Feedback>
          )}
          {busy && (
            <div className="desk-queue-progress" role="status">
              <LoaderCircle size={18} className="spin" />
              {stage}
            </div>
          )}
          {!busy && !builderId && (
            <EmptyState title="Escolha um Builder">
              As filas exibidas pertencem somente ao Builder selecionado.
            </EmptyState>
          )}
          {!busy && loadedId === builderId && builderId && !visible.length && (
            <EmptyState title="Nenhuma fila encontrada">
              Confira a busca ou atualize a lista.
            </EmptyState>
          )}
          {visible.length > 0 && (
            <div className="table-scroll">
              <table
                className="ember-table desk-queue-table"
                aria-label="Filas do Builder selecionado"
              >
                <thead>
                  <tr>
                    <th>Fila</th>
                    <th>Atendentes</th>
                    <th>Regras</th>
                    <th>Priorização</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((q) => {
                    const reserved = ["default", "directtransfer"].includes(
                      q.name.trim().toLowerCase(),
                    );
                    return (
                      <tr key={q.id}>
                        <td>
                          <span className="desk-queue-name">
                            <Headset size={18} />
                            <strong>{q.name}</strong>
                          </span>
                          <small>
                            {q.isActive ? "Ativa" : "Inativa"}
                            {reserved ? " · Gerenciada pelo Portal" : ""}
                          </small>
                        </td>
                        <td>{q.attendantCount}</td>
                        <td>{q.ruleCount}</td>
                        <td>{q.priorityRuleCount}</td>
                        <td>
                          <div className="desk-queue-actions">
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy || reserved}
                              onClick={() => open(q, "duplicate")}
                            >
                              <CopyPlus size={16} /> Duplicar
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy || reserved}
                              onClick={() => open(q, "rename")}
                            >
                              <Pencil size={16} /> Renomear
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {draft && (
        <div className="ember-modal-backdrop">
          <div
            data-modal-id="desk-queue"
            className="ember-modal desk-queue-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="desk-queue-dialog-title"
            tabIndex={-1}
          >
            <div className="ember-modal-header">
              <div>
                <h2 id="desk-queue-dialog-title">
                  {draft.action === "rename" ? "Renomear fila" : "Duplicar fila"}
                </h2>
                <p>
                  {builder?.name} · {draft.queue.name}
                </p>
              </div>
              <Button
                variant="ghost"
                className="icon-only"
                aria-label="Fechar"
                disabled={busy}
                onClick={close}
              >
                <X size={20} />
              </Button>
            </div>
            <div className="desk-queue-modal-body">
              <label className="blip-native-field">
                Novo nome
                <input
                  autoFocus
                  value={draft.name}
                  disabled={busy || attempted}
                  onChange={(e) => {
                    setDraft({ ...draft, name: e.target.value });
                    setPreview(null);
                  }}
                  minLength={3}
                />
              </label>
              <p>
                {draft.action === "rename"
                  ? "A fila mantém sua identidade. Os vínculos são retirados e restaurados automaticamente; as regras são recriadas com as mesmas configurações."
                  : "Uma nova fila será criada neste Builder, com os mesmos atendentes, condições de atendimento, tags e configurações. As novas regras serão acrescentadas após as existentes."}
              </p>
              {draft.action === "rename" && (
                <label className="desk-finalization-switch blip-switch-option">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={forceFinalization}
                    disabled={busy || attempted}
                    onChange={(event) => {
                      setForceFinalization(event.target.checked);
                      setPreview(null);
                      setError("");
                    }}
                  />
                  <span className="flow-switch-track" aria-hidden="true">
                    <span className="flow-switch-thumb" />
                  </span>
                  <span className="blip-switch-label">
                    Forçar finalização
                    <small>Finaliza os atendimentos ativos desta fila antes de renomear.</small>
                  </span>
                </label>
              )}
              {preview?.forceFinalization && (
                <Feedback tone="warning">
                  {preview.activeTicketCount > 0
                    ? `${preview.activeTicketCount} atendimento(s) ativo(s) serão finalizados ao confirmar. O encerramento não pode ser desfeito, mesmo se a renomeação falhar.`
                    : "Nenhum atendimento ativo nesta fila. Não há atendimentos para finalizar."}
                </Feedback>
              )}
              {preview && (
                <>
                  <div className="desk-queue-counts">
                    <span>
                      <strong>{preview.counts.attendants}</strong> atendentes
                    </span>
                    <span>
                      <strong>{preview.counts.rules}</strong> regras
                    </span>
                    <span>
                      <strong>{preview.counts.priorityRules}</strong> priorizações
                    </span>
                    <span>
                      <strong>{preview.counts.tags}</strong> tags
                    </span>
                  </div>
                  <p className="desk-queue-backup-note">
                    Ao confirmar, uma cópia de segurança será enviada para download.
                  </p>
                  <Button variant="secondary" size="sm" onClick={downloadBackup} disabled={busy}>
                    <Download size={16} /> Baixar cópia de segurança
                  </Button>
                </>
              )}
              {error && <Feedback>{error}</Feedback>}
              {busy && <p role="status">{stage}</p>}
            </div>
            <div className="ember-modal-footer">
              <Button variant="secondary" onClick={close} disabled={busy}>
                Cancelar
              </Button>
              {!preview ? (
                <Button
                  disabled={busy || draft.name.trim().length < 3}
                  onClick={() => void review()}
                >
                  Revisar alteração
                </Button>
              ) : (
                <Button disabled={busy || attempted} onClick={() => void apply()}>
                  {preview.activeTicketCount
                    ? "Finalizar e renomear"
                    : draft.action === "rename"
                      ? "Renomear fila"
                      : "Duplicar fila"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
