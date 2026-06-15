import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
  Moon,
  Pencil,
  Plus,
  Search,
  Send,
  Square,
  Sun,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useIframeAutoHeight } from "../hooks/useIframeAutoHeight";
import { COMMAND_METHODS } from "../lib/blipActions";
import {
  getAccount,
  getCurrentApplication,
  sendBlipCommand,
  showBlipAlert,
} from "../lib/blipProxy";
import "../styles/blip-app.css";

type ActiveView = "templates" | "flows" | "devs";
type DevsTab = "commands" | "plugins";
type RouterModal = "source" | "targets" | null;
type SortDirection = "asc" | "desc";
type CommandDestination = "BlipService" | "MessagingHubService";
type CommandMethod = (typeof COMMAND_METHODS)[keyof typeof COMMAND_METHODS];
type DevCommandType = "" | "text/plain" | "application/json";
type DevCommandContentType = Exclude<DevCommandType, "">;
type PluginCopyMode = "add" | "replace";

type DevCommand = {
  method: CommandMethod;
  to: string;
  uri: string;
  id: string;
  type?: DevCommandContentType;
  resource?: unknown;
};

type Template = {
  name: string;
  language: string;
  category: string;
  status?: string;
  components: unknown;
};

type SearchResponse = {
  search: { templateName: string; onlyApproved: boolean };
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
  filters: { category: string; status: string };
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

type FlowSearchResponse = { total: number; flows: FlowSummary[] };
type FlowPreviewResponse = { flow: unknown; previewUrl: string; expiresAt?: string };
type FlowJsonResponse = { flowId: string; downloadUrl: string; json: unknown };
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
  flow: FlowSummary & { endpoint_uri?: string };
  createResponse: unknown;
  setJsonResponse: unknown;
};
type FlowUpdateJsonResponse = {
  flow: FlowSummary;
  setJsonResponse: unknown;
};
type FlowPublishResponse = { flowId: string; publishResponse: unknown };
type FlowBulkUpdateMatch = {
  targetIndex: number;
  sourceFlowId: string;
  sourceFlowName: string;
  flowId: string;
  flowName: string;
  status?: string;
  matchType?: "name" | "selected";
};
type FlowBulkUpdateMissing = {
  targetIndex: number;
  sourceFlowId: string;
  sourceFlowName: string;
  flowName: string;
};
type FlowBulkUpdateError = {
  step: string;
  targetIndex?: number;
  flowId?: string;
  flowName?: string;
  message: string;
};
type FlowBulkUpdateOverride = {
  targetIndex: number;
  sourceFlowId: string;
  flowId: string;
};
type FlowBulkUpdateResponse = {
  options: {
    continueOnError: boolean;
    batchSize: number;
    dryRun: boolean;
    publishAfterUpdate: boolean;
  };
  totals: {
    selectedFlows: number;
    targetRouters: number;
    matched: number;
    missing: number;
    updated: number;
    published: number;
    errors: number;
  };
  targetRouters: Array<{
    targetIndex: number;
    totalFlows: number;
    matched: number;
    missing: number;
    availableFlows: FlowSummary[];
  }>;
  matches: FlowBulkUpdateMatch[];
  missing: FlowBulkUpdateMissing[];
  updated: unknown[];
  errors: FlowBulkUpdateError[];
};
type PluginSummary = {
  id: string;
  name: string;
  url: string;
};
type PluginSearchResponse = {
  total: number;
  plugins: PluginSummary[];
  response?: unknown;
};
type PluginSaveResponse = {
  total: number;
  plugins: PluginSummary[];
  response: unknown;
};
type PluginConflict = {
  targetIndex: number;
  pluginId: string;
  pluginName: string;
  existingId: string;
  existingName: string;
};
type PluginConflictsResponse = {
  totals: {
    targetRouters: number;
    conflicts: number;
  };
  conflicts: PluginConflict[];
};
type PluginReplicateResponse = {
  totals: {
    plugins: number;
    targetRouters: number;
    copied: number;
    errors: number;
  };
  copied: unknown[];
  errors: unknown[];
};
type OperationResult = { summary: string; payload: unknown; previewFlow?: FlowSummary };
type PortalApplicationAccount = {
  shortName: string;
  name: string;
  imageUri?: string;
  template?: string;
  hasPermission?: boolean;
  tenantId?: string;
  emailOwner?: string;
};
type ResolvedRouterKey = {
  shortName: string;
  key: string;
  keyPreview: string;
};
type CurrentApplicationRouter = {
  shortName: string;
  accessKey?: string;
};

const DEFAULT_TEMPLATE_OPTIONS = {
  dryRun: false,
  continueOnError: true,
  onlyApproved: false,
  batchSize: 15,
};
const DEFAULT_FLOW_OPTIONS = { continueOnError: true, batchSize: 15 };
const DEFAULT_PLUGIN_OPTIONS = { continueOnError: true, batchSize: 15 };
const THEME_STORAGE_KEY = "create-templates-theme";
const PORTAL_COMMAND_DESTINATION = "BlipService";
const COMMAND_DESTINATIONS: CommandDestination[] = ["BlipService", "MessagingHubService"];
const DEV_COMMAND_METHODS = Object.values(COMMAND_METHODS) as CommandMethod[];
const DEV_COMMAND_TYPE_OPTIONS: Array<{ label: string; value: DevCommandType }> = [
  { label: "Sem type", value: "" },
  { label: "text", value: "text/plain" },
  { label: "json", value: "application/json" },
];
const DEFAULT_DEV_COMMAND_TO = "postmaster@portal.blip.ai";
const DEFAULT_DEV_COMMAND_URI = "/tenants/macro/users?$skip=0&$take=9999";
const PORTAL_APPLICATIONS_URI = "/tenants/macro/applications";
const ROUTER_ACCESS_COMMAND_ID = "759a6d6e-c787-4eb1-a49a-221f32a1d8aa";
const emptyTemplateSearch: SearchResponse = {
  search: { templateName: "", onlyApproved: false },
  total: 0,
  templates: [],
};
const emptyFlowSearch: FlowSearchResponse = { total: 0, flows: [] };
const emptyPluginSearch: PluginSearchResponse = { total: 0, plugins: [] };

function splitLines(value: string) {
  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
function getDevCommandTypeLabel(type: DevCommandType) {
  return DEV_COMMAND_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? "Sem type";
}
function buildDevCommandResource(type: DevCommandContentType, rawResource: string) {
  if (type === "application/json") {
    const trimmedResource = rawResource.trim();

    if (!trimmedResource) {
      return {};
    }

    try {
      return JSON.parse(trimmedResource) as unknown;
    } catch {
      throw new Error("Resource precisa ser um JSON válido.");
    }
  }

  return rawResource;
}
function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}
const DEV_ALLOWED_EMAILS = new Set(
  splitLines(import.meta.env.VITE_DEV_ALLOWED_EMAILS ?? "").map(normalizeEmail),
);
function templateKey(t: Template) {
  return `${t.name}|${t.language}`;
}
function flowKey(f: FlowSummary) {
  return String(f.id);
}
function isPublishedFlow(flow: Pick<FlowSummary, "status"> | FlowBulkUpdateMatch) {
  return String(flow.status || "").toUpperCase() === "PUBLISHED";
}
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
function pluginKey(plugin: PluginSummary) {
  return plugin.id;
}
function normalizePluginName(name: string) {
  return name.trim().toLocaleLowerCase("pt-BR");
}
function maskRouterKey(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Nenhum router configurado";
  if (!trimmed.startsWith("Key ") && trimmed.length <= 36) return trimmed;
  const normalized = trimmed.startsWith("Key ") ? trimmed.slice(4) : trimmed;
  return `Key ${normalized.slice(0, 8)}••••${normalized.slice(-8)}`;
}
function decodeBase64(value: string) {
  const binary = window.atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  return new TextDecoder().decode(bytes);
}
function encodeBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return window.btoa(binary);
}
function buildRouterKey(shortName: string, accessKey: string) {
  const decodedAccessKey = decodeBase64(accessKey);
  return `Key ${encodeBase64(`${shortName}:${decodedAccessKey}`)}`;
}
async function postJson<TResponse>(path: string, body: unknown): Promise<TResponse> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || `Erro HTTP ${response.status}`);
  return data as TResponse;
}
async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Iframes can expose Clipboard API while blocking it by permissions policy.
    }
  }

  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(ta);

  if (!copied) {
    throw new Error("Não foi possível copiar para a área de transferência.");
  }
}
function createCommandId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}
function getCommandFailureMessage(response: unknown, fallback: string) {
  if (!isRecord(response)) return fallback;
  const reason = response.reason;

  if (isRecord(reason) && typeof reason.description === "string") {
    return reason.description;
  }

  if (typeof response.message === "string") return response.message;
  return fallback;
}
function extractCommandResource(response: unknown) {
  if (isRecord(response) && response.status === "failure") {
    throw new Error(
      getCommandFailureMessage(response, "Falha ao executar command no Portal BLiP."),
    );
  }

  if (isRecord(response) && "resource" in response) {
    return response.resource;
  }

  return response;
}
function extractRouterApplications(response: unknown): PortalApplicationAccount[] {
  const resource = extractCommandResource(response);
  if (!isRecord(resource) || !Array.isArray(resource.items)) return [];

  return resource.items
    .filter((item): item is PortalApplicationAccount => {
      if (!isRecord(item)) return false;
      return (
        item.hasPermission === true &&
        item.template === "master" &&
        typeof item.shortName === "string" &&
        typeof item.name === "string"
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
}
function extractRouterKey(response: unknown, requestedShortName: string): ResolvedRouterKey {
  const resource = extractCommandResource(response);

  if (!isRecord(resource)) {
    throw new Error(`Resposta inválida ao carregar a key do router ${requestedShortName}.`);
  }

  const shortName =
    typeof resource.shortName === "string" && resource.shortName.trim()
      ? resource.shortName.trim()
      : requestedShortName;
  const accessKey = typeof resource.accessKey === "string" ? resource.accessKey.trim() : "";

  if (!accessKey) {
    throw new Error(`Router ${shortName} não retornou accessKey.`);
  }

  try {
    const key = buildRouterKey(shortName, accessKey);

    return {
      shortName,
      key,
      keyPreview: maskRouterKey(key),
    };
  } catch {
    throw new Error(`Não foi possível gerar a key do router ${shortName}.`);
  }
}
async function loadRouterKey(shortName: string) {
  const command = {
    method: COMMAND_METHODS.GET,
    to: DEFAULT_DEV_COMMAND_TO,
    uri: `/applications/${shortName}@msging.net`,
    id: ROUTER_ACCESS_COMMAND_ID,
  } as const;
  const response = await sendBlipCommand(command, {
    destination: PORTAL_COMMAND_DESTINATION,
    timeout: 30000,
  });

  return extractRouterKey(response, shortName);
}
function extractCurrentApplicationRouter(response: unknown): CurrentApplicationRouter | null {
  const resource = isRecord(response) && "response" in response ? response.response : response;

  if (!isRecord(resource) || typeof resource.shortName !== "string") {
    return null;
  }

  const accessKey = typeof resource.accessKey === "string" ? resource.accessKey.trim() : "";

  return {
    shortName: resource.shortName.trim(),
    accessKey: accessKey || undefined,
  };
}

export default function CreateTemplatesApp() {
  const shellRef = useRef<HTMLElement | null>(null);
  const didLoadCurrentApplicationRef = useRef(false);
  const didVerifyDevAccessRef = useRef(false);
  const [isDarkTheme, setIsDarkTheme] = useState(true);
  const [activeView, setActiveView] = useState<ActiveView>("templates");
  const [devsTab, setDevsTab] = useState<DevsTab>("commands");
  const [sourceRouterKey, setSourceRouterKey] = useState("");
  const [sourceRouterShortName, setSourceRouterShortName] = useState("");
  const [targetRouterKeys, setTargetRouterKeys] = useState("");
  const [targetRouterShortNames, setTargetRouterShortNames] = useState<string[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [templateSearchResult, setTemplateSearchResult] =
    useState<SearchResponse>(emptyTemplateSearch);
  const [selectedTemplateKeys, setSelectedTemplateKeys] = useState<Set<string>>(new Set());
  const [flowSearchResult, setFlowSearchResult] = useState<FlowSearchResponse>(emptyFlowSearch);
  const [flowFilter, setFlowFilter] = useState("");
  const [selectedFlowIds, setSelectedFlowIds] = useState<Set<string>>(new Set());
  const [pluginSearchResult, setPluginSearchResult] =
    useState<PluginSearchResponse>(emptyPluginSearch);
  const [pluginFilter, setPluginFilter] = useState("");
  const [selectedPluginIds, setSelectedPluginIds] = useState<Set<string>>(new Set());
  const [pluginsLoaded, setPluginsLoaded] = useState(false);
  const [routerModal, setRouterModal] = useState<RouterModal>(null);
  const [isTemplateCompareModalOpen, setIsTemplateCompareModalOpen] = useState(false);
  const [templateCompareCategory, setTemplateCompareCategory] = useState("");
  const [templateCompareStatus, setTemplateCompareStatus] = useState("");
  const [templateCompareResult, setTemplateCompareResult] =
    useState<TemplateCompareResponse | null>(null);
  const [templateCompareNameSort, setTemplateCompareNameSort] = useState<SortDirection>("asc");
  const [isCreateFlowModalOpen, setIsCreateFlowModalOpen] = useState(false);
  const [isEditFlowModalOpen, setIsEditFlowModalOpen] = useState(false);
  const [isBulkFlowMappingModalOpen, setIsBulkFlowMappingModalOpen] = useState(false);
  const [editingFlow, setEditingFlow] = useState<FlowSummary | null>(null);
  const [draftSourceRouterKey, setDraftSourceRouterKey] = useState("");
  const [draftTargetRouterKeys, setDraftTargetRouterKeys] = useState("");
  const [routerApplications, setRouterApplications] = useState<PortalApplicationAccount[]>([]);
  const [routerApplicationsError, setRouterApplicationsError] = useState("");
  const [routerApplicationSearch, setRouterApplicationSearch] = useState("");
  const [isLoadingRouterApplications, setIsLoadingRouterApplications] = useState(false);
  const [currentApplicationRouter, setCurrentApplicationRouter] =
    useState<CurrentApplicationRouter | null>(null);
  const [newFlowName, setNewFlowName] = useState("");
  const [newFlowIsApi, setNewFlowIsApi] = useState(false);
  const [newFlowEndpointUri, setNewFlowEndpointUri] = useState("");
  const [newFlowJson, setNewFlowJson] = useState("");
  const [editFlowJson, setEditFlowJson] = useState("");
  const [editFlowPublishAfterSave, setEditFlowPublishAfterSave] = useState(false);
  const [bulkFlowPreflight, setBulkFlowPreflight] = useState<FlowBulkUpdateResponse | null>(null);
  const [bulkFlowSelections, setBulkFlowSelections] = useState<Record<string, string>>({});
  const [pluginDraftId, setPluginDraftId] = useState("");
  const [pluginDraftName, setPluginDraftName] = useState("");
  const [pluginDraftUrl, setPluginDraftUrl] = useState("");
  const [editingPluginId, setEditingPluginId] = useState<string | null>(null);
  const [pluginCopyMode, setPluginCopyMode] = useState<PluginCopyMode>("add");
  const [operationResult, setOperationResult] = useState<OperationResult | null>(null);
  const [error, setError] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const [isSearchingTemplates, setIsSearchingTemplates] = useState(false);
  const [isReplicatingTemplates, setIsReplicatingTemplates] = useState(false);
  const [isComparingTemplates, setIsComparingTemplates] = useState(false);
  const [isLoadingFlows, setIsLoadingFlows] = useState(false);
  const [isReplicatingFlows, setIsReplicatingFlows] = useState(false);
  const [isCreatingFlow, setIsCreatingFlow] = useState(false);
  const [isLoadingEditFlowJson, setIsLoadingEditFlowJson] = useState(false);
  const [isUpdatingFlow, setIsUpdatingFlow] = useState(false);
  const [isBulkUpdatingFlows, setIsBulkUpdatingFlows] = useState(false);
  const [flowActionId, setFlowActionId] = useState("");
  const [isLoadingPlugins, setIsLoadingPlugins] = useState(false);
  const [isSavingPlugin, setIsSavingPlugin] = useState(false);
  const [isCopyingPlugins, setIsCopyingPlugins] = useState(false);
  const [pluginActionId, setPluginActionId] = useState("");
  const [devCommandDestination, setDevCommandDestination] =
    useState<CommandDestination>("BlipService");
  const [devCommandMethod, setDevCommandMethod] = useState<CommandMethod>(COMMAND_METHODS.GET);
  const [devCommandType, setDevCommandType] = useState<DevCommandType>("");
  const [devCommandResource, setDevCommandResource] = useState("");
  const [devCommandTo, setDevCommandTo] = useState(DEFAULT_DEV_COMMAND_TO);
  const [devCommandUri, setDevCommandUri] = useState(DEFAULT_DEV_COMMAND_URI);
  const [isRunningDevCommand, setIsRunningDevCommand] = useState(false);
  const [isLoadingCurrentApplication, setIsLoadingCurrentApplication] = useState(false);
  const [canAccessDevs, setCanAccessDevs] = useState(false);

  const isEmbedded = useIframeAutoHeight(shellRef);
  const visibleActiveView = activeView === "devs" && !canAccessDevs ? "templates" : activeView;

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === "light") {
      setIsDarkTheme(false);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, isDarkTheme ? "dark" : "light");
  }, [isDarkTheme]);

  useEffect(() => {
    if (!isEmbedded || didVerifyDevAccessRef.current) return;

    didVerifyDevAccessRef.current = true;
    let cancelled = false;

    async function verifyDevAccess() {
      try {
        const account = await getAccount();
        if (cancelled) return;

        setCanAccessDevs(DEV_ALLOWED_EMAILS.has(normalizeEmail(account.email || "")));
      } catch {
        if (!cancelled) setCanAccessDevs(false);
      }
    }

    void verifyDevAccess();

    return () => {
      cancelled = true;
    };
  }, [isEmbedded]);

  useEffect(() => {
    if (activeView === "devs" && !canAccessDevs) {
      setActiveView("templates");
    }
  }, [activeView, canAccessDevs]);

  useEffect(() => {
    if (!isEmbedded || didLoadCurrentApplicationRef.current) return;

    didLoadCurrentApplicationRef.current = true;
    let cancelled = false;

    async function loadCurrentApplication() {
      setIsLoadingCurrentApplication(true);

      try {
        const response = await getCurrentApplication();
        if (cancelled) return;

        const router = extractCurrentApplicationRouter(response);

        setCurrentApplicationRouter(router);
        if (router?.shortName) {
          setSourceRouterShortName((current) => current || router.shortName);
          setSourceRouterKey((current) => current);
        }
        setOperationResult({
          summary: "getApplication carregado.",
          payload: {
            action: "getApplication",
            response,
          },
        });
      } catch (caughtError) {
        if (cancelled) return;

        const message =
          caughtError instanceof Error ? caughtError.message : "Erro ao executar getApplication.";

        setOperationResult({
          summary: "Falha ao carregar getApplication.",
          payload: {
            action: "getApplication",
            error: { message },
          },
        });
      } finally {
        if (!cancelled) setIsLoadingCurrentApplication(false);
      }
    }

    void loadCurrentApplication();

    return () => {
      cancelled = true;
    };
  }, [isEmbedded]);

  const targetCount = isEmbedded
    ? targetRouterShortNames.length
    : splitLines(targetRouterKeys).length;
  const draftTargetRouterSet = useMemo(
    () => new Set(splitLines(draftTargetRouterKeys)),
    [draftTargetRouterKeys],
  );

  const selectedTemplates = useMemo(
    () => templateSearchResult.templates.filter((t) => selectedTemplateKeys.has(templateKey(t))),
    [templateSearchResult.templates, selectedTemplateKeys],
  );
  const allVisibleTemplatesSelected =
    templateSearchResult.templates.length > 0 &&
    selectedTemplates.length === templateSearchResult.templates.length;

  const displayedCompareTemplates = useMemo(() => {
    const templates = templateCompareResult?.commonTemplates ?? [];
    return [...templates].sort((a, b) => {
      const n = a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
      const l = a.language.localeCompare(b.language, "pt-BR", { sensitivity: "base" });
      const r = n || l;
      return templateCompareNameSort === "asc" ? r : -r;
    });
  }, [templateCompareNameSort, templateCompareResult]);

  const filteredFlows = useMemo(() => {
    const q = flowFilter.trim().toLowerCase();
    if (!q) return flowSearchResult.flows;
    return flowSearchResult.flows.filter(
      (f) => f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q),
    );
  }, [flowFilter, flowSearchResult.flows]);

  const selectedFlows = useMemo(
    () => flowSearchResult.flows.filter((f) => selectedFlowIds.has(flowKey(f))),
    [flowSearchResult.flows, selectedFlowIds],
  );
  const allVisibleFlowsSelected =
    filteredFlows.length > 0 && filteredFlows.every((f) => selectedFlowIds.has(flowKey(f)));

  const filteredPlugins = useMemo(() => {
    const q = pluginFilter.trim().toLowerCase();
    if (!q) return pluginSearchResult.plugins;

    return pluginSearchResult.plugins.filter(
      (plugin) =>
        plugin.name.toLowerCase().includes(q) ||
        plugin.id.toLowerCase().includes(q) ||
        plugin.url.toLowerCase().includes(q),
    );
  }, [pluginFilter, pluginSearchResult.plugins]);

  const selectedPlugins = useMemo(
    () => pluginSearchResult.plugins.filter((plugin) => selectedPluginIds.has(pluginKey(plugin))),
    [pluginSearchResult.plugins, selectedPluginIds],
  );
  const allVisiblePluginsSelected =
    filteredPlugins.length > 0 &&
    filteredPlugins.every((plugin) => selectedPluginIds.has(pluginKey(plugin)));

  const filteredRouterApplications = useMemo(() => {
    const q = routerApplicationSearch.trim().toLowerCase();
    if (!q) return routerApplications;

    return routerApplications.filter(
      (application) =>
        application.name.toLowerCase().includes(q) ||
        application.shortName.toLowerCase().includes(q),
    );
  }, [routerApplicationSearch, routerApplications]);

  const headerCopy =
    visibleActiveView === "templates"
      ? {
          kicker: "WhatsApp Templates",
          title: "Templates",
          description: "Replicação de templates entre routers BLiP",
        }
      : visibleActiveView === "flows"
        ? {
            kicker: "WhatsApp Flows",
            title: "Flows",
            description: "Consulta, visualização e cópia de flows entre routers BLiP",
          }
        : devsTab === "plugins"
          ? {
              kicker: "Plugins Manager",
              title: "Devs",
              description: "Gerenciamento e cópia de plugins entre routers BLiP",
            }
          : {
              kicker: "Command Lab",
              title: "Devs",
              description: "Testes de commands no iframe do Portal BLiP",
            };

  async function loadRouterApplications() {
    if (!isEmbedded) return;

    setIsLoadingRouterApplications(true);
    setRouterApplicationsError("");

    const command = {
      method: COMMAND_METHODS.GET,
      to: DEFAULT_DEV_COMMAND_TO,
      uri: PORTAL_APPLICATIONS_URI,
      id: createCommandId(),
    } as const;

    try {
      const response = await sendBlipCommand(command, {
        destination: PORTAL_COMMAND_DESTINATION,
        timeout: 30000,
      });
      const applications = extractRouterApplications(response);

      setRouterApplications(applications);
      if (applications.length === 0) {
        setRouterApplicationsError("Nenhum router master com permissão encontrado.");
      }
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Erro ao carregar routers.";

      setRouterApplications([]);
      setRouterApplicationsError(message);
    } finally {
      setIsLoadingRouterApplications(false);
    }
  }

  function hasSourceRouterSelection() {
    return isEmbedded
      ? Boolean(sourceRouterShortName || sourceRouterKey.trim())
      : Boolean(sourceRouterKey.trim());
  }

  function hasTargetRouterSelection() {
    return isEmbedded
      ? targetRouterShortNames.length > 0 || splitLines(targetRouterKeys).length > 0
      : splitLines(targetRouterKeys).length > 0;
  }

  async function ensureSourceRouterKey() {
    const cachedKey = sourceRouterKey.trim();
    if (!isEmbedded) return cachedKey;
    if (cachedKey) return cachedKey;
    if (!sourceRouterShortName) return "";

    if (
      currentApplicationRouter?.shortName === sourceRouterShortName &&
      currentApplicationRouter.accessKey
    ) {
      const key = buildRouterKey(sourceRouterShortName, currentApplicationRouter.accessKey);

      setSourceRouterKey(key);
      return key;
    }

    const router = await loadRouterKey(sourceRouterShortName);

    setSourceRouterKey(router.key);
    setSourceRouterShortName(router.shortName);

    return router.key;
  }

  async function ensureTargetRouterKeys() {
    const cachedKeys = splitLines(targetRouterKeys);

    if (!isEmbedded) return cachedKeys;
    if (cachedKeys.length > 0) return cachedKeys;
    if (targetRouterShortNames.length === 0) return [];

    const routers: ResolvedRouterKey[] = [];

    for (const shortName of targetRouterShortNames) {
      routers.push(await loadRouterKey(shortName));
    }

    const keys = routers.map((router) => router.key);

    setTargetRouterKeys(keys.join("\n"));
    setTargetRouterShortNames(routers.map((router) => router.shortName));

    return keys;
  }

  function getTargetRouterLabel(targetIndex: number) {
    const shortName = targetRouterShortNames[targetIndex]?.trim();
    return shortName || `Destino ${targetIndex + 1}`;
  }

  function buildBulkFlowIssueList(
    issues: Array<{
      targetIndex?: number;
      flowName?: string;
      sourceFlowName?: string;
      message?: string;
    }>,
    limit = 8,
  ) {
    const visibleIssues = issues.slice(0, limit);
    const items = visibleIssues
      .map((issue) => {
        const targetLabel =
          typeof issue.targetIndex === "number"
            ? getTargetRouterLabel(issue.targetIndex)
            : "Destino";
        const flowName = issue.flowName || issue.sourceFlowName;
        const detail = flowName ? flowName : issue.message || "Falha ao verificar destino";

        return `<li><b>${escapeHtml(targetLabel)}</b>: ${escapeHtml(detail)}</li>`;
      })
      .join("");
    const hiddenCount = issues.length - visibleIssues.length;

    return `<ul>${items}${
      hiddenCount > 0 ? `<li>+${hiddenCount} ocorrências adicionais</li>` : ""
    }</ul>`;
  }

  async function confirmFlowAction(title: string, body: string, confirm = "Confirmar") {
    try {
      return await showBlipAlert({
        variant: "warning",
        icon: "warning",
        title,
        body,
        buttons: {
          cancel: "Cancelar",
          confirm,
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao exibir confirmação.");
      return false;
    }
  }

  async function handleSearchTemplates(event: FormEvent) {
    event.preventDefault();
    setError("");
    setOperationResult(null);
    if (!hasSourceRouterSelection()) {
      setError("Informe o router de origem.");
      openSourceModal();
      return;
    }
    setIsSearchingTemplates(true);
    try {
      const sourceKey = await ensureSourceRouterKey();
      const data = await postJson<SearchResponse>("/api/templates/search", {
        sourceRouterKey: sourceKey,
        templateName: templateName.trim(),
        onlyApproved: DEFAULT_TEMPLATE_OPTIONS.onlyApproved,
      });
      setTemplateSearchResult(data);
      setSelectedTemplateKeys(
        data.templates.length === 1 ? new Set([templateKey(data.templates[0])]) : new Set(),
      );
    } catch (e) {
      setTemplateSearchResult(emptyTemplateSearch);
      setSelectedTemplateKeys(new Set());
      setError(e instanceof Error ? e.message : "Erro ao buscar templates.");
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
    if (!hasTargetRouterSelection()) {
      setError("Informe pelo menos um router de destino.");
      openTargetsModal();
      return;
    }
    setIsReplicatingTemplates(true);
    try {
      const targets = await ensureTargetRouterKeys();
      const data = await postJson<TemplateReplicateResponse>("/api/templates/replicate", {
        targetRouterKeys: targets,
        templates: selectedTemplates,
        ...DEFAULT_TEMPLATE_OPTIONS,
      });
      setOperationResult({
        summary: `${data.totals.created} criações, ${data.totals.uploadedAttachments} imagens, ${data.totals.errors} erros`,
        payload: data,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao replicar templates.");
    } finally {
      setIsReplicatingTemplates(false);
    }
  }

  async function handleCompareTemplates(event?: FormEvent) {
    event?.preventDefault();
    setError("");
    if (!hasSourceRouterSelection()) {
      setError("Informe o router de origem para comparar.");
      openSourceModal();
      return;
    }
    if (!hasTargetRouterSelection()) {
      setError("Informe pelo menos um router de destino para comparar com a origem.");
      openTargetsModal();
      return;
    }
    setIsComparingTemplates(true);
    try {
      const sourceKey = await ensureSourceRouterKey();
      const routers = await ensureTargetRouterKeys();
      const data = await postJson<TemplateCompareResponse>("/api/templates/compare", {
        sourceRouterKey: sourceKey,
        targetRouterKeys: routers,
        category: templateCompareCategory,
        status: templateCompareStatus,
      });
      setTemplateCompareResult(data);
      setOperationResult({
        summary: `${data.totals.commonTemplates} templates em comum em ${data.totals.routers} routers.`,
        payload: data,
      });
    } catch (e) {
      setTemplateCompareResult(null);
      setError(e instanceof Error ? e.message : "Erro ao comparar templates.");
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
    } catch (e) {
      setCopyNotice("");
      setError(e instanceof Error ? e.message : "Erro ao copiar JSON.");
    }
  }

  async function handleLoadFlows(event?: FormEvent) {
    event?.preventDefault();
    setError("");
    setOperationResult(null);
    if (!hasSourceRouterSelection()) {
      setError("Informe o router de origem.");
      openSourceModal();
      return;
    }
    setIsLoadingFlows(true);
    try {
      await loadFlowsFromSource();
    } catch (e) {
      setFlowSearchResult(emptyFlowSearch);
      setSelectedFlowIds(new Set());
      setError(e instanceof Error ? e.message : "Erro ao carregar flows.");
    } finally {
      setIsLoadingFlows(false);
    }
  }

  async function loadFlowsFromSource(sourceKey?: string) {
    const resolvedSourceKey = sourceKey ?? (await ensureSourceRouterKey());
    const data = await postJson<FlowSearchResponse>("/api/flows/search", {
      sourceRouterKey: resolvedSourceKey,
    });
    setFlowSearchResult(data);
    setSelectedFlowIds(data.flows.length === 1 ? new Set([flowKey(data.flows[0])]) : new Set());
    return data;
  }

  async function handlePreviewFlow(flow: FlowSummary) {
    setError("");
    setFlowActionId(`preview:${flow.id}`);
    try {
      const sourceKey = await ensureSourceRouterKey();
      const data = await postJson<FlowPreviewResponse>("/api/flows/preview", {
        sourceRouterKey: sourceKey,
        flowId: flow.id,
      });
      window.open(data.previewUrl, "_blank", "noopener,noreferrer");
      setOperationResult({ summary: `Preview aberto para "${flow.name}".`, payload: data });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao abrir preview do flow.");
    } finally {
      setFlowActionId("");
    }
  }

  async function handleCopyFlowJson(flow: FlowSummary) {
    setError("");
    setFlowActionId(`json:${flow.id}`);
    try {
      const sourceKey = await ensureSourceRouterKey();
      const data = await postJson<FlowJsonResponse>("/api/flows/json", {
        sourceRouterKey: sourceKey,
        flowId: flow.id,
      });
      await copyText(JSON.stringify(data.json, null, 2));
      setOperationResult({ summary: `JSON copiado para "${flow.name}".`, payload: data });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao copiar JSON do flow.");
    } finally {
      setFlowActionId("");
    }
  }

  async function handleOpenEditFlow(flow: FlowSummary) {
    setError("");
    setCopyNotice("");
    setEditingFlow(flow);
    setEditFlowJson("");
    setEditFlowPublishAfterSave(false);
    setIsEditFlowModalOpen(true);
    setIsLoadingEditFlowJson(true);
    setFlowActionId(`edit:${flow.id}`);

    try {
      const sourceKey = await ensureSourceRouterKey();
      const data = await postJson<FlowJsonResponse>("/api/flows/json", {
        sourceRouterKey: sourceKey,
        flowId: flow.id,
      });

      setEditFlowJson(JSON.stringify(data.json, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar JSON do flow.");
    } finally {
      setIsLoadingEditFlowJson(false);
      setFlowActionId("");
    }
  }

  function closeEditFlowModal(options: { force?: boolean } = {}) {
    if ((isUpdatingFlow || isBulkUpdatingFlows) && !options.force) return;

    setIsEditFlowModalOpen(false);
    setEditingFlow(null);
    setEditFlowJson("");
    setEditFlowPublishAfterSave(false);
    setIsBulkFlowMappingModalOpen(false);
    setBulkFlowPreflight(null);
    setBulkFlowSelections({});
    setIsLoadingEditFlowJson(false);
    setError("");
  }

  async function handleSaveEditedFlow() {
    if (!editingFlow) return;

    setError("");

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(editFlowJson);
    } catch {
      setError("Informe um JSON completo válido.");
      return;
    }

    const publishAfterUpdate = editFlowPublishAfterSave;
    if (publishAfterUpdate) {
      const confirmed = await confirmFlowAction(
        "Confirmar alteração e publicação",
        "Ao prosseguir, o flow será atualizado e publicado em seguida.",
        "Alterar e publicar",
      );

      if (!confirmed) return;
    } else if (isPublishedFlow(editingFlow)) {
      const confirmed = await confirmFlowAction(
        "Confirmar atualização",
        "Ao prosseguir, o flow publicado será atualizado e voltará ao estado <b>DRAFT</b>.",
      );

      if (!confirmed) return;
    }

    setIsUpdatingFlow(true);
    setFlowActionId(`update:${editingFlow.id}`);
    try {
      const sourceKey = await ensureSourceRouterKey();
      const data = await postJson<FlowUpdateJsonResponse>("/api/flows/update-json", {
        sourceRouterKey: sourceKey,
        flowId: editingFlow.id,
        flowJson: parsedJson,
      });
      const publishData = publishAfterUpdate
        ? await postJson<FlowPublishResponse>("/api/flows/publish", {
            sourceRouterKey: sourceKey,
            flowId: editingFlow.id,
          })
        : null;
      const nextStatus = publishAfterUpdate ? "PUBLISHED" : "DRAFT";

      if (publishAfterUpdate) {
        await loadFlowsFromSource(sourceKey);
      } else {
        setFlowSearchResult((current) => ({
          ...current,
          flows: current.flows.map((flow) =>
            flow.id === editingFlow.id ? { ...flow, status: nextStatus } : flow,
          ),
        }));
      }
      setOperationResult({
        summary: publishAfterUpdate
          ? `Flow "${editingFlow.name}" atualizado e publicado.`
          : isPublishedFlow(editingFlow)
            ? `Flow "${editingFlow.name}" atualizado e retornou para draft.`
            : `Flow "${editingFlow.name}" atualizado em draft.`,
        payload: { update: data, publish: publishData },
        previewFlow: { ...editingFlow, status: nextStatus },
      });
      closeEditFlowModal({ force: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao atualizar flow.");
    } finally {
      setIsUpdatingFlow(false);
      setFlowActionId("");
    }
  }

  async function confirmBulkFlowUpdate(preflight: FlowBulkUpdateResponse) {
    const missingFlows = preflight.missing;
    const targetErrors = preflight.errors.filter((item) => item.step === "load_target_flows");
    const publishedMatches = [
      ...(editingFlow && isPublishedFlow(editingFlow) ? [editingFlow] : []),
      ...preflight.matches.filter(isPublishedFlow),
    ];
    const issueSections: string[] = [];

    if (missingFlows.length > 0) {
      issueSections.push(
        `<p>Alguns flows não foram encontrados nos routers de destino:</p>${buildBulkFlowIssueList(
          missingFlows,
        )}`,
      );
    }

    if (targetErrors.length > 0) {
      issueSections.push(
        `<p>Alguns routers de destino não puderam ser verificados:</p>${buildBulkFlowIssueList(
          targetErrors,
        )}`,
      );
    }

    if (editFlowPublishAfterSave) {
      return confirmFlowAction(
        "Confirmar alteração e publicação em massa",
        `<p>O flow atual e os flows encontrados nos routers de destino serão atualizados e publicados em seguida.</p>${issueSections.join(
          "",
        )}`,
        "Alterar e publicar",
      );
    }

    if (publishedMatches.length > 0) {
      return confirmFlowAction(
        "Confirmar atualização em massa",
        `<p>Os flows publicados serão atualizados e voltarão ao estado <b>DRAFT</b>.</p>${issueSections.join(
          "",
        )}`,
        "Alterar flows",
      );
    }

    if (issueSections.length > 0) {
      return confirmFlowAction(
        "Flows não encontrados",
        `${issueSections.join("")}<p>A alteração será aplicada no flow atual e nos destinos encontrados.</p>`,
        "Alterar encontrados",
      );
    }

    return true;
  }

  function closeBulkFlowMappingModal(options: { force?: boolean } = {}) {
    if (isBulkUpdatingFlows && !options.force) return;

    setIsBulkFlowMappingModalOpen(false);
    setBulkFlowPreflight(null);
    setBulkFlowSelections({});
    setError("");
  }

  function buildBulkFlowOverrides(): FlowBulkUpdateOverride[] {
    if (!editingFlow || !bulkFlowPreflight) return [];

    const missingTargetIndexes = new Set(
      bulkFlowPreflight.missing
        .filter((missing) => missing.sourceFlowId === editingFlow.id)
        .map((missing) => String(missing.targetIndex)),
    );

    return Object.entries(bulkFlowSelections)
      .filter(([targetIndex, flowId]) => missingTargetIndexes.has(targetIndex) && flowId)
      .map(([targetIndex, flowId]) => ({
        targetIndex: Number(targetIndex),
        sourceFlowId: editingFlow.id,
        flowId,
      }));
  }

  async function handleOpenBulkFlowMappingModal() {
    if (!editingFlow) return;

    setError("");
    setOperationResult(null);

    if (!hasTargetRouterSelection()) {
      setError("Informe pelo menos um router de destino.");
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(editFlowJson);
    } catch {
      setError("Informe um JSON completo válido.");
      return;
    }

    setIsBulkUpdatingFlows(true);
    setFlowActionId("bulk-update");

    try {
      const targets = await ensureTargetRouterKeys();
      const preflight = await postJson<FlowBulkUpdateResponse>("/api/flows/bulk-update-json", {
        targetRouterKeys: targets,
        flows: [editingFlow],
        flowJson: parsedJson,
        publishAfterUpdate: editFlowPublishAfterSave,
        ...DEFAULT_FLOW_OPTIONS,
        dryRun: true,
      });

      setBulkFlowPreflight(preflight);
      setBulkFlowSelections({});
      setIsBulkFlowMappingModalOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao verificar flows nos destinos.");
    } finally {
      setIsBulkUpdatingFlows(false);
      setFlowActionId("");
    }
  }

  async function handleConfirmBulkFlowMapping() {
    if (!editingFlow || !bulkFlowPreflight) return;

    setError("");

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(editFlowJson);
    } catch {
      setError("Informe um JSON completo válido.");
      return;
    }

    setIsBulkUpdatingFlows(true);
    setFlowActionId("bulk-update");

    try {
      const targets = await ensureTargetRouterKeys();
      const publishAfterUpdate = editFlowPublishAfterSave;
      const targetFlowOverrides = buildBulkFlowOverrides();
      const requestBody = {
        targetRouterKeys: targets,
        flows: [editingFlow],
        flowJson: parsedJson,
        publishAfterUpdate,
        targetFlowOverrides,
        ...DEFAULT_FLOW_OPTIONS,
      };
      const effectivePreflight =
        targetFlowOverrides.length > 0
          ? await postJson<FlowBulkUpdateResponse>("/api/flows/bulk-update-json", {
              ...requestBody,
              dryRun: true,
            })
          : bulkFlowPreflight;

      const confirmed = await confirmBulkFlowUpdate(effectivePreflight);
      if (!confirmed) return;

      const sourceKey = await ensureSourceRouterKey();
      const sourceUpdate = await postJson<FlowUpdateJsonResponse>("/api/flows/update-json", {
        sourceRouterKey: sourceKey,
        flowId: editingFlow.id,
        flowJson: parsedJson,
      });
      const sourcePublish = publishAfterUpdate
        ? await postJson<FlowPublishResponse>("/api/flows/publish", {
            sourceRouterKey: sourceKey,
            flowId: editingFlow.id,
          })
        : null;
      const data =
        effectivePreflight.totals.matched > 0
          ? await postJson<FlowBulkUpdateResponse>("/api/flows/bulk-update-json", {
              ...requestBody,
              dryRun: false,
            })
          : {
              ...effectivePreflight,
              options: {
                ...effectivePreflight.options,
                dryRun: false,
              },
            };
      const nextStatus = publishAfterUpdate ? "PUBLISHED" : "DRAFT";
      const summary = publishAfterUpdate
        ? `Flow atual atualizado e publicado; ${data.totals.updated} destinos atualizados, ${data.totals.published} publicados, ${data.totals.missing} ausentes, ${data.totals.errors} erros.`
        : `Flow atual atualizado; ${data.totals.updated} destinos atualizados, ${data.totals.missing} ausentes, ${data.totals.errors} erros.`;

      if (publishAfterUpdate) {
        await loadFlowsFromSource(sourceKey);
      } else {
        setFlowSearchResult((current) => ({
          ...current,
          flows: current.flows.map((flow) =>
            flow.id === editingFlow.id ? { ...flow, status: nextStatus } : flow,
          ),
        }));
      }
      setOperationResult({
        summary,
        payload: {
          source: {
            update: sourceUpdate,
            publish: sourcePublish,
          },
          targets: data,
        },
        previewFlow: { ...editingFlow, status: nextStatus },
      });
      closeBulkFlowMappingModal({ force: true });
      closeEditFlowModal({ force: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao atualizar flows em massa.");
    } finally {
      setIsBulkUpdatingFlows(false);
      setFlowActionId("");
    }
  }

  async function handlePublishFlow(flow: FlowSummary) {
    setError("");
    setFlowActionId(`publish:${flow.id}`);
    try {
      const sourceKey = await ensureSourceRouterKey();
      const data = await postJson<FlowPublishResponse>("/api/flows/publish", {
        sourceRouterKey: sourceKey,
        flowId: flow.id,
      });
      await loadFlowsFromSource(sourceKey);
      setOperationResult({
        summary: `Flow "${flow.name}" publicado com sucesso.`,
        payload: data,
        previewFlow: { ...flow, status: "PUBLISHED" },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao publicar flow.");
    } finally {
      setFlowActionId("");
    }
  }

  async function handleCreateFlow() {
    setError("");
    if (!hasSourceRouterSelection()) {
      setError("Informe o router de origem.");
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
      const sourceKey = await ensureSourceRouterKey();
      const data = await postJson<FlowCreateResponse>("/api/flows/create", {
        sourceRouterKey: sourceKey,
        name: normalizedName,
        isFlowApi: newFlowIsApi,
        endpointUri: newFlowEndpointUri.trim(),
        flowJson: parsedJson,
      });
      setIsCreateFlowModalOpen(false);
      setNewFlowName("");
      setNewFlowIsApi(false);
      setNewFlowEndpointUri("");
      setNewFlowJson("");
      setFlowFilter(data.flow.name);
      await loadFlowsFromSource(sourceKey);
      setOperationResult({
        summary: `Flow criado com sucesso. ID: ${data.flow.id}`,
        payload: data,
        previewFlow: data.flow,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao criar flow.");
    } finally {
      setIsCreatingFlow(false);
    }
  }

  async function handleReplicateFlows() {
    setError("");
    setOperationResult(null);
    if (!hasSourceRouterSelection()) {
      setError("Informe o router de origem.");
      openSourceModal();
      return;
    }
    if (selectedFlows.length === 0) {
      setError("Selecione pelo menos um flow.");
      return;
    }
    if (!hasTargetRouterSelection()) {
      setError("Informe pelo menos um router de destino.");
      openTargetsModal();
      return;
    }
    setIsReplicatingFlows(true);
    try {
      const sourceKey = await ensureSourceRouterKey();
      const targets = await ensureTargetRouterKeys();
      const data = await postJson<FlowReplicateResponse>("/api/flows/replicate", {
        sourceRouterKey: sourceKey,
        targetRouterKeys: targets,
        flows: selectedFlows,
        ...DEFAULT_FLOW_OPTIONS,
      });
      setOperationResult({
        summary: `${data.totals.publicKeyUploads} public keys, ${data.totals.copied} flows copiados, ${data.totals.errors} erros`,
        payload: data,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao replicar flows.");
    } finally {
      setIsReplicatingFlows(false);
    }
  }

  async function loadPluginsFromSource(sourceKey?: string) {
    const resolvedSourceKey = sourceKey ?? (await ensureSourceRouterKey());
    const data = await postJson<PluginSearchResponse>("/api/plugins/search", {
      sourceRouterKey: resolvedSourceKey,
    });

    setPluginSearchResult(data);
    setPluginsLoaded(true);
    setSelectedPluginIds(
      data.plugins.length === 1 ? new Set([pluginKey(data.plugins[0])]) : new Set(),
    );

    return data;
  }

  async function handleLoadPlugins(event?: FormEvent) {
    event?.preventDefault();
    setError("");
    setOperationResult(null);

    if (!hasSourceRouterSelection()) {
      setError("Informe o router de origem.");
      openSourceModal();
      return;
    }

    setIsLoadingPlugins(true);
    try {
      const data = await loadPluginsFromSource();
      setOperationResult({
        summary: `${data.total} plugins carregados.`,
        payload: data,
      });
    } catch (e) {
      setPluginSearchResult(emptyPluginSearch);
      setSelectedPluginIds(new Set());
      setPluginsLoaded(false);
      setError(e instanceof Error ? e.message : "Erro ao carregar plugins.");
    } finally {
      setIsLoadingPlugins(false);
    }
  }

  function resetPluginDraft() {
    setPluginDraftId("");
    setPluginDraftName("");
    setPluginDraftUrl("");
    setEditingPluginId(null);
  }

  async function confirmPluginAction(title: string, body: string, confirm = "Confirmar") {
    try {
      return await showBlipAlert({
        variant: "warning",
        icon: "warning",
        title,
        body,
        buttons: {
          cancel: "Cancelar",
          confirm,
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao exibir confirmação.");
      return false;
    }
  }

  async function savePluginsToSource(plugins: PluginSummary[], summary: string) {
    if (!hasSourceRouterSelection()) {
      setError("Informe o router de origem.");
      openSourceModal();
      return null;
    }

    const sourceKey = await ensureSourceRouterKey();
    const data = await postJson<PluginSaveResponse>("/api/plugins/save", {
      sourceRouterKey: sourceKey,
      plugins,
    });

    setPluginSearchResult({
      total: data.total,
      plugins: data.plugins,
      response: data.response,
    });
    setPluginsLoaded(true);
    setSelectedPluginIds((current) => {
      const availableIds = new Set(data.plugins.map(pluginKey));
      return new Set([...current].filter((id) => availableIds.has(id)));
    });
    setOperationResult({
      summary,
      payload: data,
    });

    return data;
  }

  async function handleSavePlugin(event: FormEvent) {
    event.preventDefault();
    setError("");
    setOperationResult(null);

    if (!pluginsLoaded) {
      setError("Carregue os plugins do router de origem antes de alterar a lista.");
      return;
    }

    const id = (editingPluginId || pluginDraftId || createCommandId()).trim();
    const name = pluginDraftName.trim();
    const url = pluginDraftUrl.trim();

    if (!id) {
      setError("Informe o ID do plugin ou gere um automaticamente.");
      return;
    }

    if (!name) {
      setError("Informe o nome do plugin.");
      return;
    }

    if (!url) {
      setError("Informe a URL do plugin.");
      return;
    }

    setIsSavingPlugin(true);
    setPluginActionId(`save:${id}`);
    try {
      const latestData = await loadPluginsFromSource();
      const plugins = [...latestData.plugins];
      const existingWithSameId = plugins.find((plugin) => plugin.id === id);
      const duplicateByName = plugins.find(
        (plugin) =>
          plugin.id !== id && normalizePluginName(plugin.name) === normalizePluginName(name),
      );

      if (editingPluginId && !existingWithSameId) {
        setError("Esse plugin não existe mais no router de origem. Recarregue a lista.");
        return;
      }

      if (!editingPluginId && existingWithSameId) {
        const confirmed = await confirmPluginAction(
          "Substituir plugin existente",
          `Já existe um plugin com o ID <b>${id}</b>. Deseja substituir esse registro?`,
          "Substituir",
        );

        if (!confirmed) return;
      }

      if (duplicateByName) {
        const confirmed = await confirmPluginAction(
          "Substituir plugin com mesmo nome",
          `Já existe um plugin chamado <b>${duplicateByName.name}</b>. Deseja substituir pelo novo plugin?`,
          "Substituir",
        );

        if (!confirmed) return;
      }

      const nextPlugins = plugins
        .filter((plugin) => plugin.id !== id && plugin.id !== duplicateByName?.id)
        .concat({ id, name, url });

      const data = await savePluginsToSource(
        nextPlugins,
        editingPluginId ? `Plugin "${name}" atualizado.` : `Plugin "${name}" adicionado.`,
      );

      if (data) {
        setSelectedPluginIds((current) => new Set(current).add(id));
        resetPluginDraft();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar plugin.");
    } finally {
      setIsSavingPlugin(false);
      setPluginActionId("");
    }
  }

  function handleEditPlugin(plugin: PluginSummary) {
    setError("");
    setPluginDraftId(plugin.id);
    setPluginDraftName(plugin.name);
    setPluginDraftUrl(plugin.url);
    setEditingPluginId(plugin.id);
  }

  async function handleDeletePlugin(plugin: PluginSummary) {
    setError("");
    setOperationResult(null);

    if (!pluginsLoaded) {
      setError("Carregue os plugins do router de origem antes de alterar a lista.");
      return;
    }

    const confirmed = await confirmPluginAction(
      "Remover plugin",
      `O plugin <b>${plugin.name}</b> será removido do router de origem via set da lista completa.`,
      "Remover",
    );

    if (!confirmed) return;

    setIsSavingPlugin(true);
    setPluginActionId(`delete:${plugin.id}`);
    try {
      const latestData = await loadPluginsFromSource();
      if (!latestData.plugins.some((item) => item.id === plugin.id)) {
        setError("Esse plugin não existe mais no router de origem. Recarregue a lista.");
        return;
      }

      const data = await savePluginsToSource(
        latestData.plugins.filter((item) => item.id !== plugin.id),
        `Plugin "${plugin.name}" removido.`,
      );

      if (data) {
        setSelectedPluginIds((current) => {
          const next = new Set(current);
          next.delete(plugin.id);
          return next;
        });
        if (editingPluginId === plugin.id) resetPluginDraft();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao remover plugin.");
    } finally {
      setIsSavingPlugin(false);
      setPluginActionId("");
    }
  }

  async function handleDeleteSelectedPlugins() {
    setError("");
    setOperationResult(null);

    if (!pluginsLoaded) {
      setError("Carregue os plugins do router de origem antes de alterar a lista.");
      return;
    }

    const selectedIds = new Set(selectedPluginIds);

    if (selectedIds.size === 0) {
      setError("Selecione pelo menos um plugin para remover.");
      return;
    }

    const confirmed = await confirmPluginAction(
      "Remover plugins selecionados",
      `${selectedIds.size} plugin(s) serão removidos do router de origem via set da lista completa.`,
      "Remover",
    );

    if (!confirmed) return;

    setIsSavingPlugin(true);
    setPluginActionId("delete:selected");
    try {
      const latestData = await loadPluginsFromSource();
      const existingSelectedPlugins = latestData.plugins.filter((plugin) =>
        selectedIds.has(plugin.id),
      );

      if (existingSelectedPlugins.length === 0) {
        setError(
          "Os plugins selecionados não existem mais no router de origem. Recarregue a lista.",
        );
        return;
      }

      const data = await savePluginsToSource(
        latestData.plugins.filter((plugin) => !selectedIds.has(plugin.id)),
        `${existingSelectedPlugins.length} plugin(s) removidos.`,
      );

      if (data) {
        setSelectedPluginIds(new Set());
        if (editingPluginId && selectedIds.has(editingPluginId)) resetPluginDraft();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao remover plugins selecionados.");
    } finally {
      setIsSavingPlugin(false);
      setPluginActionId("");
    }
  }

  async function handleReplicatePlugins() {
    setError("");
    setOperationResult(null);

    if (selectedPlugins.length === 0) {
      setError("Selecione pelo menos um plugin.");
      return;
    }

    if (!hasTargetRouterSelection()) {
      setError("Informe pelo menos um router de destino.");
      openTargetsModal();
      return;
    }

    setIsCopyingPlugins(true);
    try {
      const targets = await ensureTargetRouterKeys();
      let replaceDuplicates = false;

      if (pluginCopyMode === "replace") {
        const confirmed = await confirmPluginAction(
          "Substituir plugins nos destinos",
          "O set de configuração não faz merge. Os destinos ficarão apenas com os plugins selecionados nesta tela.",
          "Substituir",
        );

        if (!confirmed) return;
      } else {
        const conflicts = await postJson<PluginConflictsResponse>("/api/plugins/conflicts", {
          targetRouterKeys: targets,
          plugins: selectedPlugins,
          batchSize: DEFAULT_PLUGIN_OPTIONS.batchSize,
        });

        if (conflicts.totals.conflicts > 0) {
          const names = Array.from(
            new Set(conflicts.conflicts.map((conflict) => conflict.pluginName)),
          )
            .slice(0, 5)
            .join(", ");
          const confirmed = await confirmPluginAction(
            "Substituir plugins com mesmo nome",
            `${conflicts.totals.conflicts} conflito(s) por nome foram encontrados nos destinos: <b>${names}</b>. Deseja substituir os plugins existentes com mesmo nome?`,
            "Substituir iguais",
          );

          if (!confirmed) return;
          replaceDuplicates = true;
        }
      }

      const data = await postJson<PluginReplicateResponse>("/api/plugins/replicate", {
        targetRouterKeys: targets,
        plugins: selectedPlugins,
        mode: pluginCopyMode,
        replaceDuplicates,
        ...DEFAULT_PLUGIN_OPTIONS,
      });

      setOperationResult({
        summary: `${data.totals.copied} destinos atualizados, ${data.totals.errors} erros`,
        payload: data,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao copiar plugins.");
    } finally {
      setIsCopyingPlugins(false);
    }
  }

  async function handleRunDevCommand(event: FormEvent) {
    event.preventDefault();
    const to = devCommandTo.trim();
    const uri = devCommandUri.trim();

    setError("");
    setOperationResult(null);

    if (!canAccessDevs) {
      return;
    }

    if (!uri) {
      setError("Informe a URI do command.");
      return;
    }

    const command: DevCommand = {
      method: devCommandMethod,
      to,
      uri,
      id: createCommandId(),
    };

    if (devCommandType) {
      command.type = devCommandType;

      try {
        command.resource = buildDevCommandResource(devCommandType, devCommandResource);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Resource inválido.");
        return;
      }
    }

    setIsRunningDevCommand(true);
    setOperationResult({
      summary: `Executando command em ${devCommandDestination}...`,
      payload: {
        destination: devCommandDestination,
        command,
        status: "loading",
      },
    });

    try {
      const response = await sendBlipCommand(command, {
        destination: devCommandDestination,
        timeout: 30000,
      });

      setOperationResult({
        summary: `Command executado em ${devCommandDestination}.`,
        payload: {
          destination: devCommandDestination,
          command,
          response,
        },
      });
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Erro ao executar command.";

      setOperationResult({
        summary: `Falha ao executar command em ${devCommandDestination}.`,
        payload: {
          destination: devCommandDestination,
          command,
          error: { message },
        },
      });
    } finally {
      setIsRunningDevCommand(false);
    }
  }

  async function handleGetCurrentApplication() {
    setError("");
    setIsLoadingCurrentApplication(true);
    setOperationResult({
      summary: "Executando getApplication...",
      payload: {
        action: "getApplication",
        status: "loading",
      },
    });

    try {
      const response = await getCurrentApplication();

      setOperationResult({
        summary: "getApplication executado.",
        payload: {
          action: "getApplication",
          response,
        },
      });
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Erro ao executar getApplication.";

      setOperationResult({
        summary: "Falha ao executar getApplication.",
        payload: {
          action: "getApplication",
          error: { message },
        },
      });
    } finally {
      setIsLoadingCurrentApplication(false);
    }
  }

  function toggleTemplate(key: string) {
    setSelectedTemplateKeys((curr) => {
      const next = new Set(curr);
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
    setSelectedFlowIds((curr) => {
      const next = new Set(curr);
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
      setSelectedFlowIds((curr) => {
        const next = new Set(curr);
        for (const f of filteredFlows) next.delete(flowKey(f));
        return next;
      });
      return;
    }
    setSelectedFlowIds((curr) => {
      const next = new Set(curr);
      for (const f of filteredFlows) next.add(flowKey(f));
      return next;
    });
  }
  function togglePlugin(id: string) {
    setSelectedPluginIds((curr) => {
      const next = new Set(curr);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }
  function toggleVisiblePlugins() {
    if (allVisiblePluginsSelected) {
      setSelectedPluginIds((curr) => {
        const next = new Set(curr);
        for (const plugin of filteredPlugins) next.delete(pluginKey(plugin));
        return next;
      });
      return;
    }
    setSelectedPluginIds((curr) => {
      const next = new Set(curr);
      for (const plugin of filteredPlugins) next.add(pluginKey(plugin));
      return next;
    });
  }
  function clearPluginManagerState() {
    setPluginSearchResult(emptyPluginSearch);
    setPluginFilter("");
    setSelectedPluginIds(new Set());
    setPluginsLoaded(false);
    resetPluginDraft();
  }
  function clearTemplateAndFlowResults() {
    setTemplateSearchResult(emptyTemplateSearch);
    setSelectedTemplateKeys(new Set());
    setFlowSearchResult(emptyFlowSearch);
    setSelectedFlowIds(new Set());
    setFlowFilter("");
  }
  function clearResults() {
    clearTemplateAndFlowResults();
    clearPluginManagerState();
    setOperationResult(null);
    setError("");
    setCopyNotice("");
  }
  function openSourceModal() {
    setDraftSourceRouterKey(isEmbedded ? sourceRouterShortName : sourceRouterKey);
    setRouterApplicationSearch("");
    if (isEmbedded) void loadRouterApplications();
    setRouterModal("source");
  }
  function openTargetsModal() {
    setDraftTargetRouterKeys(isEmbedded ? targetRouterShortNames.join("\n") : targetRouterKeys);
    setRouterApplicationSearch("");
    if (isEmbedded) void loadRouterApplications();
    setRouterModal("targets");
  }
  function closeRouterModal() {
    setRouterModal(null);
  }
  function saveSourceRouter() {
    const selectedShortName = draftSourceRouterKey.trim();

    setError("");
    setRouterApplicationsError("");

    if (!isEmbedded) {
      const sourceChanged = selectedShortName !== sourceRouterKey.trim();

      setSourceRouterKey(selectedShortName);
      setSourceRouterShortName("");
      if (sourceChanged) clearTemplateAndFlowResults();
      clearPluginManagerState();
      setRouterModal(null);
      return;
    }

    const sourceChanged = selectedShortName !== sourceRouterShortName;

    setSourceRouterShortName(selectedShortName);
    setSourceRouterKey("");
    if (sourceChanged) clearTemplateAndFlowResults();
    clearPluginManagerState();
    setRouterModal(null);
  }
  function saveTargetRouters() {
    const selectedShortNames = splitLines(draftTargetRouterKeys);

    setError("");
    setRouterApplicationsError("");

    if (!isEmbedded) {
      setTargetRouterKeys(selectedShortNames.join("\n"));
      setTargetRouterShortNames([]);
      setRouterModal(null);
      return;
    }

    setTargetRouterShortNames(selectedShortNames);
    setTargetRouterKeys("");
    setRouterModal(null);
  }
  function toggleDraftTargetRouter(shortName: string) {
    setDraftTargetRouterKeys((current) => {
      const next = new Set(splitLines(current));
      if (next.has(shortName)) {
        next.delete(shortName);
      } else {
        next.add(shortName);
      }

      return [...next].join("\n");
    });
  }
  function renderRouterApplicationPicker() {
    const isSourcePicker = routerModal === "source";

    return (
      <div className="router-application-picker">
        <div className="router-picker-toolbar">
          <label className="blip-native-field" htmlFor="routerApplicationSearch">
            Buscar router
            <input
              id="routerApplicationSearch"
              value={routerApplicationSearch}
              onChange={(event) => setRouterApplicationSearch(event.target.value)}
              placeholder="Nome ou shortname"
            />
          </label>
          <button
            className="blip-button secondary"
            type="button"
            onClick={() => void loadRouterApplications()}
            disabled={isLoadingRouterApplications}
          >
            {isLoadingRouterApplications ? (
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
            ) : (
              <Search size={18} aria-hidden="true" />
            )}
            Atualizar
          </button>
        </div>

        <div className="router-picker-meta">
          <span>{filteredRouterApplications.length} routers disponíveis</span>
          <span>
            {isSourcePicker
              ? draftSourceRouterKey || "Nenhum selecionado"
              : `${draftTargetRouterSet.size} selecionados`}
          </span>
        </div>

        {routerApplicationsError && (
          <div className="ember-alert danger modal-alert" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{routerApplicationsError}</span>
          </div>
        )}

        {isLoadingRouterApplications ? (
          <div className="router-picker-empty">
            <LoaderCircle className="spin" size={20} aria-hidden="true" />
            <span>Carregando routers...</span>
          </div>
        ) : (
          <div className="router-application-list">
            {filteredRouterApplications.length === 0 ? (
              <div className="router-picker-empty">
                <span>Nenhum router disponível</span>
              </div>
            ) : (
              filteredRouterApplications.map((application) => {
                const selected = isSourcePicker
                  ? draftSourceRouterKey === application.shortName
                  : draftTargetRouterSet.has(application.shortName);

                return (
                  <label
                    key={application.shortName}
                    className={`router-application-option ${selected ? "selected" : ""}`}
                  >
                    <input
                      type={isSourcePicker ? "radio" : "checkbox"}
                      name={isSourcePicker ? "source-router-application" : undefined}
                      checked={selected}
                      onChange={() => {
                        if (isSourcePicker) {
                          setDraftSourceRouterKey(application.shortName);
                          return;
                        }

                        toggleDraftTargetRouter(application.shortName);
                      }}
                    />
                    <span className="router-application-avatar" aria-hidden="true">
                      {application.imageUri ? (
                        <img src={application.imageUri} alt="" loading="lazy" />
                      ) : (
                        <span>{application.name.slice(0, 1).toUpperCase()}</span>
                      )}
                    </span>
                    <span className="router-application-copy">
                      <strong>{application.name}</strong>
                      <span>{application.shortName}</span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
        )}
      </div>
    );
  }

  const shellClassName = [
    "ember-shell",
    isDarkTheme ? "theme-dark" : "theme-light",
    isEmbedded ? "ember-shell--embedded" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main ref={shellRef} className={shellClassName}>
      <aside className="ember-sidebar" aria-label="Navegação da extensão">
        <div className="ember-logo extension-logo" aria-label="Gerenciador de Templates e Flows">
          <span className="ember-logo-text">Gerenciador de Templates e Flows</span>
        </div>
        <nav className="ember-side-nav">
          <button
            className={visibleActiveView === "templates" ? "active" : ""}
            type="button"
            onClick={() => setActiveView("templates")}
          >
            <MessageSquareText size={18} aria-hidden="true" />
            Templates
          </button>
          <button
            className={visibleActiveView === "flows" ? "active" : ""}
            type="button"
            onClick={() => setActiveView("flows")}
          >
            <FileJson size={18} aria-hidden="true" />
            Flows
          </button>
          {canAccessDevs && (
            <button
              className={visibleActiveView === "devs" ? "active" : ""}
              type="button"
              onClick={() => setActiveView("devs")}
            >
              <Terminal size={18} aria-hidden="true" />
              Devs
            </button>
          )}
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
              <strong>{sourceRouterShortName || maskRouterKey(sourceRouterKey)}</strong>
              {hasSourceRouterSelection() ? (
                <button
                  className="router-summary-action icon-action"
                  type="button"
                  aria-label="Editar router de origem"
                  title="Editar router de origem"
                  onClick={openSourceModal}
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
              ) : (
                <button className="router-summary-action" type="button" onClick={openSourceModal}>
                  Selecionar
                </button>
              )}
            </div>
            <button
              className="blip-button secondary header-icon-button"
              type="button"
              aria-label="Limpar"
              title="Limpar"
              onClick={clearResults}
            >
              <Trash2 size={18} aria-hidden="true" />
            </button>
            <button
              className="theme-toggle-button"
              type="button"
              aria-label={isDarkTheme ? "Ativar modo claro" : "Ativar modo escuro"}
              title={isDarkTheme ? "Ativar modo claro" : "Ativar modo escuro"}
              onClick={() => setIsDarkTheme((current) => !current)}
            >
              {isDarkTheme ? (
                <Sun size={18} aria-hidden="true" />
              ) : (
                <Moon size={18} aria-hidden="true" />
              )}
            </button>
          </div>
        </header>

        {visibleActiveView === "templates" ? (
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
          </section>
        ) : visibleActiveView === "flows" ? (
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
        ) : (
          <section className="ember-stat-grid template-stat-grid" aria-label="Resumo">
            {devsTab === "plugins" ? (
              <>
                <div className="ember-stat-card">
                  <span>Plugins</span>
                  <strong>{pluginSearchResult.total}</strong>
                </div>
                <div className="ember-stat-card">
                  <span>Selecionados</span>
                  <strong>{selectedPlugins.length}</strong>
                </div>
                <div className="ember-stat-card">
                  <span>Destinos</span>
                  <strong>{targetCount}</strong>
                </div>
                <div className="ember-stat-card">
                  <span>Modo</span>
                  <strong>{pluginCopyMode === "add" ? "Adicionar" : "Substituir"}</strong>
                </div>
              </>
            ) : (
              <>
                <div className="ember-stat-card">
                  <span>Destino</span>
                  <strong>{devCommandDestination}</strong>
                </div>
                <div className="ember-stat-card">
                  <span>Método</span>
                  <strong>{devCommandMethod.toUpperCase()}</strong>
                </div>
                <div className="ember-stat-card">
                  <span>Iframe</span>
                  <strong>{isEmbedded ? "Ativo" : "Fora"}</strong>
                </div>
                <div className="ember-stat-card">
                  <span>Type</span>
                  <strong>{devCommandType ? getDevCommandTypeLabel(devCommandType) : "Sem"}</strong>
                </div>
              </>
            )}
          </section>
        )}

        {error && (
          <div className="ember-alert danger" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {visibleActiveView === "templates" ? (
          <section className="ember-panel results-panel">
            <div className="ember-panel-title results-title">
              <div>
                <h2>Templates</h2>
                <p>
                  {templateSearchResult.total} encontrados, {selectedTemplates.length} selecionados,{" "}
                  {targetCount} destinos
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
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Vazio busca sem filtro"
                />
              </label>
              <button
                className="blip-submit-button secondary"
                type="submit"
                disabled={isSearchingTemplates}
              >
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
                {targetCount
                  ? `Editar routers de destino (${targetCount})`
                  : "Adicionar routers de destino"}
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
                    templateSearchResult.templates.map((template) => {
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
                            <span
                              className={`ember-status ${String(template.status || "").toLowerCase()}`}
                            >
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
        ) : visibleActiveView === "flows" ? (
          <section className="ember-panel results-panel">
            <div className="ember-panel-title results-title">
              <div>
                <h2>Flows</h2>
                <p>
                  {flowSearchResult.total} carregados, {filteredFlows.length} filtrados,{" "}
                  {selectedFlows.length} selecionados
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
                  onChange={(e) => setFlowFilter(e.target.value)}
                  placeholder="Digite nome ou ID"
                />
              </label>
              <button
                className="blip-submit-button secondary"
                type="submit"
                disabled={isLoadingFlows}
              >
                {isLoadingFlows ? (
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
                  setIsCreateFlowModalOpen(true);
                }}
              >
                <Plus size={18} aria-hidden="true" />
                Criar flow agora
              </button>
              <button className="blip-button secondary" type="button" onClick={openTargetsModal}>
                <Plus size={18} aria-hidden="true" />
                {targetCount
                  ? `Editar routers de destino (${targetCount})`
                  : "Adicionar routers de destino"}
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
                    filteredFlows.map((flow) => {
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
                            <span
                              className={`ember-status ${String(flow.status || "").toLowerCase()}`}
                            >
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
                              <button
                                className="table-action-button icon-only"
                                type="button"
                                aria-label={`Editar ${flow.name}`}
                                title="Editar"
                                onClick={() => void handleOpenEditFlow(flow)}
                                disabled={
                                  flowActionId === `edit:${flow.id}` ||
                                  flowActionId === `update:${flow.id}`
                                }
                              >
                                {flowActionId === `edit:${flow.id}` ||
                                flowActionId === `update:${flow.id}` ? (
                                  <LoaderCircle className="spin" size={16} aria-hidden="true" />
                                ) : (
                                  <Pencil size={16} aria-hidden="true" />
                                )}
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
        ) : (
          <section className="ember-panel results-panel devs-panel">
            <div className="dev-tabs" role="tablist" aria-label="Ferramentas de dev">
              <button
                className={devsTab === "commands" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={devsTab === "commands"}
                onClick={() => setDevsTab("commands")}
              >
                <Terminal size={16} aria-hidden="true" />
                Commands
              </button>
              <button
                className={devsTab === "plugins" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={devsTab === "plugins"}
                onClick={() => setDevsTab("plugins")}
              >
                <FileJson size={16} aria-hidden="true" />
                Plugins Manager
              </button>
            </div>

            {devsTab === "commands" ? (
              <>
                <div className="ember-panel-title results-title">
                  <div>
                    <h2>Devs</h2>
                    <p>Envie commands pelo proxy do Portal BLiP sem metadata.</p>
                  </div>
                  <Terminal size={18} aria-hidden="true" />
                </div>

                <form
                  className="template-filter-row dev-command-row"
                  onSubmit={handleRunDevCommand}
                >
                  <label className="blip-native-field" htmlFor="devCommandDestination">
                    Destination
                    <select
                      id="devCommandDestination"
                      value={devCommandDestination}
                      onChange={(event) =>
                        setDevCommandDestination(event.target.value as CommandDestination)
                      }
                    >
                      {COMMAND_DESTINATIONS.map((destination) => (
                        <option key={destination} value={destination}>
                          {destination}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="blip-native-field" htmlFor="devCommandMethod">
                    Method
                    <select
                      id="devCommandMethod"
                      value={devCommandMethod}
                      onChange={(event) => setDevCommandMethod(event.target.value as CommandMethod)}
                    >
                      {DEV_COMMAND_METHODS.map((method) => (
                        <option key={method} value={method}>
                          {method}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="blip-native-field" htmlFor="devCommandTo">
                    To
                    <input
                      id="devCommandTo"
                      value={devCommandTo}
                      onChange={(event) => setDevCommandTo(event.target.value)}
                      placeholder="postmaster@portal.blip.ai"
                    />
                  </label>
                  <label
                    className="blip-native-field template-search-field"
                    htmlFor="devCommandUri"
                  >
                    URI
                    <input
                      id="devCommandUri"
                      value={devCommandUri}
                      onChange={(event) => setDevCommandUri(event.target.value)}
                      placeholder="/resources"
                    />
                  </label>
                  <label className="blip-native-field" htmlFor="devCommandType">
                    Type
                    <select
                      id="devCommandType"
                      value={devCommandType}
                      onChange={(event) => setDevCommandType(event.target.value as DevCommandType)}
                    >
                      {DEV_COMMAND_TYPE_OPTIONS.map((option) => (
                        <option key={option.value || "none"} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {devCommandType && (
                    <label
                      className="blip-native-field dev-command-resource-field"
                      htmlFor="devCommandResource"
                    >
                      Resource
                      <textarea
                        id="devCommandResource"
                        className={
                          devCommandType === "application/json" ? "json-resource-input" : ""
                        }
                        value={devCommandResource}
                        onChange={(event) => setDevCommandResource(event.target.value)}
                        placeholder={devCommandType === "application/json" ? "{}" : "Texto"}
                        spellCheck={devCommandType !== "application/json"}
                      />
                    </label>
                  )}
                  <div className="dev-command-actions">
                    <button
                      className="blip-button secondary"
                      type="button"
                      onClick={() => setDevCommandUri(DEFAULT_DEV_COMMAND_URI)}
                    >
                      <Clipboard size={18} aria-hidden="true" />
                      Padrão
                    </button>
                    <button
                      className="blip-button secondary"
                      type="button"
                      onClick={() => void handleGetCurrentApplication()}
                      disabled={isLoadingCurrentApplication || !isEmbedded}
                    >
                      {isLoadingCurrentApplication ? (
                        <LoaderCircle className="spin" size={18} aria-hidden="true" />
                      ) : (
                        <FileJson size={18} aria-hidden="true" />
                      )}
                      Get application
                    </button>
                    <button
                      className="blip-submit-button primary"
                      type="submit"
                      disabled={isRunningDevCommand || !isEmbedded}
                    >
                      {isRunningDevCommand ? (
                        <LoaderCircle className="spin" size={18} aria-hidden="true" />
                      ) : (
                        <Send size={18} aria-hidden="true" />
                      )}
                      Executar
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <div className="ember-panel-title results-title">
                  <div>
                    <h2>Plugins Manager</h2>
                    <p>
                      {pluginSearchResult.total} carregados, {filteredPlugins.length} filtrados,{" "}
                      {selectedPlugins.length} selecionados
                    </p>
                  </div>
                  <button
                    className="blip-button secondary"
                    type="button"
                    onClick={toggleVisiblePlugins}
                    disabled={filteredPlugins.length === 0}
                  >
                    {allVisiblePluginsSelected ? (
                      <CheckSquare size={18} aria-hidden="true" />
                    ) : (
                      <Square size={18} aria-hidden="true" />
                    )}
                    Selecionar
                  </button>
                </div>

                <form className="plugin-editor-form" onSubmit={handleSavePlugin}>
                  <label className="blip-native-field" htmlFor="pluginDraftId">
                    ID
                    <input
                      id="pluginDraftId"
                      value={pluginDraftId}
                      onChange={(event) => setPluginDraftId(event.target.value)}
                      placeholder="Gerar automaticamente"
                      disabled={Boolean(editingPluginId)}
                    />
                  </label>
                  <button
                    className="blip-button secondary"
                    type="button"
                    onClick={() => setPluginDraftId(createCommandId())}
                    disabled={Boolean(editingPluginId)}
                  >
                    <Plus size={18} aria-hidden="true" />
                    Gerar ID
                  </button>
                  <label className="blip-native-field" htmlFor="pluginDraftName">
                    Nome
                    <input
                      id="pluginDraftName"
                      value={pluginDraftName}
                      onChange={(event) => setPluginDraftName(event.target.value)}
                      placeholder="Nome do plugin"
                    />
                  </label>
                  <label className="blip-native-field plugin-url-field" htmlFor="pluginDraftUrl">
                    URL
                    <input
                      id="pluginDraftUrl"
                      value={pluginDraftUrl}
                      onChange={(event) => setPluginDraftUrl(event.target.value)}
                      placeholder="https://plugin.example.com/"
                    />
                  </label>
                  {editingPluginId && (
                    <button
                      className="blip-button secondary"
                      type="button"
                      onClick={resetPluginDraft}
                      disabled={isSavingPlugin}
                    >
                      <X size={18} aria-hidden="true" />
                      Cancelar
                    </button>
                  )}
                  <button
                    className="blip-submit-button primary"
                    type="submit"
                    disabled={isSavingPlugin || !pluginsLoaded}
                  >
                    {isSavingPlugin ? (
                      <LoaderCircle className="spin" size={18} aria-hidden="true" />
                    ) : (
                      <Plus size={18} aria-hidden="true" />
                    )}
                    {editingPluginId ? "Salvar edição" : "Adicionar"}
                  </button>
                </form>

                <form className="plugin-toolbar" onSubmit={handleLoadPlugins}>
                  <label className="blip-native-field plugin-filter-field" htmlFor="pluginFilter">
                    Filtrar por nome, ID ou URL
                    <input
                      id="pluginFilter"
                      value={pluginFilter}
                      onChange={(event) => setPluginFilter(event.target.value)}
                      placeholder="Digite para filtrar"
                    />
                  </label>
                  <label className="blip-native-field" htmlFor="pluginCopyMode">
                    Modo de cópia
                    <select
                      id="pluginCopyMode"
                      value={pluginCopyMode}
                      onChange={(event) => setPluginCopyMode(event.target.value as PluginCopyMode)}
                    >
                      <option value="add">Adicionar aos existentes</option>
                      <option value="replace">Substituir lista do destino</option>
                    </select>
                  </label>
                  <button
                    className="blip-submit-button secondary"
                    type="submit"
                    disabled={isLoadingPlugins}
                  >
                    {isLoadingPlugins ? (
                      <LoaderCircle className="spin" size={18} aria-hidden="true" />
                    ) : (
                      <Search size={18} aria-hidden="true" />
                    )}
                    Buscar
                  </button>
                  <button
                    className="blip-button secondary danger"
                    type="button"
                    onClick={() => void handleDeleteSelectedPlugins()}
                    disabled={isSavingPlugin || selectedPlugins.length === 0}
                  >
                    {pluginActionId === "delete:selected" ? (
                      <LoaderCircle className="spin" size={18} aria-hidden="true" />
                    ) : (
                      <Trash2 size={18} aria-hidden="true" />
                    )}
                    Remover selecionados
                  </button>
                  <button
                    className="blip-button secondary"
                    type="button"
                    onClick={openTargetsModal}
                  >
                    <Plus size={18} aria-hidden="true" />
                    {targetCount
                      ? `Editar routers de destino (${targetCount})`
                      : "Adicionar routers de destino"}
                  </button>
                  <button
                    className="blip-submit-button primary"
                    type="button"
                    onClick={handleReplicatePlugins}
                    disabled={isCopyingPlugins || selectedPlugins.length === 0}
                  >
                    {isCopyingPlugins ? (
                      <LoaderCircle className="spin" size={18} aria-hidden="true" />
                    ) : (
                      <CopyPlus size={18} aria-hidden="true" />
                    )}
                    Copiar
                  </button>
                </form>

                <div className="ember-table-wrap template-table-wrap">
                  <table className="ember-table plugins-table">
                    <thead>
                      <tr>
                        <th className="select-column">Sel.</th>
                        <th>Nome</th>
                        <th>ID</th>
                        <th>URL</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPlugins.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="empty-cell">
                            Nenhum plugin carregado
                          </td>
                        </tr>
                      ) : (
                        filteredPlugins.map((plugin) => {
                          const key = pluginKey(plugin);
                          const checked = selectedPluginIds.has(key);

                          return (
                            <tr key={key} className={checked ? "selected" : ""}>
                              <td className="select-column">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => togglePlugin(key)}
                                  aria-label={`Selecionar ${plugin.name}`}
                                />
                              </td>
                              <td className="template-name">{plugin.name}</td>
                              <td className="mono-cell">{plugin.id}</td>
                              <td className="plugin-url-cell">
                                <a href={plugin.url} target="_blank" rel="noreferrer">
                                  {plugin.url}
                                </a>
                              </td>
                              <td>
                                <div className="table-actions">
                                  <button
                                    className="table-action-button icon-only"
                                    type="button"
                                    aria-label={`Editar ${plugin.name}`}
                                    title="Editar"
                                    onClick={() => handleEditPlugin(plugin)}
                                    disabled={isSavingPlugin}
                                  >
                                    {pluginActionId === `save:${plugin.id}` ? (
                                      <LoaderCircle className="spin" size={16} aria-hidden="true" />
                                    ) : (
                                      <Pencil size={16} aria-hidden="true" />
                                    )}
                                  </button>
                                  <button
                                    className="table-action-button icon-only danger"
                                    type="button"
                                    aria-label={`Remover ${plugin.name}`}
                                    title="Remover"
                                    onClick={() => void handleDeletePlugin(plugin)}
                                    disabled={isSavingPlugin}
                                  >
                                    {pluginActionId === `delete:${plugin.id}` ? (
                                      <LoaderCircle className="spin" size={16} aria-hidden="true" />
                                    ) : (
                                      <Trash2 size={16} aria-hidden="true" />
                                    )}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}

        {visibleActiveView === "devs" && (
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
            <pre className="code">
              {operationResult ? JSON.stringify(operationResult.payload, null, 2) : "{}"}
            </pre>
          </section>
        )}

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
                  <p>
                    Compara o router de origem com os destinos e retorna templates filtrados
                    presentes em todos eles.
                  </p>
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
                    onChange={(e) => setTemplateCompareCategory(e.target.value)}
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
                    onChange={(e) => setTemplateCompareStatus(e.target.value)}
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
                  <button
                    className="blip-button secondary"
                    type="button"
                    onClick={openTargetsModal}
                  >
                    <Plus size={18} aria-hidden="true" />
                    {targetCount ? `Destinos (${targetCount})` : "Adicionar destinos"}
                  </button>
                  <button
                    className="blip-submit-button primary"
                    type="submit"
                    disabled={isComparingTemplates}
                  >
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
                    <span>
                      {templateCompareResult.totals.routers} routers comparados, incluindo a origem
                    </span>
                    <div className="compare-summary-actions">
                      <strong>
                        {templateCompareResult.totals.commonTemplates} templates em comum
                      </strong>
                      <button
                        className="blip-button secondary"
                        type="button"
                        onClick={() =>
                          handleCopyJson(
                            displayedCompareTemplates.map((t) => t.name),
                            "Lista de nomes copiada.",
                          )
                        }
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
                          onClick={() =>
                            setTemplateCompareNameSort((c) => (c === "asc" ? "desc" : "asc"))
                          }
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
                      displayedCompareTemplates.map((template) => (
                        <tr key={`${template.name}|${template.language}`}>
                          <td className="template-name">{template.name}</td>
                          <td>{template.language}</td>
                          <td>{template.category || "-"}</td>
                          <td>
                            <span
                              className={`ember-status ${String(template.status || "").toLowerCase()}`}
                            >
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
                    onChange={(e) => setNewFlowName(e.target.value)}
                    placeholder="Nome do novo flow"
                  />
                </label>

                <label className="native-check create-flow-check">
                  <input
                    type="checkbox"
                    checked={newFlowIsApi}
                    onChange={(e) => setNewFlowIsApi(e.target.checked)}
                  />
                  É Flow API
                </label>

                <label className="blip-native-field" htmlFor="newFlowEndpointUri">
                  endpoint_uri
                  <input
                    id="newFlowEndpointUri"
                    value={newFlowEndpointUri}
                    onChange={(e) => setNewFlowEndpointUri(e.target.value)}
                    disabled={!newFlowIsApi}
                    placeholder="https://..."
                  />
                </label>

                <label className="blip-native-field json-field" htmlFor="newFlowJson">
                  JSON completo
                  <textarea
                    id="newFlowJson"
                    value={newFlowJson}
                    onChange={(e) => setNewFlowJson(e.target.value)}
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

        {isEditFlowModalOpen && editingFlow && (
          <div className="ember-modal-backdrop" role="presentation">
            <section
              className="ember-modal create-flow-modal"
              aria-labelledby="edit-flow-modal-title"
              role="dialog"
              aria-modal="true"
            >
              <div className="ember-modal-header">
                <div>
                  <h2 id="edit-flow-modal-title">Editar flow</h2>
                  <p>{editingFlow.name}</p>
                </div>
                <button
                  className="blip-button secondary icon-only"
                  type="button"
                  onClick={() => closeEditFlowModal()}
                  disabled={isUpdatingFlow || isBulkUpdatingFlows}
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

                <label className="blip-native-field json-field" htmlFor="editFlowJson">
                  JSON completo
                  <textarea
                    id="editFlowJson"
                    value={editFlowJson}
                    onChange={(e) => setEditFlowJson(e.target.value)}
                    disabled={isLoadingEditFlowJson || isUpdatingFlow || isBulkUpdatingFlows}
                    placeholder={isLoadingEditFlowJson ? "Carregando JSON..." : "{ ... }"}
                  />
                </label>

                <label className="flow-publish-switch">
                  <input
                    type="checkbox"
                    checked={editFlowPublishAfterSave}
                    onChange={(event) => setEditFlowPublishAfterSave(event.target.checked)}
                    disabled={isLoadingEditFlowJson || isUpdatingFlow || isBulkUpdatingFlows}
                  />
                  <span className="flow-switch-track" aria-hidden="true">
                    <span className="flow-switch-thumb" />
                  </span>
                  <span className="flow-switch-copy">
                    <strong>Publicar após salvar</strong>
                    <span>Atualiza o JSON e publica o flow na mesma ação.</span>
                  </span>
                </label>
              </div>

              <div className="ember-modal-footer">
                <button
                  className="blip-button secondary"
                  type="button"
                  onClick={() => closeEditFlowModal()}
                  disabled={isUpdatingFlow || isBulkUpdatingFlows}
                >
                  Cancelar
                </button>
                <div className="flow-edit-footer-actions">
                  <button
                    className="blip-button secondary"
                    type="button"
                    onClick={handleOpenBulkFlowMappingModal}
                    disabled={isLoadingEditFlowJson || isUpdatingFlow || isBulkUpdatingFlows}
                    title="Alterar este flow nos routers de destino"
                  >
                    {isBulkUpdatingFlows ? (
                      <LoaderCircle className="spin" size={18} aria-hidden="true" />
                    ) : editFlowPublishAfterSave ? (
                      <Send size={18} aria-hidden="true" />
                    ) : (
                      <FileJson size={18} aria-hidden="true" />
                    )}
                    Alterar em massa
                  </button>
                  <button
                    className="blip-submit-button primary"
                    type="button"
                    onClick={handleSaveEditedFlow}
                    disabled={isLoadingEditFlowJson || isUpdatingFlow || isBulkUpdatingFlows}
                  >
                    {isUpdatingFlow ? (
                      <LoaderCircle className="spin" size={18} aria-hidden="true" />
                    ) : editFlowPublishAfterSave ? (
                      <Send size={18} aria-hidden="true" />
                    ) : (
                      <Pencil size={18} aria-hidden="true" />
                    )}
                    {editFlowPublishAfterSave ? "Salvar e publicar" : "Salvar"}
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {isBulkFlowMappingModalOpen && bulkFlowPreflight && editingFlow && (
          <div className="ember-modal-backdrop" role="presentation">
            <section
              className="ember-modal bulk-flow-modal"
              aria-labelledby="bulk-flow-modal-title"
              role="dialog"
              aria-modal="true"
            >
              <div className="ember-modal-header">
                <div>
                  <h2 id="bulk-flow-modal-title">Alterar em massa</h2>
                  <p>
                    {bulkFlowPreflight.totals.targetRouters} destinos,{" "}
                    {bulkFlowPreflight.totals.matched} encontrados,{" "}
                    {bulkFlowPreflight.totals.missing} sem match por nome
                  </p>
                </div>
                <button
                  className="blip-button secondary icon-only"
                  type="button"
                  onClick={() => closeBulkFlowMappingModal()}
                  disabled={isBulkUpdatingFlows}
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

                <div className="ember-table-wrap bulk-flow-table-wrap">
                  <table className="ember-table flow-mapping-table">
                    <thead>
                      <tr>
                        <th>Router destino</th>
                        <th>De</th>
                        <th>Para</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkFlowPreflight.targetRouters.map((targetRouter) => {
                        const targetIndexKey = String(targetRouter.targetIndex);
                        const match = bulkFlowPreflight.matches.find(
                          (item) =>
                            item.targetIndex === targetRouter.targetIndex &&
                            item.sourceFlowId === editingFlow.id,
                        );
                        const selectedFlowId = bulkFlowSelections[targetIndexKey] || "";
                        const selectedFlow = targetRouter.availableFlows.find(
                          (flow) => flow.id === selectedFlowId,
                        );

                        return (
                          <tr key={targetIndexKey}>
                            <td>
                              <strong>{getTargetRouterLabel(targetRouter.targetIndex)}</strong>
                              <span className="flow-mapping-subtle">
                                {targetRouter.totalFlows} flows
                              </span>
                            </td>
                            <td>
                              <strong>{editingFlow.name}</strong>
                              <span className="mono-cell">{editingFlow.id}</span>
                            </td>
                            <td>
                              {match ? (
                                <>
                                  <strong>{match.flowName}</strong>
                                  <span className="mono-cell">{match.flowId}</span>
                                </>
                              ) : (
                                <label
                                  className="blip-native-field compact-field"
                                  htmlFor={`bulkFlowTarget-${targetIndexKey}`}
                                >
                                  Flow do destino
                                  <select
                                    id={`bulkFlowTarget-${targetIndexKey}`}
                                    value={selectedFlowId}
                                    onChange={(event) =>
                                      setBulkFlowSelections((current) => ({
                                        ...current,
                                        [targetIndexKey]: event.target.value,
                                      }))
                                    }
                                    disabled={
                                      isBulkUpdatingFlows ||
                                      targetRouter.availableFlows.length === 0
                                    }
                                  >
                                    <option value="">Não alterar destino</option>
                                    {targetRouter.availableFlows.map((flow) => (
                                      <option key={flow.id} value={flow.id}>
                                        {flow.name} - {flow.id}
                                      </option>
                                    ))}
                                  </select>
                                  {selectedFlow && (
                                    <span className="mono-cell">{selectedFlow.id}</span>
                                  )}
                                </label>
                              )}
                            </td>
                            <td>
                              {match ? (
                                <span className="ember-status published">Achado</span>
                              ) : selectedFlow ? (
                                <span className="ember-status pending">Selecionado</span>
                              ) : (
                                <span className="ember-status failed">Sem match</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {bulkFlowPreflight.errors
                        .filter((item) => item.step === "load_target_flows")
                        .map((item) => (
                          <tr key={`error-${item.targetIndex}`}>
                            <td>
                              <strong>
                                {typeof item.targetIndex === "number"
                                  ? getTargetRouterLabel(item.targetIndex)
                                  : "Destino"}
                              </strong>
                            </td>
                            <td>
                              <strong>{editingFlow.name}</strong>
                              <span className="mono-cell">{editingFlow.id}</span>
                            </td>
                            <td>{item.message}</td>
                            <td>
                              <span className="ember-status failed">Erro</span>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="ember-modal-footer">
                <button
                  className="blip-button secondary"
                  type="button"
                  onClick={() => closeBulkFlowMappingModal()}
                  disabled={isBulkUpdatingFlows}
                >
                  Voltar
                </button>
                <button
                  className="blip-submit-button primary"
                  type="button"
                  onClick={handleConfirmBulkFlowMapping}
                  disabled={isBulkUpdatingFlows}
                >
                  {isBulkUpdatingFlows ? (
                    <LoaderCircle className="spin" size={18} aria-hidden="true" />
                  ) : editFlowPublishAfterSave ? (
                    <Send size={18} aria-hidden="true" />
                  ) : (
                    <FileJson size={18} aria-hidden="true" />
                  )}
                  {editFlowPublishAfterSave ? "Alterar e publicar" : "Alterar"}
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
                    {isEmbedded
                      ? "Selecione os routers master em que você tem permissão."
                      : routerModal === "source"
                        ? "Informe a key que será usada para buscar templates e flows."
                        : "Informe uma ou mais keys de destino, uma por linha."}
                  </p>
                </div>
                <button
                  className="blip-button secondary icon-only"
                  type="button"
                  onClick={closeRouterModal}
                >
                  <X size={18} aria-hidden="true" />
                  <span>Fechar</span>
                </button>
              </div>

              <div className="ember-modal-body">
                {isEmbedded ? (
                  renderRouterApplicationPicker()
                ) : routerModal === "source" ? (
                  <label className="blip-native-field textarea-field" htmlFor="sourceRouterModal">
                    Key de origem
                    <textarea
                      id="sourceRouterModal"
                      value={draftSourceRouterKey}
                      onChange={(e) => setDraftSourceRouterKey(e.target.value)}
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
                      onChange={(e) => setDraftTargetRouterKeys(e.target.value)}
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
