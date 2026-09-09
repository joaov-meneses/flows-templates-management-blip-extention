import type { COMMAND_METHODS } from "../lib/blipActions";

export type ActiveView = "routers" | "templates" | "flows" | "devs";
export type DevsTab = "commands" | "plugins";
export type RouterModal = "source" | "targets" | null;
export type SortDirection = "asc" | "desc";
export type CommandDestination = "BlipService" | "MessagingHubService";
export type CommandMethod = (typeof COMMAND_METHODS)[keyof typeof COMMAND_METHODS];
export type DevCommandType = "" | "text/plain" | "application/json";
export type DevCommandContentType = Exclude<DevCommandType, "">;
export type PluginCopyMode = "add" | "replace";

export type DevCommand = {
  method: CommandMethod;
  to: string;
  uri: string;
  id: string;
  type?: DevCommandContentType;
  resource?: unknown;
};

export type Template = {
  name: string;
  language: string;
  category: string;
  status?: string;
  components: unknown;
};

export type SearchResponse = {
  search: { templateName: string; onlyApproved: boolean };
  total: number;
  templates: Template[];
};

export type TemplateReplicateResponse = {
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

export type TemplateCompareResponse = {
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
export type TemplateDeleteMode = "source" | "bulk";
export type TemplateDeleteItem = {
  name: string;
  languages: string[];
  category?: string;
  status?: string;
};
export type TemplateDeleteTargetRouter = {
  targetIndex: number;
  totalTemplates: number;
  matched: number;
  missing: number;
};
export type TemplateDeleteMatch = {
  targetIndex: number;
  sourceTemplateName: string;
  templateName: string;
  languages: string[];
  category?: string;
  status?: string;
};
export type TemplateDeleteMissing = {
  targetIndex: number;
  sourceTemplateName: string;
  templateName: string;
};
export type TemplateDeleteError = {
  step: string;
  targetIndex?: number;
  sourceTemplateName?: string;
  templateName?: string;
  message: string;
};
export type TemplateDeleteResponse = {
  status: "success";
  templateName: string;
  targetIndex?: number;
  response: unknown;
};
export type TemplateBulkDeleteResponse = {
  options: {
    continueOnError: boolean;
    batchSize: number;
    dryRun: boolean;
  };
  totals: {
    selectedTemplates: number;
    targetRouters: number;
    matched: number;
    missing: number;
    deleted: number;
    errors: number;
  };
  targetRouters: TemplateDeleteTargetRouter[];
  matches: TemplateDeleteMatch[];
  missing: TemplateDeleteMissing[];
  deleted: TemplateDeleteResponse[];
  errors: TemplateDeleteError[];
};
export type TemplateDeleteProgress = {
  total: number;
  processed: number;
  removed: number;
  failed: number;
};
export type TemplateDeleteJobState = {
  status: "pending" | "running" | "success" | "error";
  message?: string;
};
export type TemplateDeleteJob = {
  key: string;
  routerKey: string;
  routerLabel: string;
  targetIndex?: number;
  templateName: string;
};

export type FlowSummary = {
  id: string;
  name: string;
  status?: string;
  categories?: string[];
  validation_errors?: unknown[];
  endpoint_uri?: string;
  isFlowApi?: boolean;
};

export type FlowSearchResponse = { total: number; flows: FlowSummary[] };
export type FlowPreviewResponse = { flow: unknown; previewUrl: string; expiresAt?: string };
export type FlowJsonResponse = { flowId: string; downloadUrl: string; json: unknown };
export type FlowReplicateResponse = {
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
export type FlowCreateResponse = {
  flow: FlowSummary;
  publicKeyUpload: unknown | null;
  createResponse: unknown;
  setJsonResponse: unknown;
};
export type FlowUpdateJsonResponse = {
  flow: FlowSummary;
  setJsonResponse: unknown;
};
export type FlowUpdateMetadataResponse = {
  flow: FlowSummary;
  setMetadataResponse: unknown;
};
export type FlowPublishResponse = { flowId: string; publishResponse: unknown };
export type FlowDeprecateResponse = { flowId: string; deprecateResponse: unknown };
export type FlowBulkUpdateMatch = {
  targetIndex: number;
  sourceFlowId: string;
  sourceFlowName: string;
  flowId: string;
  flowName: string;
  status?: string;
  matchType?: "name" | "selected";
};
export type FlowBulkUpdateMissing = {
  targetIndex: number;
  sourceFlowId: string;
  sourceFlowName: string;
  flowName: string;
};
export type FlowBulkUpdateError = {
  step: string;
  targetIndex?: number;
  flowId?: string;
  flowName?: string;
  message: string;
};
export type FlowBulkUpdateOverride = {
  targetIndex: number;
  sourceFlowId: string;
  flowId: string;
};
export type FlowBulkUpdateResponse = {
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
export type PluginSummary = {
  id: string;
  name: string;
  url: string;
};
export type PluginSearchResponse = {
  total: number;
  plugins: PluginSummary[];
  response?: unknown;
};
export type PluginSaveResponse = {
  total: number;
  plugins: PluginSummary[];
  response: unknown;
};
export type PluginConflict = {
  targetIndex: number;
  pluginId: string;
  pluginName: string;
  existingId: string;
  existingName: string;
};
export type PluginConflictsResponse = {
  totals: {
    targetRouters: number;
    conflicts: number;
  };
  conflicts: PluginConflict[];
};
export type PluginReplicateResponse = {
  totals: {
    plugins: number;
    targetRouters: number;
    copied: number;
    errors: number;
  };
  copied: unknown[];
  errors: unknown[];
};
export type OperationResult = {
  summary: string;
  payload: unknown;
  previewFlow?: FlowSummary;
  status?: "success" | "warning";
  view?: ActiveView;
};
export type PortalApplicationAccount = {
  shortName: string;
  name: string;
  imageUri?: string;
  template?: string;
  hasPermission?: boolean;
  tenantId?: string;
  emailOwner?: string;
};
export type ResolvedRouterKey = {
  shortName: string;
  key: string;
  keyPreview: string;
};
export type CurrentApplicationRouter = {
  shortName: string;
  name?: string;
  imageUri?: string;
  accessKey?: string;
};
