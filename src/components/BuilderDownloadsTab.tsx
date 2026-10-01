import { useRef, useState } from "react";
import { Download, RefreshCw, FileJson } from "lucide-react";
import { useRouterBuilderScope } from "../hooks/useRouterBuilderScope";
import { filterBuilderPickerApplications, type BuilderPickerScope } from "../lib/builderPicker";
import {
  builderExportFile,
  createBuilderZip,
  saveDownload,
  type BuilderExport,
} from "../lib/builderDownload";
import { postJson } from "../lib/api";
import type { PortalApplicationAccount, ResolvedRouterKey } from "../types/templates";
import { Button } from "./ui/Button";
import { EmptyState, Feedback } from "./ui/Feedback";
import "../styles/bot-manager.css";

export function BuilderDownloadsTab({
  applications,
  routerShortName,
  resolveKey,
  embedded,
  active,
  loading,
  loadError,
  onRefresh,
  onBusyChange,
}: {
  applications: PortalApplicationAccount[];
  routerShortName: string;
  resolveKey: (shortName: string) => Promise<ResolvedRouterKey>;
  embedded: boolean;
  active: boolean;
  loading: boolean;
  loadError: string;
  onRefresh: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [scope, setScope] = useState<BuilderPickerScope>("router");
  const [version, setVersion] = useState<BuilderExport["version"]>("working");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [progress, setProgress] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState<Record<string, string>>({});
  const router = useRouterBuilderScope(
    routerShortName,
    embedded && active && scope === "router",
    resolveKey,
  );
  const candidates = filterBuilderPickerApplications(applications, {
    scope,
    routerBuilderIds: router.ids,
  });
  const visible = filterBuilderPickerApplications(candidates, {
    scope: "all",
    routerBuilderIds: null,
    query,
  });
  const chosen = candidates.filter((app) => selected.has(app.shortName));
  const ready = embedded && !busy && !loading && !loadError && !router.loading && !router.error;

  async function download(bots: PortalApplicationAccount[], bundle: boolean) {
    if (lock.current || !ready || !bots.length) return;
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    setSummary("");
    setError("");
    setResults({});
    const exported: BuilderExport[] = [];
    let failures = 0;
    try {
      for (const [index, bot] of bots.entries()) {
        setProgress(`Preparando ${index + 1}/${bots.length}: ${bot.name}`);
        try {
          const { key } = await resolveKey(bot.shortName);
          const result = await postJson<BuilderExport>("/api/builders/export", {
            builderShortName: bot.shortName,
            builderKey: key,
            version,
          });
          if (
            result.builderShortName !== bot.shortName ||
            result.version !== version ||
            !result.document ||
            ![
              result.document.flow,
              result.document.configuration,
              result.document.globalActions,
            ].every((value) => value && typeof value === "object" && !Array.isArray(value))
          )
            throw new Error("A resposta não confirmou o fluxo solicitado.");
          exported.push(result);
        } catch (caught) {
          failures++;
          setResults((current) => ({
            ...current,
            [bot.shortName]:
              caught instanceof Error
                ? caught.message
                : "Não foi possível ler este fluxo. Tente baixar novamente.",
          }));
        }
      }
      if (!exported.length)
        throw new Error("Nenhum fluxo foi baixado. Confira os erros na lista e tente novamente.");
      if (bundle) {
        setProgress("Montando o arquivo ZIP…");
        const zip = await createBuilderZip(exported);
        saveDownload(
          new Blob([new Uint8Array(zip)], { type: "application/zip" }),
          `fluxos-${version === "working" ? "rascunho" : "publicados"}.zip`,
        );
      } else {
        const file = builderExportFile(exported[0]);
        saveDownload(new Blob([file.text], { type: "application/json" }), file.name);
      }
      setSummary(
        `${exported.length} fluxo(s) enviado(s) para download${failures ? ` · ${failures} não incluído(s); confira os erros abaixo` : ""}.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível gerar o download.");
    } finally {
      setBusy(false);
      lock.current = false;
      setProgress("");
      onBusyChange(false);
    }
  }

  return (
    <section className="ember-panel results-panel builder-downloads" aria-label="Baixar Fluxos">
      <div className="ember-panel-title results-title">
        <div>
          <h2>Baixar Fluxos</h2>
          <p>
            Baixe um fluxo em JSON ou reúna vários em um arquivo ZIP, com configurações e ações
            globais.
          </p>
        </div>
        <Button
          onClick={() => {
            onRefresh();
            router.refresh();
          }}
          disabled={!embedded || busy || loading || router.loading}
        >
          <RefreshCw size={18} aria-hidden="true" /> Atualizar
        </Button>
      </div>
      {!embedded ? (
        <Feedback tone="info">
          Abra esta extensão no Portal Blip para consultar e baixar os fluxos.
        </Feedback>
      ) : (
        <>
          <div className="manager-filters download-filters">
            <label className="blip-native-field">
              Builders
              <select
                value={scope}
                disabled={busy}
                onChange={(event) => {
                  setScope(event.target.value as BuilderPickerScope);
                  setSelected(new Set());
                  setResults({});
                  setSummary("");
                }}
              >
                <option value="router">Somente do roteador</option>
                <option value="all">Todos com acesso</option>
              </select>
            </label>
            <label className="blip-native-field">
              Versão do fluxo
              <select
                value={version}
                disabled={busy}
                onChange={(event) => {
                  setVersion(event.target.value as BuilderExport["version"]);
                  setResults({});
                  setSummary("");
                }}
              >
                <option value="working">Rascunho</option>
                <option value="published">Publicada</option>
              </select>
            </label>
            <label className="blip-native-field manager-search">
              Buscar fluxo
              <input
                value={query}
                disabled={busy}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Nome ou ID do Builder"
              />
            </label>
          </div>
          <p className="manager-context">
            {scope === "router"
              ? `Roteador: ${routerShortName || "nenhum disponível"}`
              : "Builders aos quais você tem acesso no contrato atual"}{" "}
            · {candidates.length} fluxo(s)
          </p>
          {(loadError || router.error) && (
            <Feedback title="Não foi possível listar os fluxos">
              {loadError || router.error} Use Atualizar para tentar novamente
              {!routerShortName && scope === "router" ? " ou escolha Todos com acesso" : ""}.
            </Feedback>
          )}
          {error && (
            <Feedback title="Download não concluído" onDismiss={() => setError("")}>
              {error}
            </Feedback>
          )}
          {summary && (
            <Feedback tone={Object.keys(results).length ? "warning" : "success"}>
              {summary}
            </Feedback>
          )}
          {Object.keys(results).length > 0 && (
            <Feedback title="Fluxos não incluídos no download">
              <ul>
                {Object.entries(results).map(([id, message]) => (
                  <li key={id}>
                    <strong>{applications.find((app) => app.shortName === id)?.name || id}:</strong>{" "}
                    {message}
                  </li>
                ))}
              </ul>
            </Feedback>
          )}
          <div className="manager-download-actions">
            <span>
              {chosen.length} selecionado(s){query ? ` · ${visible.length} exibido(s)` : ""}
            </span>
            <Button
              size="sm"
              onClick={() =>
                setSelected(
                  (current) => new Set([...current, ...visible.map((app) => app.shortName)]),
                )
              }
              disabled={!ready || !visible.length}
            >
              Selecionar todos{query ? " exibidos" : ""}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
              disabled={busy || !selected.size}
            >
              Limpar seleção
            </Button>
            <Button
              variant="primary"
              onClick={() => void download(chosen, true)}
              disabled={!ready || !chosen.length}
            >
              <Download size={18} aria-hidden="true" /> Baixar selecionados (.zip)
            </Button>
            <Button
              onClick={() => void download(candidates, true)}
              disabled={!ready || !candidates.length}
            >
              <Download size={18} aria-hidden="true" /> Baixar todos (.zip)
            </Button>
          </div>
          <p className="manager-context">
            Baixar todos inclui todos os Builders da opção escolhida, mesmo os ocultos pela busca.
          </p>
          {(busy || loading || router.loading) && (
            <p role="status" aria-live="polite">
              {busy ? progress : "Carregando os fluxos…"}
            </p>
          )}
          {!loading &&
            !router.loading &&
            !loadError &&
            !router.error &&
            (visible.length ? (
              <ul className="manager-download-list">
                {visible.map((bot) => (
                  <li key={bot.shortName}>
                    <div className="manager-download-row">
                      <label className="manager-download-choice">
                        <input
                          type="checkbox"
                          checked={selected.has(bot.shortName)}
                          disabled={busy}
                          onChange={() =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (next.has(bot.shortName)) next.delete(bot.shortName);
                              else next.add(bot.shortName);
                              return next;
                            })
                          }
                          aria-label={`Selecionar fluxo de ${bot.name}`}
                        />
                        <FileJson size={20} aria-hidden="true" />
                        <span>
                          <strong>{bot.name}</strong>
                          <small>{bot.shortName}</small>
                        </span>
                      </label>
                      <Button
                        size="sm"
                        onClick={() => void download([bot], false)}
                        disabled={!ready}
                        aria-label={`Baixar fluxo de ${bot.name}`}
                      >
                        <Download size={16} aria-hidden="true" /> Baixar JSON
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title={query ? "Nenhum fluxo corresponde à busca" : "Nenhum Builder disponível"}
              >
                {query
                  ? "Tente outro nome ou ID."
                  : "Escolha Todos com acesso para consultar os Builders do contrato."}
              </EmptyState>
            ))}
        </>
      )}
    </section>
  );
}
