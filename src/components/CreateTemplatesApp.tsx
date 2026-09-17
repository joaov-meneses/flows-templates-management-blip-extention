import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDownAZ,
  ArrowDownZA,
  Bot,
  CheckSquare,
  Clipboard,
  CopyPlus,
  Eye,
  ExternalLink,
  FileJson,
  KeyRound,
  LoaderCircle,
  MessageSquareText,
  Moon,
  Network,
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
import { useModalFocus } from "../hooks/useModalFocus";
import { useTheme } from "../hooks/useTheme";
import { Button } from "./ui/Button";
import { ActionsMenu } from "./ui/ActionsMenu";
import { Feedback } from "./ui/Feedback";
import { StatusBadge } from "./ui/StatusBadge";
import { SelectionBar } from "./ui/SelectionBar";
import { TemplateTable } from "./TemplateTable";
import { FlowTable } from "./FlowTable";
import { postJson } from "../lib/api";

import type {
  ActiveView,
  DevsTab,
  RouterModal,
  SortDirection,
  CommandDestination,
  CommandMethod,
  DevCommandType,
  DevCommandContentType,
  PluginCopyMode,
  DevCommand,
  Template,
  SearchResponse,
  TemplateReplicateResponse,
  TemplateCompareResponse,
  TemplateDeleteMode,
  TemplateDeleteItem,
  TemplateDeleteTargetRouter,
  TemplateDeleteMatch,
  TemplateDeleteMissing,
  TemplateDeleteError,
  TemplateDeleteResponse,
  TemplateBulkDeleteResponse,
  TemplateDeleteProgress,
  TemplateDeleteJobState,
  TemplateDeleteJob,
  FlowSummary,
  FlowSearchResponse,
  FlowPreviewResponse,
  FlowJsonResponse,
  FlowReplicateResponse,
  FlowCreateResponse,
  FlowUpdateJsonResponse,
  FlowUpdateMetadataResponse,
  FlowPublishResponse,
  FlowDeprecateResponse,
  FlowBulkUpdateMatch,
  FlowBulkUpdateMissing,
  FlowBulkUpdateError,
  FlowBulkUpdateOverride,
  FlowBulkUpdateResponse,
  PluginSummary,
  PluginSearchResponse,
  PluginSaveResponse,
  PluginConflict,
  PluginConflictsResponse,
  PluginReplicateResponse,
  BotCloneOptions,
  BotCloneResponse,
  BotCloneStep,
  OperationResult,
  PortalApplicationAccount,
  ResolvedRouterKey,
  CurrentApplicationRouter,
} from "../types/templates";
const DEFAULT_TEMPLATE_OPTIONS = {
  dryRun: false,
  continueOnError: true,
  onlyApproved: false,
  batchSize: 15,
};
const DEFAULT_FLOW_OPTIONS = { continueOnError: true, batchSize: 15 };
const DEFAULT_PLUGIN_OPTIONS = { continueOnError: true, batchSize: 15 };
const DEFAULT_BOT_CLONE_OPTIONS: BotCloneOptions = {
  flow: false,
  queues: false,
  attendanceRules: false,
  attendants: false,
  quickReplies: false,
  tags: false,
  configVariables: false,
  priorityRules: false,
};
const BOT_CLONE_OPTION_GROUPS: Array<{
  group: string;
  fields: Array<{ key: keyof BotCloneOptions; label: string }>;
}> = [
  {
    group: "Builder",
    fields: [
      { key: "flow", label: "Fluxo" },
      { key: "configVariables", label: "Variáveis de configuração" },
    ],
  },
  {
    group: "Desk",
    fields: [
      { key: "queues", label: "Filas" },
      { key: "attendanceRules", label: "Regras de atendimento" },
      { key: "priorityRules", label: "Regras de priorização" },
      { key: "attendants", label: "Atendentes" },
      { key: "quickReplies", label: "Respostas prontas" },
      { key: "tags", label: "Tags" },
    ],
  },
];
const BOT_CLONE_OPTION_KEYS = BOT_CLONE_OPTION_GROUPS.flatMap((group) =>
  group.fields.map((field) => field.key),
);
// Regras de atendimento e de priorização espelham o destino: itens que só
// existem lá são removidos. Isso justifica pedir confirmação antes de rodar.
const BOT_CLONE_DESTRUCTIVE_KEYS: Array<keyof BotCloneOptions> = [
  "attendanceRules",
  "priorityRules",
];
type BotIdentityLookup = {
  status: "idle" | "loading" | "success" | "error";
  identity: string;
};
const IDLE_BOT_IDENTITY: BotIdentityLookup = { status: "idle", identity: "" };
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
const emptyTemplateDeleteProgress: TemplateDeleteProgress = {
  total: 0,
  processed: 0,
  removed: 0,
  failed: 0,
};

function splitLines(value: string) {
  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
function removeRouterSelection(values: string[], blockedRouter: string) {
  const normalizedBlockedRouter = blockedRouter.trim();

  if (!normalizedBlockedRouter) return values;

  return values.filter((value) => value.trim() !== normalizedBlockedRouter);
}
function removeRouterSelectionFromLines(value: string, blockedRouter: string) {
  return removeRouterSelection(splitLines(value), blockedRouter).join("\n");
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
function normalizeTemplateDeleteName(value: string) {
  return value.trim().toLocaleLowerCase("pt-BR");
}
function getTemplateDeleteItems(templates: Template[]) {
  const templatesByName = new Map<string, TemplateDeleteItem>();

  for (const template of templates) {
    const name = template.name.trim();
    if (!name) continue;

    const nameKey = normalizeTemplateDeleteName(name);
    const existing = templatesByName.get(nameKey) || {
      name,
      languages: [],
      category: template.category,
      status: template.status,
    };
    const language = template.language.trim();

    if (language && !existing.languages.includes(language)) {
      existing.languages.push(language);
    }

    if (!existing.category && template.category) {
      existing.category = template.category;
    }

    if (!existing.status && template.status) {
      existing.status = template.status;
    }

    templatesByName.set(nameKey, existing);
  }

  return Array.from(templatesByName.values());
}
function flowKey(f: FlowSummary) {
  return String(f.id);
}
function isPublishedFlow(flow: Pick<FlowSummary, "status"> | FlowBulkUpdateMatch) {
  return String(flow.status || "").toUpperCase() === "PUBLISHED";
}
function isDeprecatedFlow(flow: Pick<FlowSummary, "status">) {
  const status = String(flow.status || "").toUpperCase();

  return status === "DEPRECATED" || status === "DISABLED";
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
function buildRouterUrl(application: Pick<PortalApplicationAccount, "shortName" | "tenantId">) {
  const tenantId = application.tenantId?.trim().toLowerCase();
  const shortName = application.shortName.trim();

  if (!tenantId || !shortName || !/^[a-z0-9-]+$/.test(tenantId)) return "";

  return `https://${tenantId}.blip.ai/application/detail/${encodeURIComponent(shortName)}/home`;
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
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  ta.value = text;
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "-9999px";
  ta.style.opacity = "0";
  ta.style.pointerEvents = "none";
  document.body.appendChild(ta);
  ta.focus({ preventScroll: true });
  ta.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(ta);
  window.scrollTo(scrollX, scrollY);

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
  const name = typeof resource.name === "string" ? resource.name.trim() : "";
  const imageUri = typeof resource.imageUri === "string" ? resource.imageUri.trim() : "";

  return {
    shortName: resource.shortName.trim(),
    name: name || undefined,
    imageUri: imageUri || undefined,
    accessKey: accessKey || undefined,
  };
}
function buildTemplateReplicateSummary(data: TemplateReplicateResponse) {
  const hasFailures = data.totals.errors > 0 || data.totals.created < data.totals.createJobs;

  if (!hasFailures) {
    return `Replicação concluída com sucesso em todos os destinos: ${data.totals.created}/${data.totals.createJobs} criação(ões), ${data.totals.uploadedAttachments} imagem(ns).`;
  }

  return `Replicação concluída com falhas: ${data.totals.created}/${data.totals.createJobs} criação(ões) feitas, ${data.totals.errors} erro(s).`;
}
function buildTemplateDeleteSummary(mode: TemplateDeleteMode, progress: TemplateDeleteProgress) {
  const scope = mode === "source" ? "na origem" : "na origem e nos destinos";

  if (progress.failed === 0) {
    return `Deleção concluída ${scope}: ${progress.removed}/${progress.total} template(s) removidos.`;
  }

  return `Deleção concluída com falhas ${scope}: ${progress.removed}/${progress.total} template(s) removidos, ${progress.failed} erro(s).`;
}
function buildFlowReplicateSummary(data: FlowReplicateResponse) {
  const hasFailures = data.totals.errors > 0 || data.totals.copied < data.totals.createJobs;

  if (!hasFailures) {
    return `Replicação concluída com sucesso em todos os destinos: ${data.totals.copied}/${data.totals.createJobs} flow(s) copiados.`;
  }

  return `Replicação concluída com falhas: ${data.totals.copied}/${data.totals.createJobs} flow(s) copiados, ${data.totals.errors} erro(s).`;
}
function buildBulkFlowUpdateSummary(
  data: FlowBulkUpdateResponse,
  sourceErrors: number,
  publishAfterUpdate: boolean,
) {
  const hasFailures = sourceErrors > 0 || data.totals.errors > 0 || data.totals.missing > 0;
  const action = publishAfterUpdate ? "Alteração e publicação" : "Alteração";

  if (!hasFailures) {
    return `${action} em massa concluída com sucesso: origem e ${data.totals.updated}/${data.totals.matched} destino(s) atualizados.`;
  }

  return `${action} em massa concluída com pendências: origem ${
    sourceErrors > 0 ? "falhou" : "OK"
  }, ${data.totals.updated}/${data.totals.matched} destino(s) atualizados, ${data.totals.missing} sem match, ${data.totals.errors + sourceErrors} erro(s).`;
}
function getOperationStatus(errorCount: number) {
  return errorCount > 0 ? "warning" : "success";
}
function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
function describeBotCloneStep(step: BotCloneStep) {
  if (step.status === "error") return step.message || "Falha ao clonar.";

  const detail = step.detail || {};
  const errorCount = Array.isArray(detail.errors) ? detail.errors.length : 0;
  const errorSuffix = errorCount > 0 ? `, ${errorCount} erro(s)` : "";

  if (detail.empty) return "Nada para clonar (vazio na origem).";

  switch (step.key) {
    case "tags":
      return `${Number(detail.tags) || 0} tag(s) clonada(s).`;
    case "queues":
      return `${Number(detail.created) || 0} criada(s), ${Number(detail.existing) || 0} já existente(s)${errorSuffix}.`;
    case "attendants":
      return `${Number(detail.cloned) || 0}/${Number(detail.total) || 0} atendente(s) clonado(s)${errorSuffix}.`;
    case "quickReplies":
      return `${Number(detail.cloned) || 0}/${Number(detail.total) || 0} categoria(s) clonada(s)${errorSuffix}.`;
    case "attendanceRules":
      return (
        `${Number(detail.created) || 0} criada(s), ${Number(detail.updated) || 0} atualizada(s), ` +
        `${Number(detail.unchanged) || 0} inalterada(s), ${Number(detail.removed) || 0} removida(s)${errorSuffix}.`
      );
    case "priorityRules":
      return (
        `${Number(detail.queuesCreated) || 0} fila(s) criada(s), ${Number(detail.created) || 0} criada(s), ` +
        `${Number(detail.updated) || 0} atualizada(s), ${Number(detail.unchanged) || 0} inalterada(s), ` +
        `${Number(detail.removed) || 0} removida(s)${errorSuffix}.`
      );
    default:
      return "Concluído com sucesso.";
  }
}
async function lookupBotIdentity(routerKey: string) {
  const data = await postJson<{ identity: string }>("/api/bots/identity", { routerKey });
  return data.identity || "";
}

export default function CreateTemplatesApp() {
  const shellRef = useRef<HTMLElement | null>(null);
  const { isDarkTheme, toggleTheme } = useTheme();
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [flowsLoaded, setFlowsLoaded] = useState(false);
  const [startupError, setStartupError] = useState("");
  const [startupAttempt, setStartupAttempt] = useState(0);
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
  const [isTemplateDeleteModalOpen, setIsTemplateDeleteModalOpen] = useState(false);
  const [templateDeleteMode, setTemplateDeleteMode] = useState<TemplateDeleteMode>("source");
  const [templateDeleteItems, setTemplateDeleteItems] = useState<TemplateDeleteItem[]>([]);
  const [templateDeletePreflight, setTemplateDeletePreflight] =
    useState<TemplateBulkDeleteResponse | null>(null);
  const [templateDeleteSourceKey, setTemplateDeleteSourceKey] = useState("");
  const [templateDeleteTargetKeys, setTemplateDeleteTargetKeys] = useState<string[]>([]);
  const [templateDeleteProgress, setTemplateDeleteProgress] = useState<TemplateDeleteProgress>(
    emptyTemplateDeleteProgress,
  );
  const [templateDeleteJobStates, setTemplateDeleteJobStates] = useState<
    Record<string, TemplateDeleteJobState>
  >({});
  const [isCreateFlowModalOpen, setIsCreateFlowModalOpen] = useState(false);
  const [isEditFlowModalOpen, setIsEditFlowModalOpen] = useState(false);
  const [isBulkFlowMappingModalOpen, setIsBulkFlowMappingModalOpen] = useState(false);
  const [editingFlow, setEditingFlow] = useState<FlowSummary | null>(null);
  const [draftSourceRouterKey, setDraftSourceRouterKey] = useState("");
  const [draftTargetRouterKeys, setDraftTargetRouterKeys] = useState("");
  const [routerApplications, setRouterApplications] = useState<PortalApplicationAccount[]>([]);
  const [routerApplicationsError, setRouterApplicationsError] = useState("");
  const [routerApplicationSearch, setRouterApplicationSearch] = useState("");
  const [routerDirectorySearch, setRouterDirectorySearch] = useState("");
  const [isLoadingRouterApplications, setIsLoadingRouterApplications] = useState(false);
  const [routerKeyActionId, setRouterKeyActionId] = useState("");
  const [currentApplicationRouter, setCurrentApplicationRouter] =
    useState<CurrentApplicationRouter | null>(null);
  const [newFlowName, setNewFlowName] = useState("");
  const [newFlowIsApi, setNewFlowIsApi] = useState(false);
  const [newFlowEndpointUri, setNewFlowEndpointUri] = useState("");
  const [newFlowBusinessPublicKey, setNewFlowBusinessPublicKey] = useState("");
  const [newFlowJson, setNewFlowJson] = useState("");
  const [replicateFlowBusinessPublicKey, setReplicateFlowBusinessPublicKey] = useState("");
  const [editFlowName, setEditFlowName] = useState("");
  const [editFlowEndpointUri, setEditFlowEndpointUri] = useState("");
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
  const [isInspectingTemplateDeletion, setIsInspectingTemplateDeletion] = useState(false);
  const [isDeletingTemplates, setIsDeletingTemplates] = useState(false);
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
  const [botSourceRouterKey, setBotSourceRouterKey] = useState("");
  const [botTargetRouterKey, setBotTargetRouterKey] = useState("");
  const [botSourceIdentity, setBotSourceIdentity] = useState<BotIdentityLookup>(IDLE_BOT_IDENTITY);
  const [botTargetIdentity, setBotTargetIdentity] = useState<BotIdentityLookup>(IDLE_BOT_IDENTITY);
  const [botSourceKeyInvalid, setBotSourceKeyInvalid] = useState(false);
  const [botTargetKeyInvalid, setBotTargetKeyInvalid] = useState(false);
  const [botCloneOptions, setBotCloneOptions] =
    useState<BotCloneOptions>(DEFAULT_BOT_CLONE_OPTIONS);
  const [isCloningBot, setIsCloningBot] = useState(false);
  const [botCloneResult, setBotCloneResult] = useState<BotCloneResponse | null>(null);
  const [visibleBotStepCount, setVisibleBotStepCount] = useState(0);
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
  const pageOperationResult =
    visibleActiveView !== "devs" && operationResult?.view === visibleActiveView
      ? operationResult
      : null;
  const activeModalId = routerModal
    ? "router"
    : isBulkFlowMappingModalOpen
      ? "bulk-flow-mapping"
      : isEditFlowModalOpen
        ? "edit-flow"
        : isCreateFlowModalOpen
          ? "create-flow"
          : isTemplateDeleteModalOpen
            ? "template-delete"
            : isTemplateCompareModalOpen
              ? "template-compare"
              : null;

  useEffect(() => {
    if (!isEmbedded) return;

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
    if (!isEmbedded) return;

    let cancelled = false;

    async function loadCurrentApplication() {
      setIsLoadingCurrentApplication(true);
      setStartupError("");

      try {
        const response = await getCurrentApplication();
        if (cancelled) return;

        const router = extractCurrentApplicationRouter(response);

        if (!router?.shortName)
          throw new Error(
            "O Portal não informou o router atual. Selecione a origem para continuar.",
          );
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

        setStartupError(
          "Não foi possível conectar ao router atual. Tente novamente ou selecione a origem manualmente.",
        );
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
  }, [isEmbedded, startupAttempt]);

  const targetCount = isEmbedded
    ? removeRouterSelection(targetRouterShortNames, sourceRouterShortName).length
    : removeRouterSelection(splitLines(targetRouterKeys), sourceRouterKey).length;
  const draftTargetRouterSet = useMemo(
    () =>
      new Set(
        removeRouterSelection(
          splitLines(draftTargetRouterKeys),
          routerModal === "targets" && isEmbedded ? sourceRouterShortName : "",
        ),
      ),
    [draftTargetRouterKeys, isEmbedded, routerModal, sourceRouterShortName],
  );

  const selectedTemplates = useMemo(
    () => templateSearchResult.templates.filter((t) => selectedTemplateKeys.has(templateKey(t))),
    [templateSearchResult.templates, selectedTemplateKeys],
  );
  const selectedTemplateDeleteItems = useMemo(
    () => getTemplateDeleteItems(selectedTemplates),
    [selectedTemplates],
  );
  const allVisibleTemplatesSelected =
    templateSearchResult.templates.length > 0 &&
    selectedTemplates.length === templateSearchResult.templates.length;
  const templateDeleteRunnableCount =
    templateDeleteMode === "source"
      ? templateDeleteItems.length
      : templateDeleteItems.length + (templateDeletePreflight?.matches.length ?? 0);
  const templateDeleteProgressTotal = templateDeleteProgress.total || templateDeleteRunnableCount;
  const templateDeleteProgressPercent =
    templateDeleteProgress.total > 0
      ? Math.round((templateDeleteProgress.processed / templateDeleteProgress.total) * 100)
      : 0;
  const hasTemplateDeleteStarted = templateDeleteProgress.total > 0;

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
  const selectedFlowsIncludeApi = selectedFlows.some(
    (flow) => flow.isFlowApi || Boolean(flow.endpoint_uri),
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

  const filteredDirectoryRouterApplications = useMemo(() => {
    const q = routerDirectorySearch.trim().toLowerCase();
    if (!q) return routerApplications;

    return routerApplications.filter(
      (application) =>
        application.name.toLowerCase().includes(q) ||
        application.shortName.toLowerCase().includes(q) ||
        application.tenantId?.toLowerCase().includes(q),
    );
  }, [routerApplications, routerDirectorySearch]);

  const sourceRouterApplication = useMemo(() => {
    const selectedShortName = sourceRouterShortName.trim();
    if (!selectedShortName) return null;

    const listedApplication = routerApplications.find(
      (application) => application.shortName === selectedShortName,
    );
    if (listedApplication) return listedApplication;

    if (currentApplicationRouter?.shortName === selectedShortName) {
      return {
        shortName: currentApplicationRouter.shortName,
        name: currentApplicationRouter.name || currentApplicationRouter.shortName,
        imageUri: currentApplicationRouter.imageUri,
      };
    }

    return null;
  }, [currentApplicationRouter, routerApplications, sourceRouterShortName]);

  const sourceRouterDisplayName =
    sourceRouterApplication?.name ||
    sourceRouterShortName ||
    (sourceRouterKey.trim() ? "Router configurado" : "Nenhum router selecionado");
  const sourceRouterDisplayId = sourceRouterShortName || maskRouterKey(sourceRouterKey);

  const headerCopy =
    visibleActiveView === "routers"
      ? {
          title: "Routers",
          description: "Routers aos quais você tem acesso no Portal BLiP",
        }
      : visibleActiveView === "templates"
        ? {
            title: "Templates",
            description: "Replicação de templates entre routers BLiP",
          }
        : visibleActiveView === "flows"
          ? {
              title: "Flows",
              description: "Consulta, visualização e cópia de flows entre routers BLiP",
            }
          : visibleActiveView === "bots"
            ? {
                title: "Bots",
                description:
                  "Clonagem de fluxo, filas, regras, atendentes, tags, respostas prontas e variáveis entre bots",
              }
            : devsTab === "plugins"
              ? {
                  title: "Devs",
                  description: "Gerenciamento e cópia de plugins entre routers BLiP",
                }
              : {
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
        setRouterApplicationsError("");
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

  function openRoutersView() {
    setActiveView("routers");
    setError("");
    setCopyNotice("");
    void loadRouterApplications();
  }

  async function handleCopyRouterId(application: PortalApplicationAccount) {
    setError("");

    try {
      await copyText(application.shortName);
      setCopyNotice(`ID de "${application.name}" copiado.`);
      window.setTimeout(() => setCopyNotice(""), 2400);
    } catch (caughtError) {
      setCopyNotice("");
      setError(getErrorMessage(caughtError, "Erro ao copiar o ID do router."));
    }
  }

  async function handleCopyRouterKey(application: PortalApplicationAccount) {
    setError("");
    setCopyNotice("");
    setRouterKeyActionId(application.shortName);

    try {
      const key =
        currentApplicationRouter?.shortName === application.shortName &&
        currentApplicationRouter.accessKey
          ? buildRouterKey(application.shortName, currentApplicationRouter.accessKey)
          : (await loadRouterKey(application.shortName)).key;

      await copyText(key);
      setCopyNotice(`Key de "${application.name}" copiada.`);
      window.setTimeout(() => setCopyNotice(""), 2400);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError, "Erro ao gerar a key do router."));
    } finally {
      setRouterKeyActionId("");
    }
  }

  function hasSourceRouterSelection() {
    return isEmbedded
      ? Boolean(sourceRouterShortName || sourceRouterKey.trim())
      : Boolean(sourceRouterKey.trim());
  }

  function hasTargetRouterSelection() {
    return isEmbedded
      ? removeRouterSelection(targetRouterShortNames, sourceRouterShortName).length > 0 ||
          removeRouterSelection(splitLines(targetRouterKeys), sourceRouterKey).length > 0
      : removeRouterSelection(splitLines(targetRouterKeys), sourceRouterKey).length > 0;
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
    const blockedSourceKey = sourceRouterKey.trim();
    const cachedKeys = removeRouterSelection(splitLines(targetRouterKeys), blockedSourceKey);

    if (!isEmbedded) return cachedKeys;
    if (cachedKeys.length > 0) return cachedKeys;
    const allowedTargetShortNames = removeRouterSelection(
      targetRouterShortNames,
      sourceRouterShortName,
    );
    if (allowedTargetShortNames.length === 0) return [];

    const routers: ResolvedRouterKey[] = [];

    for (const shortName of allowedTargetShortNames) {
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
      setTemplatesLoaded(true);
      setSelectedTemplateKeys(
        data.templates.length === 1 ? new Set([templateKey(data.templates[0])]) : new Set(),
      );
    } catch (e) {
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
        summary: buildTemplateReplicateSummary(data),
        payload: data,
        status: getOperationStatus(
          data.totals.errors + (data.totals.created < data.totals.createJobs ? 1 : 0),
        ),
        view: "templates",
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

  function closeTemplateDeleteModal(options: { force?: boolean } = {}) {
    if (isDeletingTemplates && !options.force) return;

    setIsTemplateDeleteModalOpen(false);
    setTemplateDeletePreflight(null);
    setTemplateDeleteItems([]);
    setTemplateDeleteSourceKey("");
    setTemplateDeleteTargetKeys([]);
    setTemplateDeleteProgress(emptyTemplateDeleteProgress);
    setTemplateDeleteJobStates({});
    setError("");
  }

  function getTemplateDeleteJobKey(targetIndex: number | undefined, templateName: string) {
    const routerKey = typeof targetIndex === "number" ? `target:${targetIndex}` : "source";
    return `${routerKey}|${normalizeTemplateDeleteName(templateName)}`;
  }

  function getTemplateDeleteRouterLabel(targetIndex?: number) {
    return typeof targetIndex === "number" ? getTargetRouterLabel(targetIndex) : "Origem";
  }

  function renderTemplateDeleteStatus(
    jobState: TemplateDeleteJobState | undefined,
    fallbackLabel: string,
    fallbackClassName: string,
  ) {
    if (jobState?.status === "running") {
      return (
        <span className="ember-status pending">
          <LoaderCircle className="spin status-spinner" size={12} aria-hidden="true" />
          Removendo
        </span>
      );
    }

    if (jobState?.status === "success") {
      return <span className="ember-status published">Removido</span>;
    }

    if (jobState?.status === "error") {
      return <span className="ember-status failed">Erro</span>;
    }

    return <span className={`ember-status ${fallbackClassName}`}>{fallbackLabel}</span>;
  }

  function buildSourceTemplateDeleteJobs() {
    return templateDeleteItems
      .map((template) => ({
        key: getTemplateDeleteJobKey(undefined, template.name),
        routerKey: templateDeleteSourceKey,
        routerLabel: "Origem",
        templateName: template.name,
      }))
      .filter((job) => job.routerKey);
  }

  function buildBulkTemplateDeleteJobs() {
    if (!templateDeletePreflight) return [];

    const targetJobs = templateDeletePreflight.matches
      .map((match) => {
        const routerKey = templateDeleteTargetKeys[match.targetIndex] || "";

        return {
          key: getTemplateDeleteJobKey(match.targetIndex, match.templateName),
          routerKey,
          routerLabel: getTargetRouterLabel(match.targetIndex),
          targetIndex: match.targetIndex,
          templateName: match.templateName,
        };
      })
      .filter((job) => job.routerKey);

    return [...buildSourceTemplateDeleteJobs(), ...targetJobs];
  }

  function buildTemplateDeleteJobs(): TemplateDeleteJob[] {
    return templateDeleteMode === "source"
      ? buildSourceTemplateDeleteJobs()
      : buildBulkTemplateDeleteJobs();
  }

  function removeDeletedTemplatesFromSource(templateNames: string[]) {
    const deletedNames = new Set(templateNames.map(normalizeTemplateDeleteName));

    setTemplateSearchResult((current) => {
      const templates = current.templates.filter(
        (template) => !deletedNames.has(normalizeTemplateDeleteName(template.name)),
      );

      return {
        ...current,
        total: templates.length,
        templates,
      };
    });
    setSelectedTemplateKeys((current) => {
      const next = new Set<string>();

      for (const key of current) {
        const [templateNameFromKey] = key.split("|");

        if (!deletedNames.has(normalizeTemplateDeleteName(templateNameFromKey || ""))) {
          next.add(key);
        }
      }

      return next;
    });
  }

  async function handleOpenSourceTemplateDeleteModal() {
    setError("");
    setOperationResult(null);

    if (selectedTemplateDeleteItems.length === 0) {
      setError("Selecione pelo menos um template.");
      return;
    }

    if (!hasSourceRouterSelection()) {
      setError("Informe o router de origem.");
      openSourceModal();
      return;
    }

    setTemplateDeleteMode("source");
    setIsInspectingTemplateDeletion(true);

    try {
      const sourceKey = await ensureSourceRouterKey();

      setTemplateDeleteItems(selectedTemplateDeleteItems);
      setTemplateDeleteSourceKey(sourceKey);
      setTemplateDeleteTargetKeys([]);
      setTemplateDeletePreflight(null);
      setTemplateDeleteProgress(emptyTemplateDeleteProgress);
      setTemplateDeleteJobStates({});
      setIsTemplateDeleteModalOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao preparar deleção de templates.");
    } finally {
      setIsInspectingTemplateDeletion(false);
    }
  }

  async function handleOpenBulkTemplateDeleteModal() {
    setError("");
    setOperationResult(null);

    if (selectedTemplateDeleteItems.length === 0) {
      setError("Selecione pelo menos um template.");
      return;
    }

    if (!hasSourceRouterSelection()) {
      setError("Informe o router de origem.");
      openSourceModal();
      return;
    }

    if (!hasTargetRouterSelection()) {
      setError("Informe pelo menos um router de destino.");
      openTargetsModal();
      return;
    }

    setTemplateDeleteMode("bulk");
    setIsInspectingTemplateDeletion(true);

    try {
      const sourceKey = await ensureSourceRouterKey();
      const targets = await ensureTargetRouterKeys();
      const preflight = await postJson<TemplateBulkDeleteResponse>("/api/templates/bulk-delete", {
        targetRouterKeys: targets,
        templates: selectedTemplates,
        batchSize: DEFAULT_TEMPLATE_OPTIONS.batchSize,
        dryRun: true,
      });

      setTemplateDeleteItems(selectedTemplateDeleteItems);
      setTemplateDeleteTargetKeys(targets);
      setTemplateDeleteSourceKey(sourceKey);
      setTemplateDeletePreflight(preflight);
      setTemplateDeleteProgress(emptyTemplateDeleteProgress);
      setTemplateDeleteJobStates({});
      setIsTemplateDeleteModalOpen(true);
    } catch (e) {
      setTemplateDeletePreflight(null);
      setError(e instanceof Error ? e.message : "Erro ao verificar templates nos destinos.");
    } finally {
      setIsInspectingTemplateDeletion(false);
    }
  }

  async function handleConfirmTemplateDelete() {
    setError("");

    const jobs = buildTemplateDeleteJobs();

    if (jobs.length === 0) {
      setError("Nenhum template encontrado para deletar.");
      return;
    }

    const currentMode = templateDeleteMode;
    const initialJobStates = jobs.reduce<Record<string, TemplateDeleteJobState>>((acc, job) => {
      acc[job.key] = { status: "pending" };
      return acc;
    }, {});
    const deleted: TemplateDeleteResponse[] = [];
    const errors: TemplateDeleteError[] = [];

    setIsDeletingTemplates(true);
    setTemplateDeleteProgress({
      total: jobs.length,
      processed: 0,
      removed: 0,
      failed: 0,
    });
    setTemplateDeleteJobStates(initialJobStates);

    for (const job of jobs) {
      setTemplateDeleteJobStates((current) => ({
        ...current,
        [job.key]: { status: "running" },
      }));

      try {
        const result = await postJson<TemplateDeleteResponse>("/api/templates/delete", {
          routerKey: job.routerKey,
          templateName: job.templateName,
          targetIndex: job.targetIndex,
        });

        deleted.push(result);
        setTemplateDeleteJobStates((current) => ({
          ...current,
          [job.key]: { status: "success" },
        }));
        setTemplateDeleteProgress((current) => ({
          ...current,
          processed: current.processed + 1,
          removed: current.removed + 1,
        }));
      } catch (caughtError) {
        const message = getErrorMessage(caughtError, "Erro ao deletar template.");

        errors.push({
          step: "delete_template",
          targetIndex: job.targetIndex,
          templateName: job.templateName,
          message,
        });
        setTemplateDeleteJobStates((current) => ({
          ...current,
          [job.key]: { status: "error", message },
        }));
        setTemplateDeleteProgress((current) => ({
          ...current,
          processed: current.processed + 1,
          failed: current.failed + 1,
        }));
      }
    }

    const finalProgress = {
      total: jobs.length,
      processed: jobs.length,
      removed: deleted.length,
      failed: errors.length,
    };

    setTemplateDeleteProgress(finalProgress);

    const sourceDeletedTemplateNames = deleted
      .filter((item) => item.targetIndex === undefined)
      .map((item) => item.templateName);

    if (sourceDeletedTemplateNames.length > 0) {
      removeDeletedTemplatesFromSource(sourceDeletedTemplateNames);
    }

    setOperationResult({
      summary: buildTemplateDeleteSummary(currentMode, finalProgress),
      payload: {
        mode: currentMode,
        preflight: templateDeletePreflight,
        deleted,
        errors,
      },
      status: errors.length > 0 ? "warning" : "success",
      view: "templates",
    });
    setIsDeletingTemplates(false);
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
    setFlowsLoaded(true);
    setSelectedFlowIds(data.flows.length === 1 ? new Set([flowKey(data.flows[0])]) : new Set());
    setReplicateFlowBusinessPublicKey("");
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
    setEditFlowName(flow.name);
    setEditFlowEndpointUri(flow.endpoint_uri || "");
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
    setEditFlowName("");
    setEditFlowEndpointUri("");
    setEditFlowJson("");
    setEditFlowPublishAfterSave(false);
    setIsBulkFlowMappingModalOpen(false);
    setBulkFlowPreflight(null);
    setBulkFlowSelections({});
    setIsLoadingEditFlowJson(false);
    setError("");
  }

  function getEditedFlowMetadata() {
    if (!editingFlow) return null;

    const name = editFlowName.trim();
    const endpointUri = editFlowEndpointUri.trim();
    const isFlowApi = Boolean(editingFlow.isFlowApi || editingFlow.endpoint_uri);

    if (!name) {
      setError("Informe o nome do flow.");
      return null;
    }

    if (isFlowApi && !endpointUri) {
      setError("Informe o endpoint da API do flow.");
      return null;
    }

    return {
      name,
      endpointUri,
      isFlowApi,
      metadataChanged:
        name !== editingFlow.name.trim() || endpointUri !== (editingFlow.endpoint_uri || "").trim(),
    };
  }

  function getFlowMetadataUpdates(
    editedMetadata: NonNullable<ReturnType<typeof getEditedFlowMetadata>>,
  ) {
    if (!editingFlow || !editedMetadata.metadataChanged) return undefined;

    return [
      {
        sourceFlowId: editingFlow.id,
        name: editedMetadata.name,
        endpointUri: editedMetadata.endpointUri,
        isFlowApi: editedMetadata.isFlowApi,
      },
    ];
  }

  async function handleSaveEditedFlow() {
    if (!editingFlow) return;

    setError("");

    const editedMetadata = getEditedFlowMetadata();
    if (!editedMetadata) return;

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
      const metadataData = editedMetadata.metadataChanged
        ? await postJson<FlowUpdateMetadataResponse>("/api/flows/update-metadata", {
            sourceRouterKey: sourceKey,
            flowId: editingFlow.id,
            name: editedMetadata.name,
            isFlowApi: editedMetadata.isFlowApi,
            endpointUri: editedMetadata.endpointUri,
          })
        : null;
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
      const nextFlow = {
        ...editingFlow,
        name: editedMetadata.name,
        endpoint_uri: editedMetadata.isFlowApi ? editedMetadata.endpointUri : undefined,
        isFlowApi: editedMetadata.isFlowApi,
        status: nextStatus,
      };

      if (publishAfterUpdate) {
        await loadFlowsFromSource(sourceKey);
      } else {
        setFlowSearchResult((current) => ({
          ...current,
          flows: current.flows.map((flow) => (flow.id === editingFlow.id ? nextFlow : flow)),
        }));
      }
      setOperationResult({
        summary: publishAfterUpdate
          ? `Flow "${editedMetadata.name}" atualizado e publicado.`
          : isPublishedFlow(editingFlow)
            ? `Flow "${editedMetadata.name}" atualizado e retornou para draft.`
            : `Flow "${editedMetadata.name}" atualizado em draft.`,
        payload: { metadata: metadataData, update: data, publish: publishData },
        previewFlow: nextFlow,
        status: "success",
        view: "flows",
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

    const editedMetadata = getEditedFlowMetadata();
    if (!editedMetadata) return;

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
      const metadataUpdates = getFlowMetadataUpdates(editedMetadata);
      const preflight = await postJson<FlowBulkUpdateResponse>("/api/flows/bulk-update-json", {
        targetRouterKeys: targets,
        flows: [{ id: editingFlow.id, name: editingFlow.name }],
        flowJson: parsedJson,
        publishAfterUpdate: editFlowPublishAfterSave,
        ...(metadataUpdates ? { metadataUpdates } : {}),
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

    const editedMetadata = getEditedFlowMetadata();
    if (!editedMetadata) return;

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
      const metadataUpdates = getFlowMetadataUpdates(editedMetadata);
      const requestBody = {
        targetRouterKeys: targets,
        flows: [{ id: editingFlow.id, name: editingFlow.name }],
        flowJson: parsedJson,
        publishAfterUpdate,
        ...(metadataUpdates ? { metadataUpdates } : {}),
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
      const sourceResult: {
        metadata: FlowUpdateMetadataResponse | null;
        update: FlowUpdateJsonResponse | null;
        publish: FlowPublishResponse | null;
        errors: FlowBulkUpdateError[];
      } = {
        metadata: null,
        update: null,
        publish: null,
        errors: [],
      };

      let sourceMetadataSucceeded = true;
      if (editedMetadata.metadataChanged) {
        try {
          sourceResult.metadata = await postJson<FlowUpdateMetadataResponse>(
            "/api/flows/update-metadata",
            {
              sourceRouterKey: sourceKey,
              flowId: editingFlow.id,
              name: editedMetadata.name,
              isFlowApi: editedMetadata.isFlowApi,
              endpointUri: editedMetadata.endpointUri,
            },
          );
        } catch (caughtError) {
          sourceMetadataSucceeded = false;
          sourceResult.errors.push({
            step: "update_source_flow_metadata",
            flowId: editingFlow.id,
            flowName: editingFlow.name,
            message: getErrorMessage(caughtError, "Erro ao atualizar nome ou endpoint do flow."),
          });
        }
      }

      if (sourceMetadataSucceeded) {
        try {
          sourceResult.update = await postJson<FlowUpdateJsonResponse>("/api/flows/update-json", {
            sourceRouterKey: sourceKey,
            flowId: editingFlow.id,
            flowJson: parsedJson,
          });
        } catch (caughtError) {
          sourceResult.errors.push({
            step: "update_source_flow",
            flowId: editingFlow.id,
            flowName: editingFlow.name,
            message: getErrorMessage(caughtError, "Erro ao atualizar flow de origem."),
          });
        }
      }

      if (publishAfterUpdate && sourceResult.update) {
        try {
          sourceResult.publish = await postJson<FlowPublishResponse>("/api/flows/publish", {
            sourceRouterKey: sourceKey,
            flowId: editingFlow.id,
          });
        } catch (caughtError) {
          sourceResult.errors.push({
            step: "publish_source_flow",
            flowId: editingFlow.id,
            flowName: editingFlow.name,
            message: getErrorMessage(caughtError, "Erro ao publicar flow de origem."),
          });
        }
      }
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
      const nextStatus = sourceResult.publish
        ? "PUBLISHED"
        : sourceResult.update
          ? "DRAFT"
          : editingFlow.status;
      const nextFlow = {
        ...editingFlow,
        name: editedMetadata.name,
        endpoint_uri: editedMetadata.isFlowApi ? editedMetadata.endpointUri : undefined,
        isFlowApi: editedMetadata.isFlowApi,
        status: nextStatus,
      };
      const summary = buildBulkFlowUpdateSummary(
        data,
        sourceResult.errors.length,
        publishAfterUpdate,
      );

      if (sourceResult.publish) {
        await loadFlowsFromSource(sourceKey);
      } else if (sourceResult.update) {
        setFlowSearchResult((current) => ({
          ...current,
          flows: current.flows.map((flow) => (flow.id === editingFlow.id ? nextFlow : flow)),
        }));
      }
      setOperationResult({
        summary,
        payload: {
          source: sourceResult,
          targets: data,
        },
        previewFlow: nextFlow,
        status: getOperationStatus(
          sourceResult.errors.length + data.totals.errors + data.totals.missing,
        ),
        view: "flows",
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
        status: "success",
        view: "flows",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao publicar flow.");
    } finally {
      setFlowActionId("");
    }
  }

  async function handleDeprecateFlow(flow: FlowSummary) {
    setError("");

    const confirmed = await confirmFlowAction(
      "Confirmar desativação",
      `Ao prosseguir, o flow <b>${escapeHtml(flow.name || flow.id)}</b> será desativado.`,
      "Desativar",
    );

    if (!confirmed) return;

    setFlowActionId(`deprecate:${flow.id}`);
    try {
      const sourceKey = await ensureSourceRouterKey();
      const data = await postJson<FlowDeprecateResponse>("/api/flows/deprecate", {
        sourceRouterKey: sourceKey,
        flowId: flow.id,
      });

      setFlowSearchResult((current) => ({
        ...current,
        flows: current.flows.map((currentFlow) =>
          currentFlow.id === flow.id ? { ...currentFlow, status: "DEPRECATED" } : currentFlow,
        ),
      }));
      setOperationResult({
        summary: `Flow "${flow.name}" desativado com sucesso.`,
        payload: data,
        status: "success",
        view: "flows",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao desativar flow.");
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
    if (newFlowIsApi && !newFlowBusinessPublicKey.trim()) {
      setError("Informe a business_public_key para Flow API.");
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
        ...(newFlowIsApi ? { businessPublicKey: newFlowBusinessPublicKey.trim() } : {}),
        flowJson: parsedJson,
      });
      setIsCreateFlowModalOpen(false);
      setNewFlowName("");
      setNewFlowIsApi(false);
      setNewFlowEndpointUri("");
      setNewFlowBusinessPublicKey("");
      setNewFlowJson("");
      setFlowFilter(data.flow.name);
      await loadFlowsFromSource(sourceKey);
      setOperationResult({
        summary: `Flow criado com sucesso. ID: ${data.flow.id}`,
        payload: data,
        previewFlow: data.flow,
        status: "success",
        view: "flows",
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
    if (selectedFlowsIncludeApi && !replicateFlowBusinessPublicKey.trim()) {
      setError("Informe a business_public_key para replicar Flow API.");
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
        ...(selectedFlowsIncludeApi
          ? { businessPublicKey: replicateFlowBusinessPublicKey.trim() }
          : {}),
        ...DEFAULT_FLOW_OPTIONS,
      });
      setOperationResult({
        summary: buildFlowReplicateSummary(data),
        payload: data,
        status: getOperationStatus(
          data.totals.errors + (data.totals.copied < data.totals.createJobs ? 1 : 0),
        ),
        view: "flows",
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

  useEffect(() => {
    const routerKey = botSourceRouterKey.trim();
    if (!routerKey) {
      setBotSourceIdentity(IDLE_BOT_IDENTITY);
      return;
    }

    let cancelled = false;
    setBotSourceIdentity({ status: "loading", identity: "" });
    const timeoutId = window.setTimeout(() => {
      lookupBotIdentity(routerKey)
        .then((identity) => {
          if (cancelled) return;
          setBotSourceIdentity(
            identity ? { status: "success", identity } : { status: "error", identity: "" },
          );
        })
        .catch(() => {
          if (!cancelled) setBotSourceIdentity({ status: "error", identity: "" });
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [botSourceRouterKey]);

  useEffect(() => {
    const routerKey = botTargetRouterKey.trim();
    if (!routerKey) {
      setBotTargetIdentity(IDLE_BOT_IDENTITY);
      return;
    }

    let cancelled = false;
    setBotTargetIdentity({ status: "loading", identity: "" });
    const timeoutId = window.setTimeout(() => {
      lookupBotIdentity(routerKey)
        .then((identity) => {
          if (cancelled) return;
          setBotTargetIdentity(
            identity ? { status: "success", identity } : { status: "error", identity: "" },
          );
        })
        .catch(() => {
          if (!cancelled) setBotTargetIdentity({ status: "error", identity: "" });
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [botTargetRouterKey]);

  useEffect(() => {
    if (!botCloneResult || botCloneResult.steps.length === 0) {
      setVisibleBotStepCount(0);
      return;
    }

    setVisibleBotStepCount(1);
    if (botCloneResult.steps.length <= 1) return;

    let shown = 1;
    const intervalId = window.setInterval(() => {
      shown += 1;
      setVisibleBotStepCount(shown);
      if (shown >= botCloneResult.steps.length) {
        window.clearInterval(intervalId);
      }
    }, 500);

    return () => window.clearInterval(intervalId);
  }, [botCloneResult]);

  async function handleCloneBot(event: FormEvent) {
    event.preventDefault();
    setError("");
    setOperationResult(null);
    setBotCloneResult(null);

    const sourceKey = botSourceRouterKey.trim();
    const targetKey = botTargetRouterKey.trim();

    setBotSourceKeyInvalid(!sourceKey);
    setBotTargetKeyInvalid(!targetKey);

    if (!sourceKey) {
      setError("Informe a bot key de origem.");
      return;
    }

    if (!targetKey) {
      setError("Informe a bot key de destino.");
      return;
    }

    const selectedKeys = BOT_CLONE_OPTION_KEYS.filter((key) => botCloneOptions[key]);

    if (selectedKeys.length === 0) {
      setError("Selecione pelo menos um item para clonar.");
      return;
    }

    const hasDestructiveStep = selectedKeys.some((key) => BOT_CLONE_DESTRUCTIVE_KEYS.includes(key));

    if (hasDestructiveStep) {
      const confirmed = await confirmFlowAction(
        "Confirmar clonagem de bot",
        "Regras de atendimento e/ou de priorização funcionam como espelho: itens que existirem só no bot de destino serão <b>removidos</b>. Deseja continuar?",
        "Clonar mesmo assim",
      );

      if (!confirmed) return;
    }

    setIsCloningBot(true);
    try {
      const data = await postJson<BotCloneResponse>("/api/bots/clone", {
        sourceRouterKey: sourceKey,
        targetRouterKey: targetKey,
        options: botCloneOptions,
      });

      setBotCloneResult(data);
      setOperationResult({
        summary: `Clonagem concluída: ${data.totals.succeeded}/${data.totals.requested} etapa(s) ok${
          data.totals.failed ? `, ${data.totals.failed} com erro` : ""
        }.`,
        payload: data,
        status: data.totals.failed > 0 ? "warning" : "success",
        view: "bots",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao clonar bot.");
    } finally {
      setIsCloningBot(false);
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
    setTemplatesLoaded(false);
    setFlowsLoaded(false);
    setTemplateSearchResult(emptyTemplateSearch);
    setSelectedTemplateKeys(new Set());
    setFlowSearchResult(emptyFlowSearch);
    setSelectedFlowIds(new Set());
    setFlowFilter("");
    setReplicateFlowBusinessPublicKey("");
  }
  function clearResults() {
    clearTemplateAndFlowResults();
    clearPluginManagerState();
    closeTemplateDeleteModal({ force: true });
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
    setDraftTargetRouterKeys(
      isEmbedded
        ? removeRouterSelection(targetRouterShortNames, sourceRouterShortName).join("\n")
        : removeRouterSelectionFromLines(targetRouterKeys, sourceRouterKey),
    );
    setRouterApplicationSearch("");
    if (isEmbedded) void loadRouterApplications();
    setRouterModal("targets");
  }
  function closeRouterModal() {
    setRouterModal(null);
  }

  function closeActiveModal() {
    switch (activeModalId) {
      case "router":
        closeRouterModal();
        return;
      case "bulk-flow-mapping":
        closeBulkFlowMappingModal();
        return;
      case "edit-flow":
        closeEditFlowModal();
        return;
      case "create-flow":
        if (!isCreatingFlow) setIsCreateFlowModalOpen(false);
        return;
      case "template-delete":
        closeTemplateDeleteModal();
        return;
      case "template-compare":
        setIsTemplateCompareModalOpen(false);
        return;
      default:
        return;
    }
  }

  useModalFocus(activeModalId, closeActiveModal);
  function saveSourceRouter() {
    const selectedShortName = draftSourceRouterKey.trim();

    setError("");
    setRouterApplicationsError("");
    if (selectedShortName) setStartupError("");

    if (!isEmbedded) {
      const sourceChanged = selectedShortName !== sourceRouterKey.trim();

      setSourceRouterKey(selectedShortName);
      setSourceRouterShortName("");
      setTargetRouterKeys((current) => removeRouterSelectionFromLines(current, selectedShortName));
      if (sourceChanged) clearTemplateAndFlowResults();
      clearPluginManagerState();
      setRouterModal(null);
      return;
    }

    const sourceChanged = selectedShortName !== sourceRouterShortName;

    setSourceRouterShortName(selectedShortName);
    setSourceRouterKey("");
    setTargetRouterShortNames((current) => removeRouterSelection(current, selectedShortName));
    setTargetRouterKeys("");
    if (sourceChanged) clearTemplateAndFlowResults();
    clearPluginManagerState();
    setRouterModal(null);
  }
  function saveTargetRouters() {
    const selectedShortNames = isEmbedded
      ? removeRouterSelection(splitLines(draftTargetRouterKeys), sourceRouterShortName)
      : removeRouterSelection(splitLines(draftTargetRouterKeys), sourceRouterKey);

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
    if (shortName.trim() === sourceRouterShortName.trim()) return;

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
    const blockedTargetShortName = isSourcePicker ? "" : sourceRouterShortName.trim();

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
          <Button
            variant="secondary"
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
          </Button>
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
          <Feedback
            title="Não foi possível carregar os routers"
            action={
              <Button
                onClick={() => void loadRouterApplications()}
                loading={isLoadingRouterApplications}
              >
                Tentar novamente
              </Button>
            }
          >
            {routerApplicationsError}
          </Feedback>
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
                const blockedAsTarget = application.shortName === blockedTargetShortName;
                const selected = isSourcePicker
                  ? draftSourceRouterKey === application.shortName
                  : !blockedAsTarget && draftTargetRouterSet.has(application.shortName);

                return (
                  <label
                    key={application.shortName}
                    className={`router-application-option ${selected ? "selected" : ""} ${
                      blockedAsTarget ? "disabled" : ""
                    }`}
                    title={
                      blockedAsTarget
                        ? "Router de origem não pode ser selecionado como destino."
                        : undefined
                    }
                    aria-disabled={blockedAsTarget || undefined}
                  >
                    <input
                      type={isSourcePicker ? "radio" : "checkbox"}
                      name={isSourcePicker ? "source-router-application" : undefined}
                      checked={selected}
                      disabled={blockedAsTarget}
                      onChange={() => {
                        if (isSourcePicker) {
                          setDraftSourceRouterKey(application.shortName);
                          setDraftTargetRouterKeys((current) =>
                            removeRouterSelectionFromLines(current, application.shortName),
                          );
                          return;
                        }

                        if (blockedAsTarget) return;
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

  const shellClassName = ["ember-shell", isEmbedded ? "ember-shell--embedded" : ""]
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
            className={visibleActiveView === "routers" ? "active" : ""}
            type="button"
            onClick={openRoutersView}
            aria-current={visibleActiveView === "routers" ? "page" : undefined}
          >
            <Network size={18} aria-hidden="true" />
            Routers
          </button>
          <button
            className={visibleActiveView === "templates" ? "active" : ""}
            type="button"
            onClick={() => setActiveView("templates")}
            aria-current={visibleActiveView === "templates" ? "page" : undefined}
          >
            <MessageSquareText size={18} aria-hidden="true" />
            Templates
          </button>
          <button
            className={visibleActiveView === "flows" ? "active" : ""}
            type="button"
            onClick={() => setActiveView("flows")}
            aria-current={visibleActiveView === "flows" ? "page" : undefined}
          >
            <FileJson size={18} aria-hidden="true" />
            Flows
          </button>
          <button
            className={visibleActiveView === "bots" ? "active" : ""}
            type="button"
            onClick={() => setActiveView("bots")}
            aria-current={visibleActiveView === "bots" ? "page" : undefined}
          >
            <Bot size={18} aria-hidden="true" />
            Bots
          </button>
          {canAccessDevs && (
            <button
              className={visibleActiveView === "devs" ? "active" : ""}
              type="button"
              onClick={() => setActiveView("devs")}
              aria-current={visibleActiveView === "devs" ? "page" : undefined}
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
              <h1>{headerCopy.title}</h1>
              <p>{headerCopy.description}</p>
            </div>
          </div>
          <div className="ember-header-actions">
            {visibleActiveView !== "bots" && (
              <div className="router-summary">
                <span className="router-summary-label">Router de origem</span>
                <div className="router-summary-main">
                  {hasSourceRouterSelection() && (
                    <span className="router-summary-avatar" aria-hidden="true">
                      {sourceRouterApplication?.imageUri ? (
                        <img src={sourceRouterApplication.imageUri} alt="" loading="lazy" />
                      ) : (
                        <span>{sourceRouterDisplayName.slice(0, 1).toUpperCase()}</span>
                      )}
                    </span>
                  )}
                  <span className="router-summary-copy">
                    <strong>{sourceRouterDisplayName}</strong>
                    <span>{sourceRouterDisplayId}</span>
                  </span>
                </div>
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
            )}

            <button
              className="theme-toggle-button"
              type="button"
              aria-label={isDarkTheme ? "Ativar modo claro" : "Ativar modo escuro"}
              title={isDarkTheme ? "Ativar modo claro" : "Ativar modo escuro"}
              onClick={toggleTheme}
            >
              {isDarkTheme ? (
                <Sun size={18} aria-hidden="true" />
              ) : (
                <Moon size={18} aria-hidden="true" />
              )}
            </button>
          </div>
        </header>

        {isLoadingCurrentApplication && (
          <Feedback tone="info" title="Conectando ao Portal Blip">
            Carregando o router de origem…
          </Feedback>
        )}
        {startupError && (
          <Feedback
            title="A conexão com o Portal não foi concluída"
            action={
              <>
                <Button onClick={() => setStartupAttempt((attempt) => attempt + 1)}>
                  Tentar novamente
                </Button>
                <Button variant="ghost" onClick={openSourceModal}>
                  Selecionar origem
                </Button>
              </>
            }
          >
            {startupError}
          </Feedback>
        )}

        {error && !activeModalId && (
          <Feedback title="Não foi possível concluir" onDismiss={() => setError("")}>
            {error}
          </Feedback>
        )}

        {visibleActiveView === "routers" && copyNotice && (
          <Feedback tone="success" onDismiss={() => setCopyNotice("")}>
            {copyNotice}
          </Feedback>
        )}

        {pageOperationResult && (
          <div
            className={`ember-alert ${pageOperationResult.status === "warning" ? "warning" : "success"}`}
            role={pageOperationResult.status === "warning" ? "alert" : "status"}
            aria-live="polite"
          >
            {pageOperationResult.status === "warning" ? (
              <AlertCircle size={18} aria-hidden="true" />
            ) : (
              <CheckSquare size={18} aria-hidden="true" />
            )}
            <span>{pageOperationResult.summary}</span>
          </div>
        )}

        {visibleActiveView === "routers" ? (
          <section className="ember-panel results-panel router-directory-panel">
            <div className="ember-panel-title results-title">
              <div>
                <h2>Routers</h2>
                <p>
                  Consulte os routers master em que você tem permissão e copie os dados de acesso
                  quando necessário.
                </p>
              </div>
              <Button
                variant="secondary"
                type="button"
                onClick={() => void loadRouterApplications()}
                disabled={isLoadingRouterApplications || !isEmbedded}
              >
                {isLoadingRouterApplications ? (
                  <LoaderCircle className="spin" size={18} aria-hidden="true" />
                ) : (
                  <Search size={18} aria-hidden="true" />
                )}
                Atualizar
              </Button>
            </div>

            {!isEmbedded ? (
              <div className="router-picker-empty">
                <span>
                  Abra esta extensão dentro do Portal BLiP para listar os routers disponíveis.
                </span>
              </div>
            ) : (
              <>
                <div className="router-directory-toolbar">
                  <label className="blip-native-field" htmlFor="routerDirectorySearch">
                    Buscar router
                    <input
                      id="routerDirectorySearch"
                      value={routerDirectorySearch}
                      onChange={(event) => setRouterDirectorySearch(event.target.value)}
                      placeholder="Nome, ID ou tenant"
                    />
                  </label>
                  <span className="router-directory-count">
                    {filteredDirectoryRouterApplications.length} router
                    {filteredDirectoryRouterApplications.length === 1 ? "" : "s"}
                  </span>
                </div>

                {routerApplicationsError && (
                  <Feedback
                    title="Não foi possível carregar os routers"
                    action={
                      <Button
                        onClick={() => void loadRouterApplications()}
                        loading={isLoadingRouterApplications}
                      >
                        Tentar novamente
                      </Button>
                    }
                  >
                    {routerApplicationsError}
                  </Feedback>
                )}

                {isLoadingRouterApplications ? (
                  <div className="router-picker-empty">
                    <LoaderCircle className="spin" size={20} aria-hidden="true" />
                    <span>Carregando routers...</span>
                  </div>
                ) : filteredDirectoryRouterApplications.length === 0 ? (
                  <div className="router-picker-empty">
                    <span>Nenhum router disponível</span>
                  </div>
                ) : (
                  <div className="router-directory-grid">
                    {filteredDirectoryRouterApplications.map((application) => {
                      const routerUrl = buildRouterUrl(application);
                      const isCopyingKey = routerKeyActionId === application.shortName;

                      return (
                        <article key={application.shortName} className="router-directory-card">
                          <a
                            className={`router-directory-card-main ${routerUrl ? "" : "disabled"}`}
                            href={routerUrl || undefined}
                            target={routerUrl ? "_blank" : undefined}
                            rel={routerUrl ? "noreferrer" : undefined}
                            aria-disabled={!routerUrl || undefined}
                            title={
                              routerUrl
                                ? `Abrir ${application.name} no Portal BLiP`
                                : "Tenant não disponível para abrir este router."
                            }
                          >
                            <span className="router-directory-avatar">
                              {application.imageUri ? (
                                <img
                                  src={application.imageUri}
                                  alt={`Imagem do router ${application.name}`}
                                  loading="lazy"
                                />
                              ) : (
                                <span>{application.name.slice(0, 1).toUpperCase()}</span>
                              )}
                            </span>
                            <span className="router-directory-copy">
                              <strong>{application.name}</strong>
                              <span>{application.shortName}</span>
                              {application.tenantId && <small>{application.tenantId}</small>}
                            </span>
                            <ExternalLink size={18} aria-hidden="true" />
                          </a>
                          <div className="router-directory-card-actions">
                            <Button
                              variant="ghost"
                              size="sm"
                              type="button"
                              onClick={() => void handleCopyRouterId(application)}
                            >
                              <Clipboard size={16} aria-hidden="true" />
                              Copiar ID
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              type="button"
                              onClick={() => void handleCopyRouterKey(application)}
                              disabled={Boolean(routerKeyActionId)}
                            >
                              {isCopyingKey ? (
                                <LoaderCircle className="spin" size={16} aria-hidden="true" />
                              ) : (
                                <KeyRound size={16} aria-hidden="true" />
                              )}
                              Copiar key
                            </Button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </section>
        ) : visibleActiveView === "templates" ? (
          <section className="ember-panel results-panel">
            <div className="ember-panel-title results-title">
              <div>
                <h2>Templates</h2>
                <p>
                  {templateSearchResult.total} encontrados, {selectedTemplates.length} selecionados,{" "}
                  {targetCount} destinos
                </p>
              </div>
              <Button
                variant="secondary"
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
              </Button>
            </div>

            <form className="template-filter-row" onSubmit={handleSearchTemplates}>
              <label className="blip-native-field template-search-field" htmlFor="templateName">
                Nome do template
                <input
                  id="templateName"
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  placeholder="Buscar todos ou filtrar por nome"
                />
              </label>
              <Button type="submit" loading={isSearchingTemplates}>
                {!isSearchingTemplates && <Search size={18} aria-hidden="true" />}Buscar
              </Button>
              <ActionsMenu
                actions={[
                  {
                    label: "Comparar routers",
                    icon: <Search size={16} />,
                    onSelect: () => {
                      setError("");
                      setCopyNotice("");
                      setTemplateCompareResult(null);
                      setIsTemplateCompareModalOpen(true);
                    },
                  },
                  {
                    label: targetCount ? `Editar destinos (${targetCount})` : "Configurar destinos",
                    icon: <Network size={16} />,
                    onSelect: openTargetsModal,
                  },
                  { label: "Limpar resultados", icon: <X size={16} />, onSelect: clearResults },
                ]}
              />
            </form>
            <SelectionBar
              count={selectedTemplates.length}
              targets={targetCount}
              loading={isReplicatingTemplates}
              disabled={isDeletingTemplates || isInspectingTemplateDeletion || isSearchingTemplates}
              onTargets={openTargetsModal}
              onReplicate={handleReplicateTemplates}
              onClear={() => setSelectedTemplateKeys(new Set())}
            >
              <ActionsMenu
                label="Ações em lote"
                disabled={
                  isInspectingTemplateDeletion || isDeletingTemplates || isReplicatingTemplates
                }
                actions={[
                  {
                    label: "Deletar na origem",
                    icon: <Trash2 size={16} />,
                    danger: true,
                    onSelect: handleOpenSourceTemplateDeleteModal,
                  },
                  {
                    label: "Deletar em massa",
                    icon: <Trash2 size={16} />,
                    danger: true,
                    onSelect: handleOpenBulkTemplateDeleteModal,
                  },
                ]}
              />
            </SelectionBar>
            <TemplateTable
              templates={templateSearchResult.templates}
              selected={selectedTemplateKeys}
              loading={isSearchingTemplates}
              loaded={templatesLoaded}
              onToggle={toggleTemplate}
            />
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
              <Button
                variant="secondary"
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
              </Button>
            </div>

            <form className="template-filter-row flow-filter-row" onSubmit={handleLoadFlows}>
              <label className="blip-native-field template-search-field" htmlFor="flowFilter">
                Filtrar por nome ou ID
                <input
                  id="flowFilter"
                  value={flowFilter}
                  onChange={(event) => setFlowFilter(event.target.value)}
                  placeholder="Digite nome ou ID"
                />
              </label>
              <Button type="submit" loading={isLoadingFlows}>
                {!isLoadingFlows && <Search size={18} aria-hidden="true" />}Buscar
              </Button>
              <Button
                onClick={() => {
                  setError("");
                  setIsCreateFlowModalOpen(true);
                }}
              >
                <Plus size={18} aria-hidden="true" />
                Criar flow
              </Button>
              <ActionsMenu
                actions={[
                  {
                    label: targetCount ? `Editar destinos (${targetCount})` : "Configurar destinos",
                    icon: <Network size={16} />,
                    onSelect: openTargetsModal,
                  },
                  { label: "Limpar resultados", icon: <X size={16} />, onSelect: clearResults },
                ]}
              />
            </form>
            <SelectionBar
              count={selectedFlows.length}
              targets={targetCount}
              loading={isReplicatingFlows}
              disabled={isLoadingFlows}
              onTargets={openTargetsModal}
              onReplicate={handleReplicateFlows}
              onClear={() => setSelectedFlowIds(new Set())}
            />

            {selectedFlowsIncludeApi && (
              <label
                className="blip-native-field flow-public-key-field"
                htmlFor="replicateFlowBusinessPublicKey"
              >
                business_public_key para Flow API
                <textarea
                  id="replicateFlowBusinessPublicKey"
                  value={replicateFlowBusinessPublicKey}
                  onChange={(e) => setReplicateFlowBusinessPublicKey(e.target.value)}
                  rows={6}
                  required
                  spellCheck={false}
                  placeholder={"-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"}
                />
              </label>
            )}

            <FlowTable
              flows={filteredFlows}
              selected={selectedFlowIds}
              loading={isLoadingFlows}
              loaded={flowsLoaded}
              filtered={!!flowFilter.trim()}
              actionId={flowActionId}
              onToggle={toggleFlow}
              onPreview={handlePreviewFlow}
              onCopy={handleCopyFlowJson}
              onEdit={handleOpenEditFlow}
              onPublish={handlePublishFlow}
              onDeprecate={handleDeprecateFlow}
            />
          </section>
        ) : visibleActiveView === "bots" ? (
          <section className="ember-panel results-panel">
            <div className="ember-panel-title results-title">
              <div>
                <h2>Clonar Bot</h2>
                <p>
                  Copia configuração de um bot BLiP para outro, usando a bot key de cada um — não
                  precisa estar na sua lista de routers do Portal.
                </p>
              </div>
            </div>

            <form className="bot-clone-form" onSubmit={handleCloneBot}>
              <div className="bot-clone-routers">
                <div className="bot-clone-router-field">
                  <label className="blip-native-field" htmlFor="botSourceRouterKey">
                    Bot Key de Origem
                    <input
                      id="botSourceRouterKey"
                      value={botSourceRouterKey}
                      onChange={(event) => {
                        setBotSourceRouterKey(event.target.value);
                        if (botSourceKeyInvalid) {
                          setBotSourceKeyInvalid(false);
                          setError("");
                        }
                      }}
                      placeholder="Key ..."
                      aria-invalid={botSourceKeyInvalid || undefined}
                      className={botSourceKeyInvalid ? "invalid" : undefined}
                    />
                  </label>
                  {botSourceIdentity.status === "loading" && (
                    <p className="bot-identity-hint">Verificando...</p>
                  )}
                  {botSourceIdentity.status === "success" && (
                    <p className="bot-identity-hint">
                      Id: <strong>{botSourceIdentity.identity}</strong>
                    </p>
                  )}
                  {botSourceIdentity.status === "error" && (
                    <p className="bot-identity-hint bot-identity-hint-error">
                      Não foi possível verificar essa key.
                    </p>
                  )}
                </div>
                <div className="bot-clone-router-field">
                  <label className="blip-native-field" htmlFor="botTargetRouterKey">
                    Bot Key de Destino
                    <input
                      id="botTargetRouterKey"
                      value={botTargetRouterKey}
                      onChange={(event) => {
                        setBotTargetRouterKey(event.target.value);
                        if (botTargetKeyInvalid) {
                          setBotTargetKeyInvalid(false);
                          setError("");
                        }
                      }}
                      placeholder="Key ..."
                      aria-invalid={botTargetKeyInvalid || undefined}
                      className={botTargetKeyInvalid ? "invalid" : undefined}
                    />
                  </label>
                  {botTargetIdentity.status === "loading" && (
                    <p className="bot-identity-hint">Verificando...</p>
                  )}
                  {botTargetIdentity.status === "success" && (
                    <p className="bot-identity-hint">
                      Id: <strong>{botTargetIdentity.identity}</strong>
                    </p>
                  )}
                  {botTargetIdentity.status === "error" && (
                    <p className="bot-identity-hint bot-identity-hint-error">
                      Não foi possível verificar essa key.
                    </p>
                  )}
                </div>
              </div>

              <div className="form-group">
                <div className="bot-clone-options-header">
                  <h3>O que clonar?</h3>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => {
                      const nextValue = !BOT_CLONE_OPTION_KEYS.every((key) => botCloneOptions[key]);
                      setBotCloneOptions(
                        Object.fromEntries(
                          BOT_CLONE_OPTION_KEYS.map((key) => [key, nextValue]),
                        ) as BotCloneOptions,
                      );
                    }}
                  >
                    {BOT_CLONE_OPTION_KEYS.every((key) => botCloneOptions[key]) ? (
                      <>
                        <Square size={16} aria-hidden="true" />
                        Limpar seleção
                      </>
                    ) : (
                      <>
                        <CheckSquare size={16} aria-hidden="true" />
                        Selecionar tudo
                      </>
                    )}
                  </Button>
                </div>
                {BOT_CLONE_OPTION_GROUPS.map(({ group, fields }) => (
                  <div key={group} className="bot-clone-option-group">
                    <span className="bot-clone-option-group-label">{group}</span>
                    <div className="action-grid bot-clone-options">
                      {fields.map(({ key, label }) => (
                        <label key={key} className="bot-clone-option">
                          <input
                            type="checkbox"
                            checked={botCloneOptions[key]}
                            onChange={(event) =>
                              setBotCloneOptions((current) => ({
                                ...current,
                                [key]: event.target.checked,
                              }))
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <Button
                type="submit"
                loading={
                  isCloningBot ||
                  (!!botCloneResult && visibleBotStepCount < botCloneResult.steps.length)
                }
              >
                <CopyPlus size={18} aria-hidden="true" />
                Clonar bot
              </Button>
            </form>

            {botCloneResult && (
              <div className="bot-clone-results" aria-live="polite">
                {botCloneResult.steps.slice(0, visibleBotStepCount).map((step) => (
                  <Feedback
                    key={step.key}
                    tone={
                      step.status === "success"
                        ? "success"
                        : step.status === "partial"
                          ? "warning"
                          : "danger"
                    }
                    title={step.label}
                  >
                    {describeBotCloneStep(step)}
                  </Feedback>
                ))}
              </div>
            )}
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
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={() => setDevCommandUri(DEFAULT_DEV_COMMAND_URI)}
                    >
                      <Clipboard size={18} aria-hidden="true" />
                      Padrão
                    </Button>
                    <Button
                      variant="secondary"
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
                    </Button>
                    <Button
                      variant="primary"
                      type="submit"
                      disabled={isRunningDevCommand || !isEmbedded}
                    >
                      {isRunningDevCommand ? (
                        <LoaderCircle className="spin" size={18} aria-hidden="true" />
                      ) : (
                        <Send size={18} aria-hidden="true" />
                      )}
                      Executar
                    </Button>
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
                  <Button
                    variant="secondary"
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
                  </Button>
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
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => setPluginDraftId(createCommandId())}
                    disabled={Boolean(editingPluginId)}
                  >
                    <Plus size={18} aria-hidden="true" />
                    Gerar ID
                  </Button>
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
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={resetPluginDraft}
                      disabled={isSavingPlugin}
                    >
                      <X size={18} aria-hidden="true" />
                      Cancelar
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    type="submit"
                    disabled={isSavingPlugin || !pluginsLoaded}
                  >
                    {isSavingPlugin ? (
                      <LoaderCircle className="spin" size={18} aria-hidden="true" />
                    ) : (
                      <Plus size={18} aria-hidden="true" />
                    )}
                    {editingPluginId ? "Salvar edição" : "Adicionar"}
                  </Button>
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
                  <Button variant="secondary" type="submit" disabled={isLoadingPlugins}>
                    {isLoadingPlugins ? (
                      <LoaderCircle className="spin" size={18} aria-hidden="true" />
                    ) : (
                      <Search size={18} aria-hidden="true" />
                    )}
                    Buscar
                  </Button>
                  <Button
                    variant="danger"
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
                  </Button>
                  <Button variant="secondary" type="button" onClick={openTargetsModal}>
                    <Plus size={18} aria-hidden="true" />
                    {targetCount
                      ? `Editar routers de destino (${targetCount})`
                      : "Adicionar routers de destino"}
                  </Button>
                  <Button
                    variant="primary"
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
                  </Button>
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
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="icon-only"
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
                                  </Button>
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    className="icon-only"
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
                                  </Button>
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
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => handlePreviewFlow(operationResult.previewFlow!)}
                  >
                    <Eye size={18} aria-hidden="true" />
                    Visualizar
                  </Button>
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
              data-modal-id="template-compare"
              tabIndex={-1}
            >
              <div className="ember-modal-header">
                <div>
                  <h2 id="compare-modal-title">Comparar templates</h2>
                  <p>
                    Compara o router de origem com os destinos e retorna templates filtrados
                    presentes em todos eles.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  className="icon-only"
                  aria-label="Fechar"
                  type="button"
                  onClick={() => setIsTemplateCompareModalOpen(false)}
                >
                  <X size={18} aria-hidden="true" />
                </Button>
              </div>

              <form className="compare-form" onSubmit={handleCompareTemplates}>
                {error && (
                  <Feedback title="Não foi possível concluir" onDismiss={() => setError("")}>
                    {error}
                  </Feedback>
                )}
                {copyNotice && (
                  <Feedback tone="success" onDismiss={() => setCopyNotice("")}>
                    {copyNotice}
                  </Feedback>
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
                  <Button variant="secondary" type="button" onClick={openTargetsModal}>
                    <Plus size={18} aria-hidden="true" />
                    {targetCount ? `Destinos (${targetCount})` : "Adicionar destinos"}
                  </Button>
                  <Button variant="primary" type="submit" disabled={isComparingTemplates}>
                    {isComparingTemplates ? (
                      <LoaderCircle className="spin" size={18} aria-hidden="true" />
                    ) : (
                      <Search size={18} aria-hidden="true" />
                    )}
                    Comparar
                  </Button>
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
                      <Button
                        variant="secondary"
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
                      </Button>
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
                            <StatusBadge status={template.status} />
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

        {isTemplateDeleteModalOpen && (
          <div className="ember-modal-backdrop" role="presentation">
            <section
              className="ember-modal template-delete-modal"
              aria-labelledby="template-delete-modal-title"
              role="dialog"
              aria-modal="true"
              data-modal-id="template-delete"
              tabIndex={-1}
            >
              <div className="ember-modal-header">
                <div>
                  <h2 id="template-delete-modal-title">
                    {templateDeleteMode === "source" ? "Deletar templates" : "Deletar em massa"}
                  </h2>
                  <p>
                    {templateDeleteMode === "source"
                      ? `${templateDeleteItems.length} selecionado(s) na origem`
                      : `${templateDeleteItems.length} na origem, ${templateDeletePreflight?.totals.targetRouters ?? 0} destinos, ${templateDeletePreflight?.totals.matched ?? 0} encontrados, ${templateDeletePreflight?.totals.missing ?? 0} sem match`}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  className="icon-only"
                  aria-label="Fechar"
                  type="button"
                  onClick={() => closeTemplateDeleteModal()}
                  disabled={isDeletingTemplates}
                >
                  <X size={18} aria-hidden="true" />
                </Button>
              </div>

              <div className="ember-modal-body">
                {error && (
                  <Feedback title="Não foi possível concluir" onDismiss={() => setError("")}>
                    {error}
                  </Feedback>
                )}

                <div className="template-delete-progress" aria-live="polite">
                  <div className="template-delete-progress-copy">
                    <strong>
                      {templateDeleteProgress.removed} de {templateDeleteProgressTotal} removidos
                    </strong>
                    <span>
                      {templateDeleteProgress.processed} processados
                      {templateDeleteProgress.failed > 0
                        ? `, ${templateDeleteProgress.failed} falha(s)`
                        : ""}
                    </span>
                  </div>
                  <div className="template-delete-progress-track" aria-hidden="true">
                    <span style={{ transform: `scaleX(${templateDeleteProgressPercent / 100})` }} />
                  </div>
                </div>

                <div className="ember-table-wrap template-delete-table-wrap">
                  <table className="ember-table template-delete-table">
                    <thead>
                      <tr>
                        <th>Router</th>
                        <th>Template</th>
                        <th>Tipo</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {templateDeleteMode === "source"
                        ? templateDeleteItems.map((template) => {
                            const jobKey = getTemplateDeleteJobKey(undefined, template.name);
                            const jobState = templateDeleteJobStates[jobKey];

                            return (
                              <tr key={jobKey}>
                                <td>
                                  <strong>Origem</strong>
                                </td>
                                <td>
                                  <strong>{template.name}</strong>
                                  <span className="mono-cell">
                                    {template.languages.join(", ") || "-"}
                                  </span>
                                  {jobState?.message && (
                                    <span className="flow-mapping-subtle danger-text">
                                      {jobState.message}
                                    </span>
                                  )}
                                </td>
                                <td>{template.category || "-"}</td>
                                <td>
                                  {renderTemplateDeleteStatus(jobState, "Selecionado", "pending")}
                                </td>
                              </tr>
                            );
                          })
                        : [
                            ...templateDeleteItems.map((template) => {
                              const jobKey = getTemplateDeleteJobKey(undefined, template.name);
                              const jobState = templateDeleteJobStates[jobKey];

                              return (
                                <tr key={jobKey}>
                                  <td>
                                    <strong>Origem</strong>
                                    <span className="flow-mapping-subtle">Router atual</span>
                                  </td>
                                  <td>
                                    <strong>{template.name}</strong>
                                    <span className="mono-cell">
                                      {template.languages.join(", ") || "-"}
                                    </span>
                                    {jobState?.message && (
                                      <span className="flow-mapping-subtle danger-text">
                                        {jobState.message}
                                      </span>
                                    )}
                                  </td>
                                  <td>{template.category || "-"}</td>
                                  <td>
                                    {renderTemplateDeleteStatus(jobState, "Selecionado", "pending")}
                                  </td>
                                </tr>
                              );
                            }),
                            ...(templateDeletePreflight?.targetRouters.flatMap((targetRouter) =>
                              templateDeleteItems.map((template) => {
                                const match = templateDeletePreflight.matches.find(
                                  (item) =>
                                    item.targetIndex === targetRouter.targetIndex &&
                                    normalizeTemplateDeleteName(item.sourceTemplateName) ===
                                      normalizeTemplateDeleteName(template.name),
                                );
                                const rowKey = match
                                  ? getTemplateDeleteJobKey(match.targetIndex, match.templateName)
                                  : `missing:${targetRouter.targetIndex}:${normalizeTemplateDeleteName(
                                      template.name,
                                    )}`;
                                const jobState = match
                                  ? templateDeleteJobStates[rowKey]
                                  : undefined;
                                const languages = match?.languages.length
                                  ? match.languages
                                  : template.languages;

                                return (
                                  <tr key={rowKey}>
                                    <td>
                                      <strong>
                                        {getTemplateDeleteRouterLabel(targetRouter.targetIndex)}
                                      </strong>
                                      <span className="flow-mapping-subtle">
                                        {targetRouter.totalTemplates} templates
                                      </span>
                                    </td>
                                    <td>
                                      <strong>{match?.templateName || template.name}</strong>
                                      <span className="mono-cell">
                                        {languages.join(", ") || "-"}
                                      </span>
                                      {jobState?.message && (
                                        <span className="flow-mapping-subtle danger-text">
                                          {jobState.message}
                                        </span>
                                      )}
                                    </td>
                                    <td>{match?.category || template.category || "-"}</td>
                                    <td>
                                      {match
                                        ? renderTemplateDeleteStatus(
                                            jobState,
                                            "Achado",
                                            "published",
                                          )
                                        : renderTemplateDeleteStatus(
                                            undefined,
                                            "Sem match",
                                            "failed",
                                          )}
                                    </td>
                                  </tr>
                                );
                              }),
                            ) ?? []),
                          ]}
                      {templateDeleteMode === "bulk" &&
                        templateDeletePreflight?.errors
                          .filter((item) => item.step === "load_target_templates")
                          .map((item) => (
                            <tr key={`error-${item.targetIndex}`}>
                              <td>
                                <strong>
                                  {typeof item.targetIndex === "number"
                                    ? getTemplateDeleteRouterLabel(item.targetIndex)
                                    : "Destino"}
                                </strong>
                              </td>
                              <td colSpan={2}>{item.message}</td>
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
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => closeTemplateDeleteModal()}
                  disabled={isDeletingTemplates}
                >
                  Fechar
                </Button>
                <Button
                  variant="danger"
                  type="button"
                  onClick={handleConfirmTemplateDelete}
                  disabled={
                    isDeletingTemplates ||
                    hasTemplateDeleteStarted ||
                    templateDeleteRunnableCount === 0
                  }
                >
                  {isDeletingTemplates ? (
                    <LoaderCircle className="spin" size={18} aria-hidden="true" />
                  ) : (
                    <Trash2 size={18} aria-hidden="true" />
                  )}
                  Deletar
                </Button>
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
              data-modal-id="create-flow"
              tabIndex={-1}
            >
              <div className="ember-modal-header">
                <div>
                  <h2 id="create-flow-modal-title">Criar flow agora</h2>
                  <p>Cria o flow no router de origem e envia o JSON completo sem publicar.</p>
                </div>
                <Button
                  variant="secondary"
                  className="icon-only"
                  aria-label="Fechar"
                  type="button"
                  onClick={() => setIsCreateFlowModalOpen(false)}
                >
                  <X size={18} aria-hidden="true" />
                </Button>
              </div>

              <div className="ember-modal-body">
                {error && (
                  <Feedback title="Não foi possível concluir" onDismiss={() => setError("")}>
                    {error}
                  </Feedback>
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
                    onChange={(e) => {
                      const isFlowApi = e.target.checked;
                      setNewFlowIsApi(isFlowApi);
                      if (!isFlowApi) {
                        setNewFlowEndpointUri("");
                        setNewFlowBusinessPublicKey("");
                      }
                    }}
                  />
                  É Flow API
                </label>

                {newFlowIsApi && (
                  <>
                    <label className="blip-native-field" htmlFor="newFlowEndpointUri">
                      endpoint_uri
                      <input
                        id="newFlowEndpointUri"
                        value={newFlowEndpointUri}
                        onChange={(e) => setNewFlowEndpointUri(e.target.value)}
                        required
                        placeholder="https://..."
                      />
                    </label>

                    <label
                      className="blip-native-field public-key-field"
                      htmlFor="newFlowBusinessPublicKey"
                    >
                      business_public_key
                      <textarea
                        id="newFlowBusinessPublicKey"
                        value={newFlowBusinessPublicKey}
                        onChange={(e) => setNewFlowBusinessPublicKey(e.target.value)}
                        rows={6}
                        required
                        spellCheck={false}
                        placeholder={"-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"}
                      />
                    </label>
                  </>
                )}

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
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setIsCreateFlowModalOpen(false)}
                >
                  Cancelar
                </Button>
                <Button
                  variant="primary"
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
                </Button>
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
              data-modal-id="edit-flow"
              tabIndex={-1}
            >
              <div className="ember-modal-header">
                <div>
                  <h2 id="edit-flow-modal-title">Editar flow</h2>
                  <p>{editingFlow.name}</p>
                </div>
                <Button
                  variant="secondary"
                  className="icon-only"
                  aria-label="Fechar"
                  type="button"
                  onClick={() => closeEditFlowModal()}
                  disabled={isUpdatingFlow || isBulkUpdatingFlows}
                >
                  <X size={18} aria-hidden="true" />
                </Button>
              </div>

              <div className="ember-modal-body">
                {error && (
                  <Feedback title="Não foi possível concluir" onDismiss={() => setError("")}>
                    {error}
                  </Feedback>
                )}

                <label className="blip-native-field" htmlFor="editFlowName">
                  Nome do flow
                  <input
                    id="editFlowName"
                    value={editFlowName}
                    onChange={(event) => setEditFlowName(event.target.value)}
                    disabled={isLoadingEditFlowJson || isUpdatingFlow || isBulkUpdatingFlows}
                    required
                  />
                </label>

                {(editingFlow.isFlowApi || Boolean(editingFlow.endpoint_uri)) && (
                  <label className="blip-native-field" htmlFor="editFlowEndpointUri">
                    Endpoint da API
                    <input
                      id="editFlowEndpointUri"
                      type="url"
                      value={editFlowEndpointUri}
                      onChange={(event) => setEditFlowEndpointUri(event.target.value)}
                      disabled={isLoadingEditFlowJson || isUpdatingFlow || isBulkUpdatingFlows}
                      required
                      placeholder="https://..."
                    />
                  </label>
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
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => closeEditFlowModal()}
                  disabled={isUpdatingFlow || isBulkUpdatingFlows}
                >
                  Cancelar
                </Button>
                <div className="flow-edit-footer-actions">
                  <Button
                    variant="secondary"
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
                  </Button>
                  <Button
                    variant="primary"
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
                  </Button>
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
              data-modal-id="bulk-flow-mapping"
              tabIndex={-1}
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
                <Button
                  variant="secondary"
                  className="icon-only"
                  aria-label="Fechar"
                  type="button"
                  onClick={() => closeBulkFlowMappingModal()}
                  disabled={isBulkUpdatingFlows}
                >
                  <X size={18} aria-hidden="true" />
                </Button>
              </div>

              <div className="ember-modal-body">
                {error && (
                  <Feedback title="Não foi possível concluir" onDismiss={() => setError("")}>
                    {error}
                  </Feedback>
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
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => closeBulkFlowMappingModal()}
                  disabled={isBulkUpdatingFlows}
                >
                  Voltar
                </Button>
                <Button
                  variant="primary"
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
                </Button>
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
              data-modal-id="router"
              tabIndex={-1}
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
                <Button
                  variant="secondary"
                  className="icon-only"
                  aria-label="Fechar"
                  type="button"
                  onClick={closeRouterModal}
                >
                  <X size={18} aria-hidden="true" />
                </Button>
              </div>

              <div className="ember-modal-body">
                {error && <Feedback onDismiss={() => setError("")}>{error}</Feedback>}
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
                <Button variant="secondary" type="button" onClick={closeRouterModal}>
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  type="button"
                  onClick={routerModal === "source" ? saveSourceRouter : saveTargetRouters}
                >
                  Salvar
                </Button>
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
