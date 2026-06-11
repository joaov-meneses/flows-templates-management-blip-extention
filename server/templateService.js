const { randomUUID } = require("node:crypto");

const MSGING_COMMANDS_URL = "https://msging.net/commands";
const DEFAULT_BATCH_SIZE = 15;

class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
    this.statusCode = 400;
  }
}

function normalizeStringList(value, fieldName) {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item).trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[\n,;]+/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  if (value == null) {
    return [];
  }

  throw new InputError(`${fieldName} precisa ser uma string ou um array de strings.`);
}

function normalizeBatchSize(batchSize) {
  const normalized = Number(batchSize || DEFAULT_BATCH_SIZE);

  if (!Number.isInteger(normalized) || normalized <= 0 || normalized > 50) {
    throw new InputError("batchSize precisa ser um inteiro entre 1 e 50.");
  }

  return normalized;
}

function validateSourceRouterKey(sourceRouterKey) {
  if (!sourceRouterKey || typeof sourceRouterKey !== "string") {
    throw new InputError("sourceRouterKey precisa ser uma string.");
  }
}

function validateTargetRouterKeys(targetRouterKeys) {
  if (!Array.isArray(targetRouterKeys) || targetRouterKeys.length === 0) {
    throw new InputError("targetRouterKeys precisa ter pelo menos uma key de destino.");
  }
}

function getTemplateKey(template) {
  return `${template.name}|${template.language}`;
}

function assertTemplateIsReplicable(template) {
  if (!template || typeof template !== "object") {
    throw new InputError("Cada template precisa ser um objeto.");
  }

  if (!template.name || !template.category || !template.language || !template.components) {
    throw new InputError(`Template incompleto para replicação: ${JSON.stringify({
      name: template.name,
      category: template.category,
      language: template.language
    })}`);
  }
}

async function sendBlipCommand(routerKey, command) {
  const response = await fetch(MSGING_COMMANDS_URL, {
    method: "POST",
    headers: {
      Authorization: routerKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });

  const responseText = await response.text();

  let responseBody;
  try {
    responseBody = responseText ? JSON.parse(responseText) : null;
  } catch {
    responseBody = { raw: responseText };
  }

  if (!response.ok) {
    throw new Error(`Erro HTTP ${response.status}: ${JSON.stringify(responseBody, null, 2)}`);
  }

  if (responseBody?.status && responseBody.status !== "success") {
    throw new Error(`Comando retornou status "${responseBody.status}": ${JSON.stringify(responseBody, null, 2)}`);
  }

  return responseBody;
}

async function runInBatches(items, batchSize, handler) {
  const results = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((item, index) => handler(item, i + index))
    );

    results.push(...batchResults);
  }

  return results;
}

function buildGetTemplatesCommand(templateName) {
  const normalizedTemplateName = typeof templateName === "string" ? templateName.trim() : "";
  const uri = normalizedTemplateName
    ? `/message-templates?templateName=${encodeURIComponent(normalizedTemplateName)}`
    : "/message-templates";

  return {
    id: randomUUID(),
    to: "postmaster@wa.gw.msging.net",
    method: "get",
    uri
  };
}

async function getTemplatesFromSource(sourceRouterKey, templateName) {
  return sendBlipCommand(sourceRouterKey, buildGetTemplatesCommand(templateName));
}

function extractTemplatesFromResponse(responseBody) {
  const templates = responseBody?.resource?.data;

  if (!Array.isArray(templates)) {
    return [];
  }

  return templates;
}

function summarizeTemplate(template) {
  return {
    name: template.name,
    language: template.language,
    category: template.category,
    status: template.status
  };
}

function normalizeFilterText(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function templateMatchesCompareFilters(template, filters) {
  if (filters.category && String(template.category || "").toUpperCase() !== filters.category) {
    return false;
  }

  if (filters.status && String(template.status || "").toUpperCase() !== filters.status) {
    return false;
  }

  return true;
}

async function getTemplatesFromRouter(routerKey) {
  const responseBody = await getTemplatesFromSource(routerKey, "");
  return extractTemplatesFromResponse(responseBody);
}

function buildTemplateResource(template) {
  return {
    category: template.category,
    components: template.components,
    language: template.language,
    name: template.name
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildCreateTemplateCommand(template) {
  return {
    id: randomUUID(),
    method: "set",
    type: "application/json",
    to: "postmaster@wa.gw.msging.net",
    uri: "/message-templates",
    resource: buildTemplateResource(template)
  };
}

function buildUploadTemplateAttachmentCommand(headerHandle) {
  return {
    id: randomUUID(),
    method: "set",
    type: "application/vnd.lime.media-link+json",
    to: "postmaster@wa.gw.msging.net",
    uri: "/message-templates-attachment",
    resource: {
      uri: headerHandle
    }
  };
}

function getImageHeaderHandleSlots(template) {
  if (!Array.isArray(template?.components)) {
    return [];
  }

  const slots = [];

  template.components.forEach((component, componentIndex) => {
    const isImageHeader = String(component?.type || "").toUpperCase() === "HEADER"
      && String(component?.format || "").toUpperCase() === "IMAGE";
    const headerHandles = component?.example?.header_handle;

    if (!isImageHeader || !Array.isArray(headerHandles)) {
      return;
    }

    headerHandles.forEach((headerHandle, handleIndex) => {
      if (typeof headerHandle === "string" && headerHandle.trim()) {
        slots.push({
          componentIndex,
          handleIndex,
          headerHandle: headerHandle.trim()
        });
      }
    });
  });

  return slots;
}

async function prepareTemplateForTargetRouter(template, targetRouterKey) {
  const preparedTemplate = cloneJson(template);
  const headerHandleSlots = getImageHeaderHandleSlots(preparedTemplate);
  const attachments = [];

  for (const slot of headerHandleSlots) {
    const response = await sendBlipCommand(
      targetRouterKey,
      buildUploadTemplateAttachmentCommand(slot.headerHandle)
    );
    const fileHandle = response?.resource?.fileHandle;

    if (!fileHandle) {
      throw new Error(`Upload de imagem não retornou fileHandle para o template ${template.name}.`);
    }

    preparedTemplate.components[slot.componentIndex].example.header_handle[slot.handleIndex] = fileHandle;
    attachments.push({
      componentIndex: slot.componentIndex,
      handleIndex: slot.handleIndex,
      sourceUri: slot.headerHandle,
      fileHandle,
      response
    });
  }

  return {
    template: preparedTemplate,
    attachments
  };
}

async function searchTemplates(params) {
  const {
    sourceRouterKey,
    templateName = "",
    onlyApproved = false
  } = params || {};

  validateSourceRouterKey(sourceRouterKey);

  const responseBody = await getTemplatesFromSource(sourceRouterKey, templateName);
  let templates = extractTemplatesFromResponse(responseBody);

  if (onlyApproved) {
    templates = templates.filter(template => template.status === "APPROVED");
  }

  const templatesByNameAndLanguage = new Map();
  for (const template of templates) {
    if (!template.name || !template.language) {
      continue;
    }

    templatesByNameAndLanguage.set(getTemplateKey(template), template);
  }

  const uniqueTemplates = Array.from(templatesByNameAndLanguage.values());

  return {
    search: {
      templateName: templateName ? String(templateName).trim() : "",
      onlyApproved: Boolean(onlyApproved)
    },
    total: uniqueTemplates.length,
    templates: uniqueTemplates
  };
}

async function loadTemplatesByNames({
  sourceRouterKey,
  templateNames,
  onlyApproved,
  continueOnError,
  batchSize
}) {
  validateSourceRouterKey(sourceRouterKey);

  const names = normalizeStringList(templateNames, "templateNames");
  if (names.length === 0) {
    throw new InputError("templateNames precisa ter pelo menos um nome quando o campo templates não for enviado.");
  }

  const results = {
    searchedTemplateNames: names,
    foundTemplates: [],
    errors: []
  };

  const templatesByNameAndLanguage = new Map();

  await runInBatches(names, batchSize, async (templateName) => {
    try {
      const responseBody = await getTemplatesFromSource(sourceRouterKey, templateName);
      let templates = extractTemplatesFromResponse(responseBody);

      if (onlyApproved) {
        templates = templates.filter(template => template.status === "APPROVED");
      }

      for (const template of templates) {
        if (!template.name || !template.category || !template.language || !template.components) {
          continue;
        }

        templatesByNameAndLanguage.set(getTemplateKey(template), template);
      }

      return {
        status: "success",
        templateName,
        found: templates.length
      };
    } catch (error) {
      const errorInfo = {
        step: "get_template",
        templateName,
        message: error.message
      };

      results.errors.push(errorInfo);

      if (!continueOnError) {
        throw error;
      }

      return errorInfo;
    }
  });

  const templates = Array.from(templatesByNameAndLanguage.values()).reverse();
  results.foundTemplates = templates.map(summarizeTemplate);

  return {
    templates,
    loadResults: results
  };
}

function normalizeProvidedTemplates(templates) {
  if (!Array.isArray(templates)) {
    return [];
  }

  const templatesByNameAndLanguage = new Map();

  for (const template of templates) {
    assertTemplateIsReplicable(template);
    templatesByNameAndLanguage.set(getTemplateKey(template), template);
  }

  return Array.from(templatesByNameAndLanguage.values());
}

async function createTemplateOnTargetRouter({
  template,
  targetRouterKey,
  targetIndex,
  dryRun
}) {
  if (dryRun) {
    const attachmentsToUpload = getImageHeaderHandleSlots(template);

    return {
      status: "dry_run",
      templateName: template.name,
      language: template.language,
      targetIndex,
      attachmentsToUpload: attachmentsToUpload.length
    };
  }

  const prepared = await prepareTemplateForTargetRouter(template, targetRouterKey);
  const command = buildCreateTemplateCommand(prepared.template);
  const response = await sendBlipCommand(targetRouterKey, command);

  return {
    status: "success",
    templateName: template.name,
    language: template.language,
    targetIndex,
    uploadedAttachments: prepared.attachments.length,
    attachments: prepared.attachments,
    response
  };
}

async function replicateTemplates(params) {
  const {
    sourceRouterKey,
    templateNames,
    templates: providedTemplates,
    dryRun = false,
    continueOnError = true,
    onlyApproved = false
  } = params || {};

  const batchSize = normalizeBatchSize(params?.batchSize);
  const targetRouterKeys = normalizeStringList(params?.targetRouterKeys, "targetRouterKeys");
  validateTargetRouterKeys(targetRouterKeys);

  let templatesToCreate = normalizeProvidedTemplates(providedTemplates);
  let loadResults = {
    searchedTemplateNames: [],
    foundTemplates: templatesToCreate.map(summarizeTemplate),
    errors: []
  };

  if (templatesToCreate.length === 0) {
    const loaded = await loadTemplatesByNames({
      sourceRouterKey,
      templateNames,
      onlyApproved: Boolean(onlyApproved),
      continueOnError: Boolean(continueOnError),
      batchSize
    });

    templatesToCreate = loaded.templates;
    loadResults = loaded.loadResults;
  }

  const createJobs = [];
  for (const template of templatesToCreate) {
    for (let targetIndex = 0; targetIndex < targetRouterKeys.length; targetIndex++) {
      createJobs.push({
        template,
        targetRouterKey: targetRouterKeys[targetIndex],
        targetIndex
      });
    }
  }

  const results = {
    searchedTemplateNames: loadResults.searchedTemplateNames,
    foundTemplates: templatesToCreate.map(summarizeTemplate),
    created: [],
    errors: [...loadResults.errors]
  };

  await runInBatches(createJobs, batchSize, async (job) => {
    try {
      const createResult = await createTemplateOnTargetRouter({
        ...job,
        dryRun: Boolean(dryRun)
      });

      results.created.push(createResult);
      return createResult;
    } catch (error) {
      const errorInfo = {
        step: "create_template",
        templateName: job.template.name,
        language: job.template.language,
        targetIndex: job.targetIndex,
        message: error.message
      };

      results.errors.push(errorInfo);

      if (!continueOnError) {
        throw error;
      }

      return errorInfo;
    }
  });

  return {
    options: {
      dryRun: Boolean(dryRun),
      continueOnError: Boolean(continueOnError),
      onlyApproved: Boolean(onlyApproved),
      batchSize
    },
    totals: {
      foundTemplates: results.foundTemplates.length,
      targetRouters: targetRouterKeys.length,
      createJobs: createJobs.length,
      uploadedAttachments: results.created.reduce((total, item) => total + Number(item.uploadedAttachments || 0), 0),
      created: results.created.length,
      errors: results.errors.length
    },
    ...results
  };
}

async function compareTemplates(params) {
  const sourceRouterKey = typeof params?.sourceRouterKey === "string"
    ? params.sourceRouterKey.trim()
    : "";
  const targetRouterKeys = normalizeStringList(
    params?.targetRouterKeys || params?.routerKeys,
    "routerKeys"
  );
  const routerEntries = [];
  const seenRouterKeys = new Set();

  if (sourceRouterKey) {
    routerEntries.push({
      routerKey: sourceRouterKey,
      routerIndex: 0,
      role: "source"
    });
    seenRouterKeys.add(sourceRouterKey);
  }

  for (const routerKey of targetRouterKeys) {
    if (!seenRouterKeys.has(routerKey)) {
      routerEntries.push({
        routerKey,
        routerIndex: routerEntries.length,
        role: sourceRouterKey ? "target" : "router"
      });
      seenRouterKeys.add(routerKey);
    }
  }

  if (routerEntries.length < 2) {
    throw new InputError(sourceRouterKey
      ? "Informe o router de origem e pelo menos um router de destino para comparar."
      : "Informe pelo menos dois routers para comparar.");
  }

  const filters = {
    category: normalizeFilterText(params?.category),
    status: normalizeFilterText(params?.status)
  };

  const routerResults = await Promise.all(routerEntries.map(async (routerEntry) => {
    const templates = await getTemplatesFromRouter(routerEntry.routerKey);
    const filteredTemplates = templates.filter(template => (
      template.name
      && template.language
      && templateMatchesCompareFilters(template, filters)
    ));

    const templatesByKey = new Map();
    for (const template of filteredTemplates) {
      const key = getTemplateKey(template);
      if (!templatesByKey.has(key)) {
        templatesByKey.set(key, template);
      }
    }

    return {
      routerIndex: routerEntry.routerIndex,
      role: routerEntry.role,
      totalTemplates: templates.length,
      totalFilteredTemplates: templatesByKey.size,
      templatesByKey
    };
  }));

  const firstRouter = routerResults[0];
  const commonKeys = Array.from(firstRouter.templatesByKey.keys())
    .filter(key => routerResults.every(router => router.templatesByKey.has(key)));

  const commonTemplates = commonKeys
    .map((key) => {
      const firstTemplate = firstRouter.templatesByKey.get(key);

      return {
        ...summarizeTemplate(firstTemplate),
        routers: routerResults.map((router) => ({
          routerIndex: router.routerIndex,
          role: router.role,
          ...summarizeTemplate(router.templatesByKey.get(key))
        }))
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language));

  return {
    filters,
    totals: {
      routers: routerEntries.length,
      sourceRouterIncluded: Boolean(sourceRouterKey),
      commonTemplates: commonTemplates.length,
      templatesByRouter: routerResults.map(router => ({
        routerIndex: router.routerIndex,
        role: router.role,
        totalTemplates: router.totalTemplates,
        totalFilteredTemplates: router.totalFilteredTemplates
      }))
    },
    commonTemplates
  };
}

module.exports = {
  InputError,
  searchTemplates,
  compareTemplates,
  replicateTemplates
};
