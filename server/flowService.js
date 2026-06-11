const { randomUUID } = require("node:crypto");

const MSGING_COMMANDS_URL = "https://msging.net/commands";
const HTTP_MSGING_COMMANDS_URL = "https://http.msging.net/commands";
const DEFAULT_BATCH_SIZE = 15;
const BUSINESS_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAobejfP2Gbt4/Hvqwrgcm
O/98+0koGf3Y9WqayHiQofNI/eMPdHdf+o2mOG3r3R6bVq0bmatX7FcFvBSama6l
Uc9WcZc2mLVMu+oq2qCwYlj0ZZESLyjM13Rtg1WoLlNntYogCS982kL8yECQs9vz
a+ahYCqc47leCIU3RZSGcAHNIpkTP48zIboftNfc1I/EGgvfBkdVs689FRh2DvLO
CqVivtUuzfSCsl6fqFmEND4KXXG2ANTsxGPjdDZxwjGsbNpbvVsRUw5q1V+gR6XO
nJDyEO0QebZX/qE/NPP5tev+YwHr50gwJTxwrGu4rqvYlxTtJkeATqSDSffWG5UD
ewIDAQAB
-----END PUBLIC KEY-----`;

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

function normalizeBatchSize(batchSize) {
  const normalized = Number(batchSize || DEFAULT_BATCH_SIZE);

  if (!Number.isInteger(normalized) || normalized <= 0 || normalized > 50) {
    throw new InputError("batchSize precisa ser um inteiro entre 1 e 50.");
  }

  return normalized;
}

async function sendBlipCommand(routerKey, command, options = {}) {
  const response = await fetch(options.commandUrl || MSGING_COMMANDS_URL, {
    method: "POST",
    headers: {
      Authorization: routerKey,
      "Content-Type": "application/json",
      ...(options.headers || {})
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

function buildCommand(method, uri, resource) {
  const command = {
    id: randomUUID(),
    to: "postmaster@wa.gw.msging.net",
    method,
    uri
  };

  if (resource !== undefined) {
    command.type = "application/json";
    command.resource = resource;
  }

  return command;
}

async function uploadFlowPublicKey(targetRouterKey, targetIndex) {
  const response = await sendBlipCommand(
    targetRouterKey,
    buildCommand("set", "/whatsapp-flows/public-key/upload", {
      business_public_key: BUSINESS_PUBLIC_KEY
    }),
    {
      commandUrl: HTTP_MSGING_COMMANDS_URL,
      headers: {
        "Content-Transfer-Encoding": "application/json"
      }
    }
  );

  return {
    status: "success",
    targetIndex,
    response
  };
}

function extractFlowsFromResponse(responseBody) {
  const flows = responseBody?.resource?.data;
  return Array.isArray(flows) ? flows : [];
}

function summarizeFlow(flow) {
  return {
    id: String(flow.id || ""),
    name: flow.name || "",
    status: flow.status,
    categories: Array.isArray(flow.categories) ? flow.categories : [],
    validation_errors: Array.isArray(flow.validation_errors) ? flow.validation_errors : []
  };
}

function normalizeProvidedFlows(flows) {
  if (!Array.isArray(flows) || flows.length === 0) {
    throw new InputError("flows precisa ter pelo menos um flow selecionado.");
  }

  const uniqueFlows = new Map();
  for (const flow of flows) {
    if (!flow || typeof flow !== "object" || !flow.id) {
      throw new InputError("Cada flow selecionado precisa ter um id.");
    }

    uniqueFlows.set(String(flow.id), {
      id: String(flow.id),
      name: flow.name || ""
    });
  }

  return Array.from(uniqueFlows.values());
}

async function searchFlows(params) {
  const { sourceRouterKey } = params || {};
  validateSourceRouterKey(sourceRouterKey);

  const responseBody = await sendBlipCommand(
    sourceRouterKey,
    buildCommand("get", "/whatsapp-flows")
  );

  const flows = extractFlowsFromResponse(responseBody).map(summarizeFlow);

  return {
    total: flows.length,
    flows
  };
}

async function getFlowDetails(sourceRouterKey, flowId) {
  validateSourceRouterKey(sourceRouterKey);

  if (!flowId) {
    throw new InputError("flowId precisa ser informado.");
  }

  const responseBody = await sendBlipCommand(
    sourceRouterKey,
    buildCommand("get", `/whatsapp-flows/${encodeURIComponent(String(flowId))}`)
  );

  return responseBody?.resource || null;
}

async function getFlowPreview(params) {
  const { sourceRouterKey, flowId } = params || {};
  const flow = await getFlowDetails(sourceRouterKey, flowId);
  const previewUrl = flow?.preview?.preview_url;

  if (!previewUrl) {
    throw new Error("O flow não retornou preview_url.");
  }

  return {
    flow,
    previewUrl,
    expiresAt: flow?.preview?.expires_at
  };
}

async function getFlowAssets(sourceRouterKey, flowId) {
  validateSourceRouterKey(sourceRouterKey);

  if (!flowId) {
    throw new InputError("flowId precisa ser informado.");
  }

  const responseBody = await sendBlipCommand(
    sourceRouterKey,
    buildCommand("get", `/whatsapp-flows/assets/${encodeURIComponent(String(flowId))}`)
  );

  const assets = responseBody?.resource?.data;
  return Array.isArray(assets) ? assets : [];
}

function getFlowJsonDownloadUrl(assets) {
  const asset = assets.find(item => item?.asset_type === "FLOW_JSON")
    || assets.find(item => item?.name === "flow.json")
    || assets.find(item => item?.download_url);

  return asset?.download_url || "";
}

async function downloadJson(downloadUrl) {
  const response = await fetch(downloadUrl);
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Erro HTTP ${response.status} ao baixar o JSON do flow: ${responseText}`);
  }

  try {
    return responseText ? JSON.parse(responseText) : null;
  } catch {
    throw new Error("O download_url retornou um conteúdo que não é JSON válido.");
  }
}

async function getFlowJson(params) {
  const { sourceRouterKey, flowId } = params || {};
  const assets = await getFlowAssets(sourceRouterKey, flowId);
  const downloadUrl = getFlowJsonDownloadUrl(assets);

  if (!downloadUrl) {
    throw new Error("Não foi encontrado download_url para o JSON do flow.");
  }

  const json = await downloadJson(downloadUrl);

  return {
    flowId: String(flowId),
    downloadUrl,
    json
  };
}

function buildCreateFlowResource(flowDetails, fallbackFlow) {
  const endpointUri = flowDetails?.endpoint_uri;
  const resource = {
    name: flowDetails?.name || fallbackFlow.name || `Flow ${fallbackFlow.id}`,
    categories: ["OTHER"]
  };

  if (endpointUri) {
    resource.endpoint_uri = endpointUri;
  }

  return resource;
}

function normalizeFlowJson(flowJson) {
  if (typeof flowJson === "string") {
    try {
      return JSON.parse(flowJson);
    } catch {
      throw new InputError("flowJson precisa ser um JSON válido.");
    }
  }

  if (!flowJson || typeof flowJson !== "object") {
    throw new InputError("flowJson precisa ser um objeto JSON.");
  }

  return flowJson;
}

function buildNewFlowResource({ name, isFlowApi, endpointUri }) {
  const normalizedName = typeof name === "string" ? name.trim() : "";
  const normalizedEndpointUri = typeof endpointUri === "string" ? endpointUri.trim() : "";

  if (!normalizedName) {
    throw new InputError("name precisa ser informado.");
  }

  if (isFlowApi && !normalizedEndpointUri) {
    throw new InputError("endpointUri precisa ser informado para Flow API.");
  }

  const resource = {
    name: normalizedName,
    categories: ["OTHER"]
  };

  if (isFlowApi) {
    resource.endpoint_uri = normalizedEndpointUri;
  }

  return resource;
}

async function createFlow(params) {
  const {
    sourceRouterKey,
    name,
    isFlowApi = false,
    endpointUri = "",
    flowJson
  } = params || {};

  validateSourceRouterKey(sourceRouterKey);

  const normalizedFlowJson = normalizeFlowJson(flowJson);
  const createResource = buildNewFlowResource({
    name,
    isFlowApi: Boolean(isFlowApi),
    endpointUri
  });

  const createResponse = await sendBlipCommand(
    sourceRouterKey,
    buildCommand("set", "/whatsapp-flows", createResource)
  );

  const flowId = createResponse?.resource?.id;
  if (!flowId) {
    throw new Error(`A criação do flow "${createResource.name}" não retornou resource.id.`);
  }

  const setJsonResponse = await sendBlipCommand(
    sourceRouterKey,
    buildCommand("set", `/whatsapp-flows/flow-json/${encodeURIComponent(String(flowId))}`, normalizedFlowJson)
  );

  return {
    flow: {
      id: String(flowId),
      name: createResource.name,
      status: "DRAFT",
      categories: createResource.categories,
      endpoint_uri: createResource.endpoint_uri
    },
    createResponse,
    setJsonResponse
  };
}

async function publishFlow(params) {
  const { sourceRouterKey, flowId } = params || {};
  validateSourceRouterKey(sourceRouterKey);

  if (!flowId) {
    throw new InputError("flowId precisa ser informado.");
  }

  const publishResponse = await sendBlipCommand(
    sourceRouterKey,
    buildCommand("get", `/whatsapp-flows/publish/${encodeURIComponent(String(flowId))}`)
  );

  return {
    flowId: String(flowId),
    publishResponse
  };
}

async function createFlowOnTarget({
  targetRouterKey,
  targetIndex,
  sourceFlow,
  flowDetails,
  flowJson
}) {
  const createResponse = await sendBlipCommand(
    targetRouterKey,
    buildCommand("set", "/whatsapp-flows", buildCreateFlowResource(flowDetails, sourceFlow))
  );

  const newFlowId = createResponse?.resource?.id;
  if (!newFlowId) {
    throw new Error(`A criação do flow "${sourceFlow.name || sourceFlow.id}" não retornou resource.id.`);
  }

  const setJsonResponse = await sendBlipCommand(
    targetRouterKey,
    buildCommand("set", `/whatsapp-flows/flow-json/${encodeURIComponent(String(newFlowId))}`, flowJson)
  );

  const publishResponse = await sendBlipCommand(
    targetRouterKey,
    buildCommand("get", `/whatsapp-flows/publish/${encodeURIComponent(String(newFlowId))}`)
  );

  return {
    status: "success",
    sourceFlowId: sourceFlow.id,
    sourceFlowName: flowDetails?.name || sourceFlow.name,
    newFlowId,
    targetIndex,
    createResponse,
    setJsonResponse,
    publishResponse
  };
}

async function loadFlowPayload(sourceRouterKey, flow) {
  const [flowDetails, flowJsonResult] = await Promise.all([
    getFlowDetails(sourceRouterKey, flow.id),
    getFlowJson({ sourceRouterKey, flowId: flow.id })
  ]);

  return {
    sourceFlow: {
      ...flow,
      name: flowDetails?.name || flow.name
    },
    flowDetails,
    flowJson: flowJsonResult.json
  };
}

async function replicateFlows(params) {
  const {
    sourceRouterKey,
    flows,
    continueOnError = true
  } = params || {};

  validateSourceRouterKey(sourceRouterKey);

  const batchSize = normalizeBatchSize(params?.batchSize);
  const targetRouterKeys = Array.from(new Set(normalizeStringList(params?.targetRouterKeys, "targetRouterKeys")));
  validateTargetRouterKeys(targetRouterKeys);

  const selectedFlows = normalizeProvidedFlows(flows);
  const results = {
    foundFlows: selectedFlows,
    publicKeyUploads: [],
    copied: [],
    errors: []
  };

  const targetsWithPublicKey = [];
  await runInBatches(targetRouterKeys, batchSize, async (targetRouterKey, targetIndex) => {
    try {
      const uploadResult = await uploadFlowPublicKey(targetRouterKey, targetIndex);
      results.publicKeyUploads.push(uploadResult);
      targetsWithPublicKey.push({
        targetRouterKey,
        targetIndex
      });
      return uploadResult;
    } catch (error) {
      const errorInfo = {
        step: "upload_public_key",
        targetIndex,
        message: error.message
      };
      results.errors.push(errorInfo);

      if (!continueOnError) {
        throw error;
      }

      return errorInfo;
    }
  });

  const payloads = [];
  if (targetsWithPublicKey.length > 0) {
    await runInBatches(selectedFlows, batchSize, async (flow) => {
      try {
        const payload = await loadFlowPayload(sourceRouterKey, flow);
        payloads.push(payload);
        return payload;
      } catch (error) {
        const errorInfo = {
          step: "load_flow",
          flowId: flow.id,
          flowName: flow.name,
          message: error.message
        };
        results.errors.push(errorInfo);

        if (!continueOnError) {
          throw error;
        }

        return errorInfo;
      }
    });
  }

  const createJobs = [];
  for (const payload of payloads) {
    for (const target of targetsWithPublicKey) {
      createJobs.push({
        ...payload,
        targetRouterKey: target.targetRouterKey,
        targetIndex: target.targetIndex
      });
    }
  }

  await runInBatches(createJobs, batchSize, async (job) => {
    try {
      const copyResult = await createFlowOnTarget(job);
      results.copied.push(copyResult);
      return copyResult;
    } catch (error) {
      const errorInfo = {
        step: "copy_flow",
        flowId: job.sourceFlow.id,
        flowName: job.sourceFlow.name,
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
      continueOnError: Boolean(continueOnError),
      batchSize
    },
    totals: {
      foundFlows: selectedFlows.length,
      publicKeyUploads: results.publicKeyUploads.length,
      loadedFlows: payloads.length,
      targetRouters: targetRouterKeys.length,
      createJobs: createJobs.length,
      copied: results.copied.length,
      errors: results.errors.length
    },
    ...results
  };
}

module.exports = {
  InputError,
  searchFlows,
  getFlowPreview,
  getFlowJson,
  createFlow,
  publishFlow,
  replicateFlows
};
