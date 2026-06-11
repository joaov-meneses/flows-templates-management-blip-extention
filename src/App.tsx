import { FormEvent, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowDownAZ,
  ArrowDownZA,
  CheckSquare,
  Clipboard,
  CopyPlus,
  Eye,
  FileJson,
  LoaderCircle,
  MessageSquareText,
  Plus,
  Search,
  Send,
  Square,
  Trash2,
  X
} from "lucide-react";

type ActiveView = "templates" | "flows";
type RouterModal = "source" | "targets" | null;
type SortDirection = "asc" | "desc";

type Template = {
  name: string;
  language: string;
  category: string;
  status?: string;
  components: unknown;
};

type SearchResponse = {
  search: {
    templateName: string;
    onlyApproved: boolean;
  };
  total: number;
  templates: Template[];
};

type TemplateReplicateResponse = {
  totals: {
    foundTemplates: number;
    targetRouters: number;
    createJobs: number;
    uploadedAttachments: number;
    created: number;
    errors: number;
  };
  foundTemplates: unknown[];
  created: unknown[];
  errors: unknown[];
};

type TemplateCompareResponse = {
  filters: {
    category: string;
    status: string;
  };
  totals: {
    routers: number;
    sourceRouterIncluded: boolean;
    commonTemplates: number;
    templatesByRouter: Array<{
      routerIndex: number;
      role?: string;
      totalTemplates: number;
      totalFilteredTemplates: number;
    }>;
  };
  commonTemplates: Array<{
    name: string;
    language: string;
    category?: string;
    status?: string;
    routers: Array<{
      routerIndex: number;
      role?: string;
      name: string;
      language: string;
      category?: string;
      status?: string;
    }>;
  }>;
};

type FlowSummary = {
  id: string;
  name: string;
  status?: string;
  categories?: string[];
  validation_errors?: unknown[];
};

type FlowSearchResponse = {
  total: number;
  flows: FlowSummary[];
};

type FlowPreviewResponse = {
  flow: unknown;
  previewUrl: string;
  expiresAt?: string;
};

type FlowJsonResponse = {
  flowId: string;
  downloadUrl: string;
  json: unknown;
};

type FlowReplicateResponse = {
  totals: {
    foundFlows: number;
    publicKeyUploads: number;
    loadedFlows: number;
    targetRouters: number;
    createJobs: number;
    copied: number;
    errors: number;
  };
  foundFlows: FlowSummary[];
  copied: unknown[];
  errors: unknown[];
};

type FlowCreateResponse = {
  flow: FlowSummary & {
    endpoint_uri?: string;
  };
  createResponse: unknown;
  setJsonResponse: unknown;
};

type FlowPublishResponse = {
  flowId: string;
  publishResponse: unknown;
};

type OperationResult = {
  summary: string;
  payload: unknown;
  previewFlow?: FlowSummary;
};

const DEFAULT_TEMPLATE_OPTIONS = {
  dryRun: false,
  continueOnError: true,
  onlyApproved: false,
  batchSize: 15
};

const DEFAULT_FLOW_OPTIONS = {
  continueOnError: true,
  batchSize: 15
};

const emptyTemplateSearch: SearchResponse = {
  search: {
    templateName: "",
    onlyApproved: false
  },
  total: 0,
  templates: []
};

const emptyFlowSearch: FlowSearchResponse = {
  total: 0,
  flows: []
};

function splitLines(value: string) {
  return value
    .split(/[\n,;]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function templateKey(template: Template) {
  return `${template.name}|${template.language}`;
}

function flowKey(flow: FlowSummary) {
  return String(flow.id);
}

function maskRouterKey(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Nenhum router configurado";
  }

  const normalized = trimmed.startsWith("Key ") ? trimmed.slice(4) : trimmed;
  const start = normalized.slice(0, 8);
  const end = normalized.slice(-8);
  return `Key ${start}••••${end}`;
}

async function postJson<TResponse>(path: string, body: unknown): Promise<TResponse> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error?.message || `Erro HTTP ${response.status}`);
  }

  return data as TResponse;
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function App() {
  const [activeView, setActiveView] = useState<ActiveView>("templates");
  const [sourceRouterKey, setSourceRouterKey] = useState("");
  const [targetRouterKeys, setTargetRouterKeys] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateSearchResult, setTemplateSearchResult] = useState<SearchResponse>(emptyTemplateSearch);
  const [selectedTemplateKeys, setSelectedTemplateKeys] = useState<Set<string>>(new Set());
  const [flowSearchResult, setFlowSearchResult] = useState<FlowSearchResponse>(emptyFlowSearch);
  const [flowFilter, setFlowFilter] = useState("");
  const [selectedFlowIds, setSelectedFlowIds] = useState<Set<string>>(new Set());
  const [routerModal, setRouterModal] = useState<RouterModal>(null);
  const [isTemplateCompareModalOpen, setIsTemplateCompareModalOpen] = useState(false);
  const [templateCompareCategory, setTemplateCompareCategory] = useState("");
  const [templateCompareStatus, setTemplateCompareStatus] = useState("");
  const [templateCompareResult, setTemplateCompareResult] = useState<TemplateCompareResponse | null>(null);
  const [templateCompareNameSort, setTemplateCompareNameSort] = useState<SortDirection>("asc");
  const [isCreateFlowModalOpen, setIsCreateFlowModalOpen] = useState(false);
  const [draftSourceRouterKey, setDraftSourceRouterKey] = useState("");
  const [draftTargetRouterKeys, setDraftTargetRouterKeys] = useState("");
  const [newFlowName, setNewFlowName] = useState("");
  const [newFlowIsApi, setNewFlowIsApi] = useState(false);
  const [newFlowEndpointUri, setNewFlowEndpointUri] = useState("");
  const [newFlowJson, setNewFlowJson] = useState("");
  const [operationResult, setOperationResult] = useState<OperationResult | null>(null);
  const [error, setError] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const [isSearchingTemplates, setIsSearchingTemplates] = useState(false);
  const [isReplicatingTemplates, setIsReplicatingTemplates] = useState(false);
  const [isComparingTemplates, setIsComparingTemplates] = useState(false);
  const [isLoadingFlows, setIsLoadingFlows] = useState(false);
  const [isReplicatingFlows, setIsReplicatingFlows] = useState(false);
  const [isCreatingFlow, setIsCreatingFlow] = useState(false);
  const [flowActionId, setFlowActionId] = useState("");

  const targetCount = splitLines(targetRouterKeys).length;

  const selectedTemplates = useMemo(
    () => templateSearchResult.templates.filter(template => selectedTemplateKeys.has(templateKey(template))),
    [templateSearchResult.templates, selectedTemplateKeys]
  );

  const allVisibleTemplatesSelected = templateSearchResult.templates.length > 0
    && selectedTemplates.length === templateSearchResult.templates.length;

  const displayedCompareTemplates = useMemo(() => {
    const templates = templateCompareResult?.commonTemplates ?? [];

    return [...templates].sort((first, second) => {
      const nameCompare = first.name.localeCompare(second.name, "pt-BR", { sensitivity: "base" });
      const languageCompare = first.language.localeCompare(second.language, "pt-BR", { sensitivity: "base" });
      const result = nameCompare || languageCompare;
      return templateCompareNameSort === "asc" ? result : -result;
    });
  }, [templateCompareNameSort, templateCompareResult]);

  const filteredFlows = useMemo(() => {
    const query = flowFilter.trim().toLowerCase();
    if (!query) {
      return flowSearchResult.flows;
    }

    return flowSearchResult.flows.filter(flow => (
      flow.name.toLowerCase().includes(query)
      || flow.id.toLowerCase().includes(query)
    ));
  }, [flowFilter, flowSearchResult.flows]);

  const selectedFlows = useMemo(
    () => flowSearchResult.flows.filter(flow => selectedFlowIds.has(flowKey(flow))),
    [flowSearchResult.flows, selectedFlowIds]
  );

  const allVisibleFlowsSelected = filteredFlows.length > 0
    && filteredFlows.every(flow => selectedFlowIds.has(flowKey(flow)));

  const headerCopy = activeView === "templates"
    ? {
      kicker: "WhatsApp Templates",
      title: "Templates",
      description: "Replicação de templates entre routers BLiP"
    }
    : {
      kicker: "WhatsApp Flows",
      title: "Flows",
      description: "Consulta, visualização e cópia de flows entre routers BLiP"
    };

  async function handleSearchTemplates(event: FormEvent) {
    event.preventDefault();
    setError("");
    setOperationResult(null);

    if (!sourceRouterKey.trim()) {
      setError("Informe a key do router de origem.");
      openSourceModal();
      return;
    }

    setIsSearchingTemplates(true);

    try {
      const data = await postJson<SearchResponse>("/api/templates/search", {
        sourceRouterKey: sourceRouterKey.trim(),
        templateName: templateName.trim(),
        onlyApproved: DEFAULT_TEMPLATE_OPTIONS.onlyApproved
      });

      setTemplateSearchResult(data);
      setSelectedTemplateKeys(data.templates.length === 1
        ? new Set([templateKey(data.templates[0])])
        : new Set());
    } catch (caughtError) {
      setTemplateSearchResult(emptyTemplateSearch);
      setSelectedTemplateKeys(new Set());
      setError(caughtError instanceof Error ? caughtError.message : "Erro ao buscar templates.");
    } finally {
      setIsSearchingTemplates(false);
    }
  }

  async function handleReplicateTemplates() {
    setError("");
    setOperationResult(null);

    if (selectedTemplates.length === 0) {
      setError("Selecione pelo menos um template.");
      return;
    }

    const targets = splitLines(targetRouterKeys);
    if (targets.length === 0) {
      setError("Informe pelo menos uma key de destino.");
      openTargetsModal();
      return;
    }

    setIsReplicatingTemplates(true);

    try {
      const data = await postJson<TemplateReplicateResponse>("/api/templates/replicate", {
        targetRouterKeys: targets,
        templates: selectedTemplates,
        ...DEFAULT_TEMPLATE_OPTIONS
      });

      setOperationResult({
        summary: `${data.totals.created} criações, ${data.totals.uploadedAttachments} imagens, ${data.totals.errors} erros`,
        payload: data
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Erro ao replicar templates.");
    } finally {
      setIsReplicatingTemplates(false);
    }
  }

  async function handleCompareTemplates(event?: FormEvent) {
    event?.preventDefault();
    setError("");

    if (!sourceRouterKey.trim()) {
      setError("Informe a key do router de origem para comparar.");
      openSourceModal();
      return;
    }

    const routers = splitLines(targetRouterKeys);
    if (routers.length === 0) {
      setError("Informe pelo menos um router de destino para comparar com a origem.");
      openTargetsModal();
      return;
    }

    setIsComparingTemplates(true);

    try {
      const data = await postJson<TemplateCompareResponse>("/api/templates/compare", {
        sourceRouterKey: sourceRouterKey.trim(),
        targetRouterKeys: routers,
        category: templateCompareCategory,
        status: templateCompareStatus
      });

      setTemplateCompareResult(data);
      setOperationResult({
        summary: `${data.totals.commonTemplates} templates em comum em ${data.totals.routers} routers.`,
        payload: data
      });
    } catch (caughtError) {
      setTemplateCompareResult(null);
      setError(caughtError instanceof Error ? caughtError.message : "Erro ao comparar templates.");
    } finally {
      setIsComparingTemplates(false);
    }
  }

  async function handleCopyJson(payload: unknown, successMessage: string) {
    setError("");

    try {
      await copyText(JSON.stringify(payload, null, 2));
      setCopyNotice(successMessage);
      window.setTimeout(() => setCopyNotice(""), 2400);
    } catch (caughtError) {
      setCopyNotice("");
      setError(caughtError instanceof Error ? caughtError.message : "Erro ao copiar JSON.");
    }
  }

  async function handleLoadFlows(event?: FormEvent) {
    event?.preventDefault();
    setError("");
    setOperationResult(null);

    if (!sourceRouterKey.trim()) {
      setError("Informe a key do router de origem.");
      openSourceModal();
      return;
    }

    setIsLoadingFlows(true);

    try {
      await loadFlowsFromSource();
    } catch (caughtError) {
      setFlowSearchResult(emptyFlowSearch);
      setSelectedFlowIds(new Set());
      setError(caughtError instanceof Error ? caughtError.message : "Erro ao carregar flows.");
    } finally {
      setIsLoadingFlows(false);
    }
  }

  async function loadFlowsFromSource() {
    const data = await postJson<FlowSearchResponse>("/api/flows/search", {
      sourceRouterKey: sourceRouterKey.trim()
    });

    setFlowSearchResult(data);
    setSelectedFlowIds(data.flows.length === 1
      ? new Set([flowKey(data.flows[0])])
      : new Set());

    return data;
  }

  async function handlePreviewFlow(flow: FlowSummary) {
    setError("");
    setFlowActionId(`preview:${flow.id}`);

    try {
      const data = await postJson<FlowPreviewResponse>("/api/flows/preview", {
        sourceRouterKey: sourceRouterKey.trim(),
        flowId: flow.id
      });

      window.open(data.previewUrl, "_blank", "noopener,noreferrer");
      setOperationResult({
        summary: `Preview aberto para "${flow.name}".`,
        payload: data
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Erro ao abrir preview do flow.");
    } finally {
      setFlowActionId("");
    }
  }

  async function handleCopyFlowJson(flow: FlowSummary) {
    setError("");
    setFlowActionId(`json:${flow.id}`);

    try {
      const data = await postJson<FlowJsonResponse>("/api/flows/json", {
        sourceRouterKey: sourceRouterKey.trim(),
        flowId: flow.id
      });

      await copyText(JSON.stringify(data.json, null, 2));
      setOperationResult({
        summary: `JSON copiado para "${flow.name}".`,
        payload: data
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Erro ao copiar JSON do flow.");
    } finally {
      setFlowActionId("");
    }
  }

  async function handlePublishFlow(flow: FlowSummary) {
    setError("");
    setFlowActionId(`publish:${flow.id}`);

    try {
      const data = await postJson<FlowPublishResponse>("/api/flows/publish", {
        sourceRouterKey: sourceRouterKey.trim(),
        flowId: flow.id
      });

      await loadFlowsFromSource();
      setOperationResult({
        summary: `Flow "${flow.name}" publicado com sucesso.`,
        payload: data,
        previewFlow: {
          ...flow,
          status: "PUBLISHED"
        }
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Erro ao publicar flow.");
    } finally {
      setFlowActionId("");
    }
  }

  async function handleCreateFlow() {
    setError("");

    if (!sourceRouterKey.trim()) {
      setError("Informe a key do router de origem.");
      return;
    }

    const normalizedName = newFlowName.trim();
    if (!normalizedName) {
      setError("Informe o nome do flow.");
      return;
    }

    if (newFlowIsApi && !newFlowEndpointUri.trim()) {
      setError("Informe o endpoint_uri para Flow API.");
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(newFlowJson);
    } catch {
      setError("Informe um JSON completo válido.");
      return;
    }

    setIsCreatingFlow(true);

    try {
      const data = await postJson<FlowCreateResponse>("/api/flows/create", {
        sourceRouterKey: sourceRouterKey.trim(),
        name: normalizedName,
        isFlowApi: newFlowIsApi,
        endpointUri: newFlowEndpointUri.trim(),
        flowJson: parsedJson
      });

      setIsCreateFlowModalOpen(false);
      setNewFlowName("");
      setNewFlowIsApi(false);
      setNewFlowEndpointUri("");
      setNewFlowJson("");
      setFlowFilter(data.flow.name);
      await loadFlowsFromSource();
      setOperationResult({
        summary: `Flow criado com sucesso. ID: ${data.flow.id}`,
        payload: data,
        previewFlow: data.flow
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Erro ao criar flow.");
    } finally {
      setIsCreatingFlow(false);
    }
  }

  async function handleReplicateFlows() {
    setError("");
    setOperationResult(null);

    if (!sourceRouterKey.trim()) {
      setError("Informe a key do router de origem.");
      openSourceModal();
      return;
    }

    if (selectedFlows.length === 0) {
      setError("Selecione pelo menos um flow.");
      return;
    }

    const targets = splitLines(targetRouterKeys);
    if (targets.length === 0) {
      setError("Informe pelo menos uma key de destino.");
      openTargetsModal();
      return;
    }

    setIsReplicatingFlows(true);

    try {
      const data = await postJson<FlowReplicateResponse>("/api/flows/replicate", {
        sourceRouterKey: sourceRouterKey.trim(),
        targetRouterKeys: targets,
        flows: selectedFlows,
        ...DEFAULT_FLOW_OPTIONS
      });

      setOperationResult({
        summary: `${data.totals.publicKeyUploads} public keys, ${data.totals.copied} flows copiados, ${data.totals.errors} erros`,
        payload: data
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Erro ao replicar flows.");
    } finally {
      setIsReplicatingFlows(false);
    }
  }

  function toggleTemplate(key: string) {
    setSelectedTemplateKeys(current => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  }

  function toggleAllTemplates() {
    if (allVisibleTemplatesSelected) {
      setSelectedTemplateKeys(new Set());
      return;
    }

    setSelectedTemplateKeys(new Set(templateSearchResult.templates.map(templateKey)));
  }

  function toggleFlow(id: string) {
    setSelectedFlowIds(current => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  function toggleVisibleFlows() {
    if (allVisibleFlowsSelected) {
      setSelectedFlowIds(current => {
        const next = new Set(current);
        for (const flow of filteredFlows) {
          next.delete(flowKey(flow));
        }
        return next;
      });
      return;
    }

    setSelectedFlowIds(current => {
      const next = new Set(current);
      for (const flow of filteredFlows) {
        next.add(flowKey(flow));
      }
      return next;
    });
  }

  function clearResults() {
    setTemplateSearchResult(emptyTemplateSearch);
    setSelectedTemplateKeys(new Set());
    setFlowSearchResult(emptyFlowSearch);
    setSelectedFlowIds(new Set());
    setFlowFilter("");
    setOperationResult(null);
    setError("");
    setCopyNotice("");
  }

  function openSourceModal() {
    setDraftSourceRouterKey(sourceRouterKey);
    setRouterModal("source");
  }

  function openTargetsModal() {
    setDraftTargetRouterKeys(targetRouterKeys);
    setRouterModal("targets");
  }

  function closeRouterModal() {
    setRouterModal(null);
  }

  function saveSourceRouter() {
    setSourceRouterKey(draftSourceRouterKey.trim());
    setRouterModal(null);
    setError("");
  }

  function saveTargetRouters() {
    setTargetRouterKeys(splitLines(draftTargetRouterKeys).join("\n"));
    setRouterModal(null);
    setError("");
  }

  return (
    <main className="ember-shell">
      <aside className="ember-sidebar" aria-label="Navegação da extensão">
        <div className="ember-logo extension-logo" aria-label="BLiP">
          <span className="blip-logo-mark">BLiP</span>
          <span className="ember-logo-text">Create Templates</span>
        </div>
        <nav className="ember-side-nav">
          <button
            className={activeView === "templates" ? "active" : ""}
            type="button"
            onClick={() => setActiveView("templates")}
          >
            <MessageSquareText size={18} aria-hidden="true" />
            Templates
          </button>
          <button
            className={activeView === "flows" ? "active" : ""}
            type="button"
            onClick={() => setActiveView("flows")}
          >
            <FileJson size={18} aria-hidden="true" />
            Flows
          </button>
        </nav>
      </aside>

      <section className="ember-content">
        <header className="ember-header">
          <div className="ember-header-copy">
            <div>
              <span className="ember-kicker">{headerCopy.kicker}</span>
              <h1>{headerCopy.title}</h1>
              <p>{headerCopy.description}</p>
            </div>
          </div>
          <div className="ember-header-actions">
            <div className="router-summary">
              <span>Router de origem</span>
              <strong>{maskRouterKey(sourceRouterKey)}</strong>
            </div>
            <button className="blip-button secondary" type="button" onClick={openSourceModal}>
              <Plus size={18} aria-hidden="true" />
              {sourceRouterKey ? "Editar router de origem" : "Adicionar router de origem"}
            </button>
            <button className="blip-button secondary" type="button" onClick={clearResults}>
              <Trash2 size={18} aria-hidden="true" />
              Limpar
            </button>
          </div>
        </header>

        {activeView === "templates" ? (
          <section className="ember-stat-grid template-stat-grid" aria-label="Resumo">
            <div className="ember-stat-card">
              <span>Encontrados</span>
              <strong>{templateSearchResult.total}</strong>
            </div>
            <div className="ember-stat-card">
              <span>Selecionados</span>
              <strong>{selectedTemplates.length}</strong>
            </div>
            <div className="ember-stat-card">
              <span>Destinos</span>
              <strong>{targetCount}</strong>
            </div>
            <div className="ember-stat-card">
              <span>Modo</span>
              <strong>Criação</strong>
            </div>
          </section>
        ) : (
          <section className="ember-stat-grid template-stat-grid" aria-label="Resumo">
            <div className="ember-stat-card">
              <span>Carregados</span>
              <strong>{flowSearchResult.total}</strong>
            </div>
            <div className="ember-stat-card">
              <span>Filtrados</span>
              <strong>{filteredFlows.length}</strong>
            </div>
            <div className="ember-stat-card">
              <span>Selecionados</span>
              <strong>{selectedFlows.length}</strong>
            </div>
            <div className="ember-stat-card">
              <span>Destinos</span>
              <strong>{targetCount}</strong>
            </div>
          </section>
        )}

        {error && (
          <div className="ember-alert danger" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {activeView === "templates" ? (
          <section className="ember-panel results-panel">
            <div className="ember-panel-title results-title">
              <div>
                <h2>Templates</h2>
                <p>
                  {templateSearchResult.total} encontrados, {selectedTemplates.length} selecionados, {targetCount} destinos
                </p>
              </div>
              <button
                className="blip-button secondary"
                type="button"
                onClick={toggleAllTemplates}
                disabled={templateSearchResult.templates.length === 0}
              >
                {allVisibleTemplatesSelected ? (
                  <CheckSquare size={18} aria-hidden="true" />
                ) : (
                  <Square size={18} aria-hidden="true" />
                )}
                Selecionar
              </button>
            </div>

            <form className="template-filter-row" onSubmit={handleSearchTemplates}>
              <label className="blip-native-field template-search-field" htmlFor="templateName">
                Nome do template
                <input
                  id="templateName"
                  value={templateName}
                  onChange={event => setTemplateName(event.target.value)}
                  placeholder="Vazio busca sem filtro"
                />
              </label>
              <button className="blip-submit-button secondary" type="submit" disabled={isSearchingTemplates}>
                {isSearchingTemplates ? (
                  <LoaderCircle className="spin" size={18} aria-hidden="true" />
                ) : (
                  <Search size={18} aria-hidden="true" />
                )}
                Buscar
              </button>
              <button
                className="blip-button secondary"
                type="button"
                onClick={() => {
                  setError("");
                  setCopyNotice("");
                  setTemplateCompareResult(null);
                  setIsTemplateCompareModalOpen(true);
                }}
              >
                <Search size={18} aria-hidden="true" />
                Comparar routers
              </button>
              <button className="blip-button secondary" type="button" onClick={openTargetsModal}>
                <Plus size={18} aria-hidden="true" />
                {targetCount ? `Editar routers de destino (${targetCount})` : "Adicionar routers de destino"}
              </button>
              <button
                className="blip-submit-button primary"
                type="button"
                onClick={handleReplicateTemplates}
                disabled={isReplicatingTemplates || selectedTemplates.length === 0}
              >
                {isReplicatingTemplates ? (
                  <LoaderCircle className="spin" size={18} aria-hidden="true" />
                ) : (
                  <CopyPlus size={18} aria-hidden="true" />
                )}
                Replicar
              </button>
            </form>

            <div className="ember-table-wrap template-table-wrap">
              <table className="ember-table">
                <thead>
                  <tr>
                    <th className="select-column">Sel.</th>
                    <th>Nome</th>
                    <th>Idioma</th>
                    <th>Categoria</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {templateSearchResult.templates.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="empty-cell">
                        Nenhum template carregado
                      </td>
                    </tr>
                  ) : (
                    templateSearchResult.templates.map(template => {
                      const key = templateKey(template);
                      const checked = selectedTemplateKeys.has(key);

                      return (
                        <tr key={key} className={checked ? "selected" : ""}>
                          <td className="select-column">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleTemplate(key)}
                              aria-label={`Selecionar ${template.name}`}
                            />
                          </td>
                          <td className="template-name">{template.name}</td>
                          <td>{template.language}</td>
                          <td>{template.category}</td>
                          <td>
                            <span className={`ember-status ${String(template.status || "").toLowerCase()}`}>
                              {template.status || "N/D"}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className="ember-panel results-panel">
            <div className="ember-panel-title results-title">
              <div>
                <h2>Flows</h2>
                <p>
                  {flowSearchResult.total} carregados, {filteredFlows.length} filtrados, {selectedFlows.length} selecionados
                </p>
              </div>
              <button
                className="blip-button secondary"
                type="button"
                onClick={toggleVisibleFlows}
                disabled={filteredFlows.length === 0}
              >
                {allVisibleFlowsSelected ? (
                  <CheckSquare size={18} aria-hidden="true" />
                ) : (
                  <Square size={18} aria-hidden="true" />
                )}
                Selecionar
              </button>
            </div>

            <form className="template-filter-row flow-filter-row" onSubmit={handleLoadFlows}>
              <label className="blip-native-field template-search-field" htmlFor="flowFilter">
                Filtrar por nome ou ID
                <input
                  id="flowFilter"
                  value={flowFilter}
                  onChange={event => setFlowFilter(event.target.value)}
                  placeholder="Digite nome ou ID"
                />
              </label>
              <button
                className="blip-button secondary"
                type="button"
                onClick={() => {
                  setError("");
                  setIsCreateFlowModalOpen(true);
                }}
              >
                <Plus size={18} aria-hidden="true" />
                Criar flow agora
              </button>
              <button className="blip-submit-button secondary" type="submit" disabled={isLoadingFlows}>
                {isLoadingFlows ? (
                  <LoaderCircle className="spin" size={18} aria-hidden="true" />
                ) : (
                  <Search size={18} aria-hidden="true" />
                )}
                Carregar flows
              </button>
              <button className="blip-button secondary" type="button" onClick={openTargetsModal}>
                <Plus size={18} aria-hidden="true" />
                {targetCount ? `Editar routers de destino (${targetCount})` : "Adicionar routers de destino"}
              </button>
              <button
                className="blip-submit-button primary"
                type="button"
                onClick={handleReplicateFlows}
                disabled={isReplicatingFlows || selectedFlows.length === 0}
              >
                {isReplicatingFlows ? (
                  <LoaderCircle className="spin" size={18} aria-hidden="true" />
                ) : (
                  <CopyPlus size={18} aria-hidden="true" />
                )}
                Replicar
              </button>
            </form>

            <div className="ember-table-wrap template-table-wrap">
              <table className="ember-table flow-table">
                <thead>
                  <tr>
                    <th className="select-column">Sel.</th>
                    <th>Nome</th>
                    <th>ID</th>
                    <th>Categorias</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFlows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="empty-cell">
                        Nenhum flow carregado
                      </td>
                    </tr>
                  ) : (
                    filteredFlows.map(flow => {
                      const key = flowKey(flow);
                      const checked = selectedFlowIds.has(key);

                      return (
                        <tr key={key} className={checked ? "selected" : ""}>
                          <td className="select-column">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleFlow(key)}
                              aria-label={`Selecionar ${flow.name}`}
                            />
                          </td>
                          <td className="template-name">{flow.name}</td>
                          <td className="mono-cell">{flow.id}</td>
                          <td>{flow.categories?.join(", ") || "-"}</td>
                          <td>
                            <span className={`ember-status ${String(flow.status || "").toLowerCase()}`}>
                              {flow.status || "N/D"}
                            </span>
                          </td>
                          <td>
                            <div className="table-actions">
                              <button
                                className="table-action-button"
                                type="button"
                                onClick={() => handlePreviewFlow(flow)}
                                disabled={flowActionId === `preview:${flow.id}`}
                              >
                                {flowActionId === `preview:${flow.id}` ? (
                                  <LoaderCircle className="spin" size={16} aria-hidden="true" />
                                ) : (
                                  <Eye size={16} aria-hidden="true" />
                                )}
                                Visualizar
                              </button>
                              <button
                                className="table-action-button"
                                type="button"
                                onClick={() => handleCopyFlowJson(flow)}
                                disabled={flowActionId === `json:${flow.id}`}
                              >
                                {flowActionId === `json:${flow.id}` ? (
                                  <LoaderCircle className="spin" size={16} aria-hidden="true" />
                                ) : (
                                  <Clipboard size={16} aria-hidden="true" />
                                )}
                                Copiar JSON
                              </button>
                              {String(flow.status || "").toUpperCase() === "DRAFT" && (
                                <button
                                  className="table-action-button publish"
                                  type="button"
                                  onClick={() => handlePublishFlow(flow)}
                                  disabled={flowActionId === `publish:${flow.id}`}
                                >
                                  {flowActionId === `publish:${flow.id}` ? (
                                    <LoaderCircle className="spin" size={16} aria-hidden="true" />
                                  ) : (
                                    <Send size={16} aria-hidden="true" />
                                  )}
                                  Publicar
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="ember-panel output-panel">
          <div className="ember-panel-title">
            <div>
              <h2>Resultado</h2>
              <p>{operationResult?.summary || "Aguardando execução"}</p>
            </div>
            <div className="output-actions">
              {operationResult?.previewFlow && (
                <button
                  className="blip-button secondary"
                  type="button"
                  onClick={() => handlePreviewFlow(operationResult.previewFlow!)}
                >
                  <Eye size={18} aria-hidden="true" />
                  Visualizar
                </button>
              )}
              <FileJson size={18} aria-hidden="true" />
            </div>
          </div>
          <pre className="code">{operationResult ? JSON.stringify(operationResult.payload, null, 2) : "{}"}</pre>
        </section>

        {isTemplateCompareModalOpen && (
          <div className="ember-modal-backdrop" role="presentation">
            <section
              className="ember-modal compare-modal"
              aria-labelledby="compare-modal-title"
              role="dialog"
              aria-modal="true"
            >
              <div className="ember-modal-header">
                <div>
                  <h2 id="compare-modal-title">Comparar templates</h2>
                  <p>Compara o router de origem com os destinos e retorna templates filtrados presentes em todos eles.</p>
                </div>
                <button
                  className="blip-button secondary icon-only"
                  type="button"
                  onClick={() => setIsTemplateCompareModalOpen(false)}
                >
                  <X size={18} aria-hidden="true" />
                  <span>Fechar</span>
                </button>
              </div>

              <form className="compare-form" onSubmit={handleCompareTemplates}>
                {error && (
                  <div className="ember-alert danger modal-alert" role="alert">
                    <AlertCircle size={18} aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                )}

                {copyNotice && (
                  <div className="ember-alert success modal-alert" role="status">
                    <Clipboard size={18} aria-hidden="true" />
                    <span>{copyNotice}</span>
                  </div>
                )}

                <label className="blip-native-field" htmlFor="compareCategory">
                  Tipo
                  <select
                    id="compareCategory"
                    value={templateCompareCategory}
                    onChange={event => setTemplateCompareCategory(event.target.value)}
                  >
                    <option value="">Todos</option>
                    <option value="UTILITY">Utility</option>
                    <option value="MARKETING">Marketing</option>
                  </select>
                </label>

                <label className="blip-native-field" htmlFor="compareStatus">
                  Status
                  <select
                    id="compareStatus"
                    value={templateCompareStatus}
                    onChange={event => setTemplateCompareStatus(event.target.value)}
                  >
                    <option value="">Todos</option>
                    <option value="APPROVED">Approved</option>
                    <option value="PENDING">Pending</option>
                    <option value="REJECTED">Rejected</option>
                    <option value="PAUSED">Paused</option>
                    <option value="DISABLED">Disabled</option>
                  </select>
                </label>

                <div className="compare-actions">
                  <button className="blip-button secondary" type="button" onClick={openTargetsModal}>
                    <Plus size={18} aria-hidden="true" />
                    {targetCount ? `Destinos (${targetCount})` : "Adicionar destinos"}
                  </button>
                  <button className="blip-submit-button primary" type="submit" disabled={isComparingTemplates}>
                    {isComparingTemplates ? (
                      <LoaderCircle className="spin" size={18} aria-hidden="true" />
                    ) : (
                      <Search size={18} aria-hidden="true" />
                    )}
                    Comparar
                  </button>
                </div>
              </form>

              <div className="compare-summary">
                {templateCompareResult ? (
                  <>
                    <span>{templateCompareResult.totals.routers} routers comparados, incluindo a origem</span>
                    <div className="compare-summary-actions">
                      <strong>{templateCompareResult.totals.commonTemplates} templates em comum</strong>
                      <button
                        className="blip-button secondary"
                        type="button"
                        onClick={() => handleCopyJson(
                          displayedCompareTemplates.map(template => template.name),
                          "Lista de nomes copiada."
                        )}
                        disabled={displayedCompareTemplates.length === 0}
                      >
                        <Clipboard size={18} aria-hidden="true" />
                        Copiar lista
                      </button>
                    </div>
                  </>
                ) : (
                  <span>Configure os filtros e execute a comparação.</span>
                )}
              </div>

              <div className="ember-table-wrap compare-table-wrap">
                <table className="ember-table compare-table">
                  <thead>
                    <tr>
                      <th>
                        <button
                          className="sort-header-button"
                          type="button"
                          onClick={() => setTemplateCompareNameSort(current => (current === "asc" ? "desc" : "asc"))}
                        >
                          Nome
                          {templateCompareNameSort === "asc" ? (
                            <ArrowDownAZ size={16} aria-hidden="true" />
                          ) : (
                            <ArrowDownZA size={16} aria-hidden="true" />
                          )}
                        </button>
                      </th>
                      <th>Idioma</th>
                      <th>Tipo</th>
                      <th>Status</th>
                      <th>Routers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!templateCompareResult || displayedCompareTemplates.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="empty-cell">
                          Nenhum template comum encontrado
                        </td>
                      </tr>
                    ) : (
                      displayedCompareTemplates.map(template => (
                        <tr key={`${template.name}|${template.language}`}>
                          <td className="template-name">{template.name}</td>
                          <td>{template.language}</td>
                          <td>{template.category || "-"}</td>
                          <td>
                            <span className={`ember-status ${String(template.status || "").toLowerCase()}`}>
                              {template.status || "N/D"}
                            </span>
                          </td>
                          <td>{template.routers.length}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {isCreateFlowModalOpen && (
          <div className="ember-modal-backdrop" role="presentation">
            <section
              className="ember-modal create-flow-modal"
              aria-labelledby="create-flow-modal-title"
              role="dialog"
              aria-modal="true"
            >
              <div className="ember-modal-header">
                <div>
                  <h2 id="create-flow-modal-title">Criar flow agora</h2>
                  <p>Cria o flow no router de origem e envia o JSON completo sem publicar.</p>
                </div>
                <button
                  className="blip-button secondary icon-only"
                  type="button"
                  onClick={() => setIsCreateFlowModalOpen(false)}
                >
                  <X size={18} aria-hidden="true" />
                  <span>Fechar</span>
                </button>
              </div>

              <div className="ember-modal-body">
                {error && (
                  <div className="ember-alert danger modal-alert" role="alert">
                    <AlertCircle size={18} aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                )}

                <label className="blip-native-field" htmlFor="newFlowName">
                  Nome do flow
                  <input
                    id="newFlowName"
                    value={newFlowName}
                    onChange={event => setNewFlowName(event.target.value)}
                    placeholder="Nome do novo flow"
                  />
                </label>

                <label className="native-check create-flow-check">
                  <input
                    type="checkbox"
                    checked={newFlowIsApi}
                    onChange={event => setNewFlowIsApi(event.target.checked)}
                  />
                  É Flow API
                </label>

                <label className="blip-native-field" htmlFor="newFlowEndpointUri">
                  endpoint_uri
                  <input
                    id="newFlowEndpointUri"
                    value={newFlowEndpointUri}
                    onChange={event => setNewFlowEndpointUri(event.target.value)}
                    disabled={!newFlowIsApi}
                    placeholder="https://..."
                  />
                </label>

                <label className="blip-native-field json-field" htmlFor="newFlowJson">
                  JSON completo
                  <textarea
                    id="newFlowJson"
                    value={newFlowJson}
                    onChange={event => setNewFlowJson(event.target.value)}
                    rows={14}
                    placeholder='{"version":"7.3","screens":[]}'
                  />
                </label>
              </div>

              <div className="ember-modal-footer">
                <button
                  className="blip-button secondary"
                  type="button"
                  onClick={() => setIsCreateFlowModalOpen(false)}
                >
                  Cancelar
                </button>
                <button
                  className="blip-submit-button primary"
                  type="button"
                  onClick={handleCreateFlow}
                  disabled={isCreatingFlow}
                >
                  {isCreatingFlow ? (
                    <LoaderCircle className="spin" size={18} aria-hidden="true" />
                  ) : (
                    <Plus size={18} aria-hidden="true" />
                  )}
                  Criar flow
                </button>
              </div>
            </section>
          </div>
        )}

        {routerModal && (
          <div className="ember-modal-backdrop" role="presentation">
            <section
              className="ember-modal router-modal"
              aria-labelledby="router-modal-title"
              role="dialog"
              aria-modal="true"
            >
              <div className="ember-modal-header">
                <div>
                  <h2 id="router-modal-title">
                    {routerModal === "source" ? "Router de origem" : "Routers de destino"}
                  </h2>
                  <p>
                    {routerModal === "source"
                      ? "Informe a key que será usada para buscar templates e flows."
                      : "Informe uma ou mais keys de destino, uma por linha."}
                  </p>
                </div>
                <button className="blip-button secondary icon-only" type="button" onClick={closeRouterModal}>
                  <X size={18} aria-hidden="true" />
                  <span>Fechar</span>
                </button>
              </div>

              <div className="ember-modal-body">
                {routerModal === "source" ? (
                  <label className="blip-native-field textarea-field" htmlFor="sourceRouterModal">
                    Key de origem
                    <textarea
                      id="sourceRouterModal"
                      value={draftSourceRouterKey}
                      onChange={event => setDraftSourceRouterKey(event.target.value)}
                      rows={4}
                      placeholder="Key ..."
                    />
                  </label>
                ) : (
                  <label className="blip-native-field textarea-field" htmlFor="targetRoutersModal">
                    Keys de destino
                    <textarea
                      id="targetRoutersModal"
                      value={draftTargetRouterKeys}
                      onChange={event => setDraftTargetRouterKeys(event.target.value)}
                      rows={7}
                      placeholder="Uma key por linha"
                    />
                  </label>
                )}
              </div>

              <div className="ember-modal-footer">
                <button className="blip-button secondary" type="button" onClick={closeRouterModal}>
                  Cancelar
                </button>
                <button
                  className="blip-submit-button primary"
                  type="button"
                  onClick={routerModal === "source" ? saveSourceRouter : saveTargetRouters}
                >
                  Salvar
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
