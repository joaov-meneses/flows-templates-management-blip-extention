import { useEffect, useRef, useState } from "react";
import { ChevronDown, Clock3, Eye, RefreshCw, X } from "lucide-react";
import { useModalFocus } from "../hooks/useModalFocus";
import { postJson } from "../lib/api";
import { recordActivityResult } from "../lib/activityLog";
import { showBlipAlert } from "../lib/blipProxy";
import {
  expirationGroup,
  expirationLabel,
  groupInactivity,
  validInactivityMinutes,
} from "../lib/inactivity";
import type { InactivityAnalysis, InactivityApplyResponse } from "../types/inactivity";
import type { PortalApplicationAccount, ResolvedRouterKey } from "../types/templates";
import { Button } from "./ui/Button";
import { EmptyState, Feedback } from "./ui/Feedback";
import "../styles/inactivity.css";

type BotDraft = {
  application: PortalApplicationAccount;
  key?: string;
  analysis?: InactivityAnalysis;
  selected: boolean;
  blockKeys: Set<string>;
  overrides: Record<string, string>;
  status: "loading" | "ready" | "error";
  error?: string;
  result?: string;
};

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "Não foi possível carregar o rascunho.";
}

export function InactivityTab({
  applications,
  onSelect,
  resolveKey,
  embedded,
}: {
  applications: PortalApplicationAccount[];
  onSelect: () => void;
  resolveKey: (shortName: string) => Promise<ResolvedRouterKey>;
  embedded: boolean;
}) {
  const [bots, setBots] = useState<BotDraft[]>([]);
  const currentBots = useRef(bots);
  currentBots.current = bots;
  const [minutes, setMinutes] = useState("5");
  const [keepExisting, setKeepExisting] = useState(false);
  const [publishAfterSave, setPublishAfterSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const operationLock = useRef(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const resolver = useRef(resolveKey);
  resolver.current = resolveKey;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function patchBot(id: string, patch: Partial<BotDraft>) {
    if (mounted.current)
      setBots((current) =>
        current.map((bot) => (bot.application.shortName === id ? { ...bot, ...patch } : bot)),
      );
  }

  useEffect(() => {
    let cancelled = false;
    const previous = new Map(currentBots.current.map((bot) => [bot.application.shortName, bot]));
    setNotice("");
    setError("");
    setBots(
      applications.map((application) =>
        previous.has(application.shortName)
          ? { ...previous.get(application.shortName)!, application }
          : {
              application,
              selected: true,
              blockKeys: new Set(),
              overrides: {},
              status: "loading",
            },
      ),
    );
    async function analyze() {
      for (const application of applications) {
        if (cancelled) return;
        if (previous.has(application.shortName)) continue;
        try {
          const { key } = await resolver.current(application.shortName);
          if (cancelled) return;
          const analysis = await postJson<InactivityAnalysis>("/api/inactivity/analyze", {
            builderKey: key,
          });
          if (cancelled) return;
          patchBot(application.shortName, {
            key,
            analysis,
            blockKeys: new Set(analysis.blocks.map((block) => block.blockKey)),
            status: "ready",
          });
        } catch (caughtError) {
          if (cancelled) return;
          patchBot(application.shortName, { status: "error", error: messageOf(caughtError) });
        }
      }
    }
    void analyze();
    return () => {
      cancelled = true;
    };
  }, [applications]);

  const loading = bots.some((bot) => bot.status === "loading");
  const detail = bots.find((bot) => bot.application.shortName === detailId);
  const ready = bots.filter((bot) => bot.analysis && bot.status === "ready");
  const eligibleCount = ready.reduce(
    (total, bot) => total + (bot.analysis?.eligibleBlocks || 0),
    0,
  );
  const targets = ready.filter((bot) => bot.selected && bot.blockKeys.size > 0);
  const selectedBlocks = targets.reduce((total, bot) => total + bot.blockKeys.size, 0);
  const groups = groupInactivity(ready.map((bot) => bot.analysis!));
  const individualInvalid = targets.some((bot) =>
    Object.entries(bot.overrides).some(
      ([key, value]) =>
        bot.blockKeys.has(key) &&
        !(
          keepExisting && bot.analysis!.blocks.find((block) => block.blockKey === key)?.expiration
        ) &&
        value.trim() !== "" &&
        !validInactivityMinutes(value),
    ),
  );
  const effectiveCount = targets.reduce(
    (total, bot) =>
      total +
      bot.analysis!.blocks.filter(
        (block) => bot.blockKeys.has(block.blockKey) && !(keepExisting && block.expiration),
      ).length,
    0,
  );
  useModalFocus(detailId ? "inactivity-details" : null, () => {
    if (!busy) setDetailId(null);
  });

  async function refreshBot(bot: BotDraft) {
    patchBot(bot.application.shortName, { status: "loading", error: undefined, result: undefined });
    try {
      const { key } = await resolver.current(bot.application.shortName);
      const analysis = await postJson<InactivityAnalysis>("/api/inactivity/analyze", {
        builderKey: key,
      });
      patchBot(bot.application.shortName, {
        key,
        analysis,
        status: "ready",
        blockKeys: new Set(analysis.blocks.map((block) => block.blockKey)),
        overrides: {},
      });
    } catch (caughtError) {
      patchBot(bot.application.shortName, { status: "error", error: messageOf(caughtError) });
    }
  }

  async function confirmPublication(title: string, body: string, confirm: string) {
    setConfirming(true);
    try {
      return await showBlipAlert({
        variant: "warning",
        icon: "warning",
        title,
        body,
        buttons: { cancel: "Cancelar", confirm },
      });
    } catch (caughtError) {
      setError(`Não foi possível confirmar a publicação: ${messageOf(caughtError)}`);
      return false;
    } finally {
      if (mounted.current) setConfirming(false);
    }
  }

  async function togglePublication(checked: boolean) {
    if (operationLock.current) return;
    if (!checked) {
      setPublishAfterSave(false);
      return;
    }
    operationLock.current = true;
    setBusy(true);
    setError("");
    try {
      const confirmed = await confirmPublication(
        "Ativar publicação automática?",
        "Ao salvar, a inatividade será publicada e passará a valer no atendimento dos bots selecionados, incluindo os tempos já salvos no rascunho. A publicação será confirmada novamente antes da aplicação. Se houver outras mudanças pendentes, publique-as no Builder primeiro.",
        "Ativar publicação",
      );
      if (mounted.current && confirmed) setPublishAfterSave(true);
    } finally {
      operationLock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function apply() {
    if (operationLock.current) return;
    setError("");
    setNotice("");
    if (!validInactivityMinutes(minutes) || individualInvalid) {
      setError(
        "Informe tempos maiores que zero e menores que 1380 minutos. Confira também os tempos individuais dos blocos.",
      );
      return;
    }
    if (!targets.length || !effectiveCount || busy || loading) return;
    operationLock.current = true;
    setBusy(true);
    let saved = 0;
    let failed = 0;
    let updated = 0;
    let published = 0;
    let publicationWarnings = 0;
    try {
      if (publishAfterSave) {
        const confirmed = await confirmPublication(
          "Salvar e publicar os fluxos?",
          `Você vai aplicar o tempo global de ${minutes} minuto(s), respeitando os tempos individuais e a opção de manter tempos preenchidos, em ${effectiveCount} bloco(s) de ${targets.length} bot(s): ${targets.map((bot) => bot.application.name).join(", ")}. A publicação inclui os tempos já salvos no rascunho e afetará o atendimento desses bots. Deseja continuar?`,
          "Salvar e publicar",
        );
        if (!confirmed || !mounted.current) return;
      }
      setProgress({ processed: 0, total: targets.length });
      for (const [index, bot] of targets.entries()) {
        try {
          const overrides = Object.fromEntries(
            Object.entries(bot.overrides)
              .filter(
                ([key, value]) =>
                  bot.blockKeys.has(key) &&
                  !(
                    keepExisting &&
                    bot.analysis!.blocks.find((block) => block.blockKey === key)?.expiration
                  ) &&
                  value.trim() !== "",
              )
              .map(([key, value]) => [key, Number(value)]),
          );
          const response = await postJson<InactivityApplyResponse>("/api/inactivity/apply", {
            builderKey: bot.key,
            revision: bot.analysis!.revision,
            minutes: Number(minutes),
            blockKeys: [...bot.blockKeys],
            overrides,
            keepExisting,
            publishAfterSave,
          });
          saved++;
          updated += response.updated;
          if (response.published) published++;
          if (response.publicationError) publicationWarnings++;
          patchBot(bot.application.shortName, {
            analysis: response,
            overrides: {},
            error: response.publicationError,
            result: `${response.updated} bloco(s) alterado(s)${response.kept ? ` · ${response.kept} mantido(s)` : ""}. ${response.published ? "Rascunho salvo e fluxo publicado." : "Rascunho salvo."}`,
          });
          recordActivityResult(
            `Inatividade: ${bot.application.name} · ${response.updated} bloco(s) alterado(s)`,
            {
              bot: bot.application.shortName,
              updated: response.updated,
              kept: response.kept,
              published: response.published,
              publicationIndex: response.publicationIndex,
              publicationError: response.publicationError,
            },
            response.publicationError ? "warning" : "success",
            "inactivity",
          );
        } catch (caughtError) {
          failed++;
          // An interrupted save may have reached Blip. Require a new analysis before retrying.
          patchBot(bot.application.shortName, {
            status: "error",
            error: messageOf(caughtError),
            result: undefined,
          });
          recordActivityResult(
            `Falha na inatividade: ${bot.application.name}`,
            { bot: bot.application.shortName, error: messageOf(caughtError) },
            "error",
            "inactivity",
          );
        }
        if (mounted.current) setProgress({ processed: index + 1, total: targets.length });
      }
      if (mounted.current) {
        if (saved)
          setNotice(
            `${saved} bot(s) com rascunho salvo · ${updated} bloco(s) alterado(s). ${publishAfterSave ? `${published} publicação(ões) confirmada(s).` : "Nenhum bot foi publicado."}`,
          );
        if (failed || publicationWarnings)
          setError(
            `${failed ? `${failed} bot(s) com falha ao salvar. ` : ""}${publicationWarnings ? `${publicationWarnings} bot(s) com aviso de publicação. ` : ""}Confira o aviso em cada bot e atualize a análise antes de tentar novamente.`,
          );
      }
    } finally {
      operationLock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function openDetails(bot: BotDraft) {
    setDetailId(bot.application.shortName);
    setOpenGroup(null);
    setSearch("");
  }

  return (
    <section className="ember-panel inactivity-panel" aria-label="Inatividade dos Builders">
      <div className="ember-panel-title">
        <div>
          <h2>Inatividade global</h2>
          <p>Selecione os Builders, revise os blocos e salve o tempo de inatividade no rascunho.</p>
        </div>
        <Button onClick={onSelect} disabled={!embedded || busy || loading}>
          <Clock3 size={18} aria-hidden="true" /> Selecionar bots
        </Button>
      </div>
      {!embedded && (
        <Feedback tone="info">
          Abra a extensão no Portal Blip para selecionar os Builders do contrato.
        </Feedback>
      )}
      {error && (
        <Feedback title="Confira antes de aplicar" onDismiss={() => setError("")}>
          {error}
        </Feedback>
      )}
      {notice && (
        <Feedback tone="success" onDismiss={() => setNotice("")}>
          {notice}
        </Feedback>
      )}
      <div className="inactivity-controls">
        <label className="blip-native-field" htmlFor="inactivity-minutes">
          Tempo global (minutos)
          <input
            id="inactivity-minutes"
            type="number"
            min="0"
            max="1380"
            step="any"
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            disabled={busy}
            aria-invalid={!validInactivityMinutes(minutes)}
            aria-describedby="inactivity-time-help"
          />
        </label>
        <label className="inactivity-check">
          <input
            type="checkbox"
            checked={keepExisting}
            onChange={(event) => setKeepExisting(event.target.checked)}
            disabled={busy}
          />
          Manter tempos já preenchidos
        </label>
        <label className="inactivity-check">
          <input
            type="checkbox"
            checked={publishAfterSave}
            onChange={(event) => void togglePublication(event.target.checked)}
            disabled={busy}
            aria-describedby="inactivity-publish-help"
          />
          Publicar automaticamente
        </label>
        <Button
          variant="primary"
          onClick={() => void apply()}
          loading={busy}
          disabled={
            loading || !effectiveCount || !validInactivityMinutes(minutes) || individualInvalid
          }
        >
          {publishAfterSave ? "Salvar e publicar" : "Salvar"} em {targets.length} bot(s)
        </Button>
      </div>
      <p className="inactivity-note" id="inactivity-time-help">
        Maior que zero e menor que 1380 minutos. Os tempos individuais definidos nos detalhes têm
        prioridade sobre o global. A opção de manter tempos preserva os blocos já preenchidos.
      </p>
      <p className="inactivity-note" id="inactivity-publish-help">
        {publishAfterSave
          ? "A publicação inclui os tempos já salvos no rascunho. Se houver outras mudanças pendentes, publique-as no Builder primeiro."
          : "A publicação automática é opcional. Por padrão, apenas o rascunho é salvo."}
      </p>
      <div className="inactivity-summary" role="status" aria-live="polite">
        <span>
          {ready.length}/{bots.length} bot(s) analisado(s)
        </span>
        <span>{eligibleCount} bloco(s) elegível(is)</span>
        <span>
          {selectedBlocks} selecionado(s) · {effectiveCount} para aplicar
        </span>
        {confirming && <span>Aguardando confirmação de publicação…</span>}
        {busy && !confirming && (
          <span>
            {publishAfterSave ? "Salvando e publicando" : "Salvando"} {progress.processed}/
            {progress.total} bot(s)…
          </span>
        )}
        {loading && <span>Analisando rascunhos…</span>}
      </div>
      {bots.length === 0 ? (
        <EmptyState title="Selecione os bots para consultar a inatividade">
          Todos os blocos que esperam resposta serão selecionados inicialmente, seguindo a regra do
          Blip Addons.
        </EmptyState>
      ) : (
        <div className="inactivity-bot-list">
          {bots.map((bot) => (
            <div className="inactivity-bot-row" key={bot.application.shortName}>
              <label className="inactivity-bot-selection">
                <input
                  type="checkbox"
                  aria-label={`Aplicar em ${bot.application.name}`}
                  checked={bot.selected}
                  disabled={busy || bot.status !== "ready"}
                  onChange={(event) =>
                    patchBot(bot.application.shortName, { selected: event.target.checked })
                  }
                />
                <span className="router-application-avatar" aria-hidden="true">
                  {bot.application.imageUri ? (
                    <img src={bot.application.imageUri} alt="" loading="lazy" />
                  ) : (
                    bot.application.name.slice(0, 1).toUpperCase()
                  )}
                </span>
              </label>
              <button
                className="inactivity-bot-details"
                type="button"
                onClick={() => openDetails(bot)}
                disabled={!bot.analysis || bot.status !== "ready" || busy}
                aria-label={`Ver inatividade de ${bot.application.name}`}
              >
                <strong>{bot.application.name}</strong>
                <span>{bot.application.shortName}</span>
                {bot.status === "loading" ? (
                  <span>Analisando…</span>
                ) : (
                  bot.analysis && (
                    <span>
                      {bot.analysis.configuredBlocks} com inatividade ·{" "}
                      {bot.analysis.eligibleBlocks - bot.analysis.configuredBlocks} sem tempo ·{" "}
                      {bot.blockKeys.size} selecionado(s)
                    </span>
                  )
                )}
                {bot.status === "ready" && (
                  <span className="inactivity-detail-link">
                    <Eye size={15} aria-hidden="true" /> Ver tempos e blocos
                  </span>
                )}
              </button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void refreshBot(bot)}
                disabled={busy || loading}
                aria-label={`Atualizar análise de ${bot.application.name}`}
              >
                <RefreshCw size={16} aria-hidden="true" /> Atualizar
              </Button>
              {bot.error && (
                <Feedback
                  className="inactivity-bot-feedback"
                  title={`Falha em ${bot.application.name}`}
                >
                  {bot.error} Use Atualizar para conferir o rascunho e refazer a seleção.
                </Feedback>
              )}
              {bot.result && (
                <p className="inactivity-bot-feedback inactivity-saved" role="status">
                  {bot.result}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {groups.length > 0 && (
        <div className="inactivity-distribution">
          <h3>Tempos nos bots analisados</h3>
          <p className="inactivity-note">
            Um bot pode aparecer em mais de um tempo. As contagens consideram todos os blocos
            elegíveis dos bots analisados.
          </p>
          <ul>
            {groups.map((group) => (
              <li key={group.key}>
                <strong>{expirationLabel(group.expiration)}</strong>
                <span>
                  {group.bots} bot(s) · {group.blocks} bloco(s)
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="inactivity-note">
        A regra do Addons ignora onboarding, fallback, error e entradas com bypass. Apenas a
        primeira entrada de cada bloco é considerada.
      </p>
      {detail?.analysis && (
        <div className="ember-modal-backdrop" role="presentation">
          <section
            className="ember-modal inactivity-details-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="inactivity-details-title"
            data-modal-id="inactivity-details"
            tabIndex={-1}
          >
            <div className="ember-modal-header">
              <div>
                <h2 id="inactivity-details-title">Inatividade · {detail.application.name}</h2>
                <p>
                  {detail.analysis.eligibleBlocks} bloco(s) elegível(is) de{" "}
                  {detail.analysis.totalBlocks} · {detail.blockKeys.size} selecionado(s)
                </p>
              </div>
              <Button
                variant="secondary"
                className="icon-only"
                aria-label="Fechar detalhes"
                onClick={() => setDetailId(null)}
                disabled={busy}
              >
                <X size={18} aria-hidden="true" />
              </Button>
            </div>
            <div className="ember-modal-body">
              <Feedback tone="info">
                As edições abaixo ficam preparadas nesta aba. Use Salvar para gravar os rascunhos
                dos bots selecionados.
              </Feedback>
              <div className="inactivity-detail-tools">
                <label className="blip-native-field" htmlFor="inactivity-block-search">
                  Buscar bloco
                  <input
                    id="inactivity-block-search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Nome ou ID do bloco"
                  />
                </label>
                <Button
                  onClick={() =>
                    patchBot(detail.application.shortName, {
                      blockKeys: new Set(detail.analysis!.blocks.map((block) => block.blockKey)),
                    })
                  }
                  disabled={busy}
                >
                  Selecionar todos
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => patchBot(detail.application.shortName, { blockKeys: new Set() })}
                  disabled={busy}
                >
                  Limpar seleção
                </Button>
              </div>
              {detail.analysis.blocks.length === 0 && (
                <EmptyState title="Nenhum bloco elegível">
                  Este rascunho não contém entradas que esperam resposta segundo a regra do Addons.
                </EmptyState>
              )}
              {detail.analysis.blocks.length > 0 &&
                !detail.analysis.blocks.some((block) =>
                  `${block.title} ${block.id}`.toLowerCase().includes(search.toLowerCase()),
                ) && (
                  <p className="inactivity-note" role="status">
                    Nenhum bloco encontrado para esta busca.
                  </p>
                )}
              <div className="inactivity-groups">
                {groupInactivity([detail.analysis]).map((group) => {
                  const blocks = detail.analysis!.blocks.filter(
                    (block) =>
                      expirationGroup(block.expiration) === group.key &&
                      `${block.title} ${block.id}`.toLowerCase().includes(search.toLowerCase()),
                  );
                  if (!blocks.length) return null;
                  const expanded = openGroup === group.key || !!search.trim();
                  return (
                    <div className="inactivity-group" key={group.key}>
                      <button
                        type="button"
                        className="inactivity-group-toggle"
                        aria-expanded={expanded}
                        aria-controls={`inactivity-group-${group.key}`}
                        onClick={() => setOpenGroup(expanded ? null : group.key)}
                      >
                        <span>
                          <strong>{expirationLabel(group.expiration)}</strong> · {group.blocks}{" "}
                          bloco(s)
                        </span>
                        <ChevronDown size={18} aria-hidden="true" />
                      </button>
                      {expanded && (
                        <div id={`inactivity-group-${group.key}`} className="inactivity-block-list">
                          {blocks.map((block) => (
                            <div className="inactivity-block-row" key={block.blockKey}>
                              <label className="inactivity-block-check">
                                <input
                                  type="checkbox"
                                  checked={detail.blockKeys.has(block.blockKey)}
                                  disabled={busy}
                                  aria-label={`Selecionar bloco ${block.title}`}
                                  onChange={(event) => {
                                    const next = new Set(detail.blockKeys);
                                    if (event.target.checked) next.add(block.blockKey);
                                    else next.delete(block.blockKey);
                                    patchBot(detail.application.shortName, { blockKeys: next });
                                  }}
                                />
                                <span>
                                  <strong>{block.title}</strong>
                                  <span>{block.id}</span>
                                  <span>
                                    Atual: {expirationLabel(block.expiration)}
                                    {keepExisting && block.expiration ? " · será mantido" : ""}
                                  </span>
                                </span>
                              </label>
                              <label className="blip-native-field inactivity-block-time">
                                Tempo individual (min)
                                <input
                                  type="number"
                                  min="0"
                                  max="1380"
                                  step="any"
                                  value={detail.overrides[block.blockKey] ?? ""}
                                  placeholder={`Global: ${minutes}`}
                                  disabled={
                                    busy ||
                                    !detail.blockKeys.has(block.blockKey) ||
                                    !!(keepExisting && block.expiration)
                                  }
                                  aria-invalid={
                                    !!detail.overrides[block.blockKey]?.trim() &&
                                    !validInactivityMinutes(detail.overrides[block.blockKey])
                                  }
                                  onChange={(event) =>
                                    patchBot(detail.application.shortName, {
                                      overrides: {
                                        ...detail.overrides,
                                        [block.blockKey]: event.target.value,
                                      },
                                    })
                                  }
                                />
                              </label>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="ember-modal-footer">
              <span className="inactivity-note">Vazio usa o tempo global de {minutes} min.</span>
              <Button variant="primary" onClick={() => setDetailId(null)}>
                Concluir revisão
              </Button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
