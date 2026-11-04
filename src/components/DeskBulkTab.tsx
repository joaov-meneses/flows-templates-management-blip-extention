import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Download,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Search,
  Square,
  CheckCheck,
} from "lucide-react";
import type { AttendanceProps } from "./AttendanceTab";
import type { BulkFilters, BulkJob } from "../types/deskBulk";
import { filterBuilderPickerApplications } from "../lib/builderPicker";
import { postJson } from "../lib/api";
import { saveDownload } from "../lib/builderDownload";
import { showBlipAlert } from "../lib/blipProxy";
import { Button } from "./ui/Button";
import { EmptyState, Feedback } from "./ui/Feedback";

const initial = {
  queueId: "",
  status: "active",
  assignment: "any",
  createdFrom: "",
  createdTo: "",
  minimumAgeHours: "",
  lastInputFrom: "",
  lastInputTo: "",
  minimumInactivityHours: "",
};
const statuses: Record<string, string> = {
  active: "Todos os ativos",
  Open: "Em atendimento",
  Waiting: "Aguardando atendente",
  Assigned: "Atribuído ao atendente",
};
const outcomes: Record<string, string> = {
  finalized: "Finalizado",
  skipped: "Ignorado",
  failed: "Falha",
  uncertain: "Não confirmado",
};
const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleString("pt-BR") : "—";
const localDateInput = (value: string | null) => {
  if (!value) return "";
  const time = new Date(value);
  return new Date(time.getTime() - time.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const inputDate = (value: string) => (value ? new Date(value).toISOString() : null);
const inputHours = (value: string) => (value === "" ? null : Number(value));
type Lookup = { jobId: string } | { operationId: string };
function summary(f: BulkFilters, queueName: string) {
  return [
    `Fila: ${queueName}`,
    `Situação: ${statuses[f.status]}`,
    `Atendente: ${f.assignment === "any" ? "todos" : f.assignment === "unassigned" ? "sem atendente" : "com atendente"}`,
    f.createdFrom && `Criado a partir de: ${formatDate(f.createdFrom)}`,
    f.createdTo && `Criado até: ${formatDate(f.createdTo)}`,
    f.minimumAgeHours != null && `Idade mínima: ${f.minimumAgeHours} hora(s)`,
    f.lastInputFrom && `Última mensagem do cliente a partir de: ${formatDate(f.lastInputFrom)}`,
    f.lastInputTo && `Última mensagem do cliente até: ${formatDate(f.lastInputTo)}`,
    f.minimumInactivityHours != null &&
      `Sem mensagem do cliente há pelo menos: ${f.minimumInactivityHours} hora(s)`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function DeskBulkTab({
  application,
  applications,
  onSelectBuilder,
  resolveKey,
  embedded,
  onBusyChange,
  onRefresh,
  loading,
  loadError,
}: AttendanceProps) {
  const builderId = application?.shortName || "";
  const builders = filterBuilderPickerApplications(applications, {
    scope: "all",
    routerBuilderIds: null,
  });
  const builder = builders.find((a) => a.shortName === builderId);
  const [queues, setQueues] = useState<{ id: string; name: string }[]>([]);
  const [draft, setDraft] = useState(initial);
  const [limit, setLimit] = useState(100);
  const [tag, setTag] = useState("");
  const [job, setJob] = useState<BulkJob | null>(null);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState(false);
  const [pollVersion, setPollVersion] = useState(0);
  const lock = useRef(false);
  const selectedId = useRef(builderId);
  selectedId.current = builderId;
  const preview = job?.kind === "preview" && job.status === "ready" ? job.preview : undefined;
  const running = job?.status === "running" || Boolean(lookup && !job);
  const blocked = busy || running;
  const storageKey = `ember-desk-bulk:${builderId}`;

  function setWorking(value: boolean) {
    lock.current = value;
    setBusy(value);
    onBusyChange(value);
  }
  async function access(id = builderId) {
    const app = builders.find((b) => b.shortName === id);
    if (!app) throw new Error("Selecione um Builder com acesso.");
    const resolved = await resolveKey(id);
    if (resolved.shortName !== id)
      throw new Error("O acesso não corresponde ao Builder selecionado.");
    return {
      builderShortName: id,
      builderKey: resolved.key,
      ...(app.tenantId ? { tenantId: app.tenantId } : {}),
    };
  }
  function remember(value: Lookup | null) {
    setLookup(value);
    try {
      if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* Session recovery is optional. */
    }
  }
  function accept(result: BulkJob) {
    if (result.builderShortName !== selectedId.current)
      throw new Error("A resposta não corresponde ao Builder selecionado.");
    setJob(result);
    const restored = result.preview?.filters || result.result?.filters;
    if (restored)
      setDraft({
        queueId: restored.queueId || "",
        status: restored.status,
        assignment: restored.assignment,
        createdFrom: localDateInput(restored.createdFrom),
        createdTo: localDateInput(restored.createdTo),
        lastInputFrom: localDateInput(restored.lastInputFrom),
        lastInputTo: localDateInput(restored.lastInputTo),
        minimumAgeHours: restored.minimumAgeHours == null ? "" : String(restored.minimumAgeHours),
        minimumInactivityHours:
          restored.minimumInactivityHours == null ? "" : String(restored.minimumInactivityHours),
      });
    if (result.preview) setLimit(result.preview.limit);
    setError("");
    setPollError(false);
    remember({ jobId: result.jobId });
    setWorking(result.status === "running");
  }
  async function load() {
    if (!builderId || !embedded || lock.current) return;
    const id = builderId;
    setWorking(true);
    setError("");
    try {
      const result = await postJson<{
        builderShortName: string;
        queues: { id: string; name: string }[];
      }>("/api/desk/tickets/options", await access(id));
      if (id !== selectedId.current) return;
      if (result.builderShortName !== id || !Array.isArray(result.queues))
        throw new Error("Não foi possível confirmar as filas deste Builder.");
      setQueues(result.queues);
    } catch (caught) {
      if (id === selectedId.current)
        setError(caught instanceof Error ? caught.message : "Não foi possível consultar as filas.");
    } finally {
      setWorking(false);
    }
  }
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    setDraft(initial);
    setQueues([]);
    setJob(null);
    setTag("");
    setError("");
    setPollError(false);
    setLookup(null);
    try {
      const saved = sessionStorage.getItem(`ember-desk-bulk:${builderId}`);
      if (saved) {
        const value = JSON.parse(saved);
        if (typeof value.jobId === "string" || typeof value.operationId === "string")
          setLookup(value);
      }
    } catch {
      /* Ignore a malformed local recovery pointer. */
    }
    void loadRef.current();
  }, [builderId]);
  const pollRef = useRef({ access, accept, setWorking });
  pollRef.current = { access, accept, setWorking };
  const lookupJobId = lookup && "jobId" in lookup ? lookup.jobId : "";
  const lookupOperationId = lookup && "operationId" in lookup ? lookup.operationId : "";
  const jobStatus = job?.status;
  useEffect(() => {
    if (
      !builderId ||
      (!lookupJobId && !lookupOperationId) ||
      (jobStatus && jobStatus !== "running") ||
      pollError
    )
      return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const id = builderId;
    const lookupValue = lookupOperationId
      ? { operationId: lookupOperationId }
      : { jobId: lookupJobId };
    const tick = async () => {
      try {
        const result = await postJson<BulkJob>("/api/desk/tickets/status", {
          ...(await pollRef.current.access(id)),
          ...lookupValue,
        });
        if (disposed || selectedId.current !== id) return;
        pollRef.current.accept(result);
        if (result.status === "running") timer = setTimeout(() => void tick(), 1200);
      } catch (caught) {
        if (disposed) return;
        setError(
          caught instanceof Error ? caught.message : "Não foi possível consultar a situação.",
        );
        setPollError(true);
        pollRef.current.setWorking(false);
      }
    };
    timer = setTimeout(() => void tick(), 300);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [builderId, lookupJobId, lookupOperationId, jobStatus, pollError, pollVersion]);

  function change<K extends keyof typeof initial>(name: K, value: string) {
    setDraft((current) => ({ ...current, [name]: value }));
    if (preview) {
      setJob(null);
      remember(null);
      setTag("");
    }
    setError("");
  }
  async function search() {
    if (lock.current || running) return;
    setWorking(true);
    setError("");
    setJob(null);
    setTag("");
    remember(null);
    try {
      const filters = {
        ...draft,
        queueId: draft.queueId || null,
        createdFrom: inputDate(draft.createdFrom),
        createdTo: inputDate(draft.createdTo),
        lastInputFrom: inputDate(draft.lastInputFrom),
        lastInputTo: inputDate(draft.lastInputTo),
        minimumAgeHours: inputHours(draft.minimumAgeHours),
        minimumInactivityHours: inputHours(draft.minimumInactivityHours),
      };
      accept(
        await postJson<BulkJob>("/api/desk/tickets/preview", {
          ...(await access()),
          filters,
          limit,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível preparar a prévia.");
      setWorking(false);
    }
  }
  async function finalize() {
    if (lock.current || !preview?.tickets.length || !job || (preview.untaggedTicketCount && !tag))
      return;
    setWorking(true);
    setError("");
    let approved = false;
    try {
      const queueName =
        queues.find((q) => q.id === preview.filters.queueId)?.name || "Todas as filas";
      approved = await showBlipAlert({
        variant: "warning",
        icon: "warning",
        title: `Finalizar ${preview.tickets.length} atendimento(s)?`,
        body: `Builder: ${builder?.name} (${builderId})\n${summary(preview.filters, queueName)}\n\nSerão considerados apenas os tickets desta prévia (${preview.tickets.length}). Atendimentos que mudarem serão ignorados.\n${tag ? `Tag para os que estiverem sem tag: ${tag}.\n` : ""}As tags existentes serão preservadas. O encerramento não pode ser desfeito.`,
        buttons: { cancel: "Cancelar", confirm: "Finalizar atendimentos" },
      });
      if (!approved) {
        setWorking(false);
        return;
      }
      const operationId = crypto.randomUUID();
      remember({ operationId });
      const previewJobId = job.jobId;
      setJob(null);
      accept(
        await postJson<BulkJob>("/api/desk/tickets/finalize", {
          ...(await access()),
          previewJobId,
          finalizationTag: tag,
          operationId,
        }),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível confirmar a operação. Consulte a situação antes de repetir.",
      );
      setWorking(false);
      if (approved) {
        setPollError(false);
        setPollVersion((v) => v + 1);
      }
    }
  }
  async function cancel() {
    if (!lookup) return;
    try {
      accept(
        await postJson<BulkJob>("/api/desk/tickets/cancel", { ...(await access()), ...lookup }),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Não foi possível solicitar a interrupção.",
      );
    }
  }
  function download() {
    if (!job) return;
    saveDownload(
      new Blob([JSON.stringify(job, null, 2)], { type: "application/json" }),
      `atendimento-${builderId}-${job.jobId}.json`,
    );
  }
  const textField = (name: keyof typeof initial, label: string, type = "datetime-local") => (
    <label className="blip-native-field" key={name}>
      {label}
      <input
        type={type}
        value={draft[name]}
        disabled={blocked}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? "any" : undefined}
        onChange={(e) => change(name, e.target.value)}
      />
    </label>
  );

  return (
    <section className="ember-panel results-panel desk-bulk" aria-label="Finalização em massa">
      <div className="ember-panel-title results-title">
        <div>
          <h2>Finalização em massa</h2>
          <p>Encontre atendimentos por critérios, revise o lote e confirme o encerramento.</p>
        </div>
      </div>
      {!embedded ? (
        <Feedback tone="info">
          Abra a extensão pelo Portal Blip para gerenciar atendimentos.
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
                    {builder?.shortName || "Selecione o Builder para consultar atendimentos"}
                  </span>
                </span>
              </span>
              <Button variant="secondary" size="sm" onClick={onSelectBuilder} disabled={blocked}>
                <Pencil size={16} />
                {builder ? "Alterar Builder" : "Selecionar Builder"}
              </Button>
            </div>
          </div>
          {loadError && <Feedback>{loadError}</Feedback>}
          {builder ? (
            <>
              <div className="bulk-toolbar">
                <p>
                  Somente atendimentos ativos. Horários em{" "}
                  {Intl.DateTimeFormat().resolvedOptions().timeZone}.
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={blocked || loading}
                  onClick={() => {
                    onRefresh();
                    void load();
                  }}
                >
                  <RefreshCw size={16} />
                  Atualizar filas
                </Button>
              </div>
              <div className="bulk-filters">
                <fieldset>
                  <legend>Atendimentos</legend>
                  <div className="bulk-filter-grid">
                    <label className="blip-native-field">
                      Fila
                      <select
                        value={draft.queueId}
                        onChange={(e) => change("queueId", e.target.value)}
                        disabled={blocked}
                      >
                        <option value="">Todas as filas</option>
                        {queues.map((q) => (
                          <option key={q.id} value={q.id}>
                            {q.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="blip-native-field">
                      Situação
                      <select
                        value={draft.status}
                        onChange={(e) => change("status", e.target.value)}
                        disabled={blocked}
                      >
                        {Object.entries(statuses).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="blip-native-field">
                      Atendente
                      <select
                        value={draft.assignment}
                        onChange={(e) => change("assignment", e.target.value)}
                        disabled={blocked}
                      >
                        <option value="any">Todos</option>
                        <option value="unassigned">Sem atendente</option>
                        <option value="assigned">Com atendente</option>
                      </select>
                    </label>
                  </div>
                </fieldset>
                <fieldset>
                  <legend>Criação do ticket</legend>
                  <div className="bulk-filter-grid">
                    {textField("createdFrom", "Criado a partir de")}
                    {textField("createdTo", "Criado até")}
                    {textField("minimumAgeHours", "Idade mínima do ticket (horas)", "number")}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>Última mensagem do cliente</legend>
                  <div className="bulk-filter-grid">
                    {textField("lastInputFrom", "Última mensagem a partir de")}
                    {textField("lastInputTo", "Última mensagem até")}
                    {textField(
                      "minimumInactivityHours",
                      "Sem mensagem há pelo menos (horas)",
                      "number",
                    )}
                  </div>
                  <p className="bulk-help">
                    Estes filtros consultam mensagens recebidas do cliente no histórico. Eventos
                    técnicos são desconsiderados; atendimentos sem data verificável ficam fora do
                    lote.
                  </p>
                </fieldset>
                <div className="bulk-actions">
                  <label className="blip-native-field">
                    Limite do lote
                    <select
                      value={limit}
                      disabled={blocked}
                      onChange={(e) => {
                        setLimit(Number(e.target.value));
                        setJob(null);
                        remember(null);
                      }}
                    >
                      {[25, 50, 100, 250, 500].map((value) => (
                        <option key={value} value={value}>
                          {value} atendimentos
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button disabled={blocked || !queues.length} onClick={() => void search()}>
                    <Search size={17} />
                    Consultar e revisar
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <EmptyState title="Escolha um Builder">
              Os filtros aparecem depois de selecionar o Builder.
            </EmptyState>
          )}
          {error && <Feedback>{error}</Feedback>}
          {job?.error && <Feedback>{job.error}</Feedback>}
          {pollError && (
            <Button
              variant="secondary"
              onClick={() => {
                remember(null);
                setJob(null);
                setPollError(false);
                setError("");
              }}
            >
              Nova consulta
            </Button>
          )}
          {running && (
            <div className="bulk-progress" role="status">
              <LoaderCircle size={18} className={pollError ? "" : "spin"} />
              <span>
                {job?.progress.stage || "Consultando a situação da operação…"}
                {job?.progress.total ? ` ${job.progress.checked} de ${job.progress.total}.` : ""}
              </span>
              {pollError ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setPollError(false);
                    setPollVersion((v) => v + 1);
                  }}
                >
                  Consultar situação
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => void cancel()}>
                  <Square size={14} />
                  Interromper
                </Button>
              )}
              <small>
                Interromper preserva os encerramentos já realizados e aguarda a confirmação do envio
                atual.
              </small>
            </div>
          )}
          {preview && (
            <div className="bulk-review">
              <h3>{preview.tickets.length} atendimento(s) no lote</h3>
              <p className="bulk-help">
                Prévia de {formatDate(preview.snapshotAt)} · {preview.checkedCount} de{" "}
                {preview.candidateCount} candidatos consultados. Os critérios são combinados.
              </p>
              {preview.hasMore && (
                <Feedback tone="info">
                  Há candidatos além deste lote. Após concluir, faça uma nova consulta para revisar
                  os próximos.
                </Feedback>
              )}
              {preview.excludedHistory > 0 && (
                <Feedback tone="warning">
                  {preview.excludedHistory} atendimento(s) ficaram fora por não ter última mensagem
                  verificável. Restrinja a busca ou confira o histórico no Desk.
                </Feedback>
              )}
              {preview.historyScanLimited && (
                <Feedback tone="warning">
                  A consulta de histórico foi limitada a 1000 candidatos. Restrinja a fila ou o
                  período de criação para analisar os demais.
                </Feedback>
              )}
              {!preview.tickets.length ? (
                <EmptyState title="Nenhum atendimento encontrado">
                  Ajuste os filtros e consulte novamente.
                </EmptyState>
              ) : (
                <>
                  {preview.untaggedTicketCount > 0 && (
                    <label className="blip-native-field">
                      Tag para atendimentos sem tag
                      <select
                        value={tag}
                        onChange={(e) => setTag(e.target.value)}
                        disabled={blocked}
                      >
                        <option value="">Selecione uma tag</option>
                        {preview.finalizationTags.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                      <small>
                        {preview.untaggedTicketCount} sem tag na prévia. A tag escolhida será usada
                        somente nos que continuarem sem classificação.
                      </small>
                      {!preview.finalizationTags.length && (
                        <span>Cadastre uma tag no Desk e prepare uma nova prévia.</span>
                      )}
                    </label>
                  )}
                  <div className="table-scroll">
                    <table className="bulk-ticket-table">
                      <caption className="sr-only">Atendimentos da prévia</caption>
                      <thead>
                        <tr>
                          <th>Ticket</th>
                          <th>Fila</th>
                          <th>Situação</th>
                          <th>Atendente</th>
                          <th>Criado em</th>
                          <th>Última mensagem do cliente</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.tickets.map((ticket) => (
                          <tr key={ticket.id}>
                            <td>
                              <strong>#{ticket.sequentialId ?? ticket.id}</strong>
                              <small>{ticket.id}</small>
                            </td>
                            <td>{ticket.team}</td>
                            <td>{statuses[ticket.status] || ticket.status}</td>
                            <td>{ticket.hasAttendant ? "Com atendente" : "Sem atendente"}</td>
                            <td>
                              {formatDate(ticket.createdAt)}
                              <small>{ticket.ageHours} hora(s)</small>
                            </td>
                            <td>
                              {ticket.lastInputChecked
                                ? formatDate(ticket.lastInputAt)
                                : "Não consultada"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Feedback tone="warning">
                    A finalização não pode ser desfeita. Somente os tickets desta prévia serão
                    considerados; atendimentos que mudarem serão ignorados.
                  </Feedback>
                  <div className="bulk-actions">
                    <Button variant="secondary" disabled={blocked} onClick={download}>
                      <Download size={16} />
                      Baixar prévia
                    </Button>
                    <Button
                      disabled={blocked || Boolean(preview.untaggedTicketCount && !tag)}
                      onClick={() => void finalize()}
                    >
                      <CheckCheck size={17} />
                      Finalizar {preview.tickets.length} atendimento(s)
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
          {job?.result && (
            <div className="bulk-review">
              <h3>Resultado da finalização</h3>
              {job.result.filters && (
                <p className="bulk-help">
                  {summary(
                    job.result.filters,
                    queues.find((q) => q.id === job.result?.filters?.queueId)?.name ||
                      "Todas as filas",
                  ).replaceAll("\n", " · ")}
                </p>
              )}
              <div className="desk-queue-counts bulk-result-counts">
                <span>
                  <strong>{job.result.finalized}</strong>finalizados
                </span>
                <span>
                  <strong>{job.result.skipped}</strong>ignorados
                </span>
                <span>
                  <strong>{job.result.failed}</strong>com falha
                </span>
                <span>
                  <strong>{job.result.uncertain}</strong>não confirmados
                </span>
                <span>
                  <strong>{job.result.remaining}</strong>não processados
                </span>
              </div>
              {!running && (
                <Feedback
                  tone={
                    job.result.interrupted ||
                    job.result.failed ||
                    job.result.uncertain ||
                    job.result.remaining
                      ? "warning"
                      : "success"
                  }
                >
                  {job.result.interrupted || job.result.remaining
                    ? "O lote foi interrompido. Confira os detalhes antes de preparar outra prévia."
                    : "Processamento concluído. Atendimentos ignorados não foram encerrados por esta operação."}{" "}
                  Os encerramentos confirmados permanecem válidos.
                </Feedback>
              )}
              <Button size="sm" variant="secondary" onClick={download}>
                <Download size={16} />
                Baixar relatório
              </Button>
              <div className="table-scroll">
                <table className="bulk-ticket-table">
                  <caption className="sr-only">Resultado por atendimento</caption>
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Fila</th>
                      <th>Resultado</th>
                      <th>Detalhe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {job.result.items.map((item) => (
                      <tr key={item.id}>
                        <td>#{item.sequentialId ?? item.id}</td>
                        <td>{item.team}</td>
                        <td>{outcomes[item.outcome]}</td>
                        <td>{item.message || "Encerramento e tags confirmados."}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
