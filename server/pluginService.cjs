const { randomUUID } = require("node:crypto");

const MSGING_COMMANDS_URL = "https://msging.net/commands";
const DEFAULT_BATCH_SIZE = 15;
const PLUGINS_CONFIGURATION_URI = "lime://postmaster@portal.blip.ai/configuration";
const PLUGINS_CONFIGURATION_TO = "postmaster@msging.net";

class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
    this.statusCode = 400;
  }
}

function normalizeStringList(value, fieldName) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[\n,;]+/)
      .map((item) => item.trim())
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

async function sendBlipCommand(routerKey, command) {
  const response = await fetch(MSGING_COMMANDS_URL, {
    method: "POST",
    headers: {
      Authorization: routerKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
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
    throw new Error(
      `Comando retornou status "${responseBody.status}": ${JSON.stringify(responseBody, null, 2)}`,
    );
  }

  return responseBody;
}

async function runInBatches(items, batchSize, handler) {
  const results = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((item, index) => handler(item, i + index)));

    results.push(...batchResults);
  }

  return results;
}

function buildGetPluginsCommand() {
  return {
    method: "get",
    id: randomUUID(),
    uri: PLUGINS_CONFIGURATION_URI,
    to: PLUGINS_CONFIGURATION_TO,
  };
}

function buildSetPluginsCommand(plugins) {
  return {
    method: "set",
    id: randomUUID(),
    uri: PLUGINS_CONFIGURATION_URI,
    type: "application/json",
    to: PLUGINS_CONFIGURATION_TO,
    resource: {
      Plugins: pluginsToResource(plugins),
    },
  };
}

function parsePluginsResource(rawPlugins) {
  if (rawPlugins == null || rawPlugins === "") {
    return {};
  }

  if (typeof rawPlugins === "string") {
    try {
      const parsed = JSON.parse(rawPlugins);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      throw new Error("A configuração Plugins retornou um JSON inválido.");
    }
  }

  if (typeof rawPlugins === "object" && !Array.isArray(rawPlugins)) {
    return rawPlugins;
  }

  return {};
}

function extractPluginsFromResponse(responseBody) {
  const pluginsById = parsePluginsResource(responseBody?.resource?.Plugins);

  return Object.entries(pluginsById)
    .map(([id, plugin]) => ({
      id: String(id).trim(),
      name:
        plugin && typeof plugin === "object" && typeof plugin.name === "string"
          ? plugin.name.trim()
          : "",
      url:
        plugin && typeof plugin === "object" && typeof plugin.url === "string"
          ? plugin.url.trim()
          : "",
    }))
    .filter((plugin) => plugin.id && plugin.name && plugin.url);
}

function normalizePlugin(plugin) {
  if (!plugin || typeof plugin !== "object") {
    throw new InputError("Cada plugin precisa ser um objeto.");
  }

  const normalized = {
    id: typeof plugin.id === "string" ? plugin.id.trim() : "",
    name: typeof plugin.name === "string" ? plugin.name.trim() : "",
    url: typeof plugin.url === "string" ? plugin.url.trim() : "",
  };

  if (!normalized.id) {
    throw new InputError("Cada plugin precisa ter um id.");
  }

  if (!normalized.name) {
    throw new InputError(`Plugin ${normalized.id} precisa ter um nome.`);
  }

  if (!normalized.url) {
    throw new InputError(`Plugin ${normalized.name} precisa ter uma URL.`);
  }

  return normalized;
}

function normalizePlugins(plugins) {
  if (!Array.isArray(plugins)) {
    throw new InputError("plugins precisa ser um array.");
  }

  const seenIds = new Set();
  return plugins.map((plugin) => {
    const normalized = normalizePlugin(plugin);

    if (seenIds.has(normalized.id)) {
      throw new InputError(`ID de plugin duplicado: ${normalized.id}.`);
    }

    seenIds.add(normalized.id);
    return normalized;
  });
}

function pluginsToResource(plugins) {
  return Object.fromEntries(
    plugins.map((plugin) => [
      plugin.id,
      {
        name: plugin.name,
        url: plugin.url,
      },
    ]),
  );
}

function normalizePluginName(name) {
  return String(name || "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function findNameConflicts(existingPlugins, incomingPlugins) {
  const conflicts = [];
  const existingByName = new Map();

  for (const existing of existingPlugins) {
    const key = normalizePluginName(existing.name);
    if (!key) continue;

    const current = existingByName.get(key) || [];
    current.push(existing);
    existingByName.set(key, current);
  }

  for (const plugin of incomingPlugins) {
    const matches = existingByName.get(normalizePluginName(plugin.name)) || [];

    for (const existing of matches) {
      if (existing.id !== plugin.id) {
        conflicts.push({
          pluginId: plugin.id,
          pluginName: plugin.name,
          existingId: existing.id,
          existingName: existing.name,
        });
      }
    }
  }

  return conflicts;
}

function mergePlugins(existingPlugins, incomingPlugins, replaceDuplicates) {
  const conflicts = findNameConflicts(existingPlugins, incomingPlugins);

  if (conflicts.length > 0 && !replaceDuplicates) {
    const names = Array.from(new Set(conflicts.map((conflict) => conflict.pluginName))).join(", ");
    throw new InputError(`Já existe plugin com nome igual no destino: ${names}.`);
  }

  const nextById = new Map(existingPlugins.map((plugin) => [plugin.id, plugin]));

  if (replaceDuplicates) {
    for (const conflict of conflicts) {
      nextById.delete(conflict.existingId);
    }
  }

  for (const plugin of incomingPlugins) {
    nextById.set(plugin.id, plugin);
  }

  return {
    plugins: Array.from(nextById.values()),
    conflicts,
  };
}

async function getPluginsFromRouter(routerKey) {
  const response = await sendBlipCommand(routerKey, buildGetPluginsCommand());

  return {
    plugins: extractPluginsFromResponse(response),
    response,
  };
}

async function setPluginsOnRouter(routerKey, plugins) {
  const normalizedPlugins = normalizePlugins(plugins);
  const response = await sendBlipCommand(routerKey, buildSetPluginsCommand(normalizedPlugins));

  return {
    total: normalizedPlugins.length,
    plugins: normalizedPlugins,
    response,
  };
}

async function searchPlugins(params) {
  const { sourceRouterKey } = params || {};
  validateSourceRouterKey(sourceRouterKey);

  const data = await getPluginsFromRouter(sourceRouterKey);

  return {
    total: data.plugins.length,
    plugins: data.plugins,
    response: data.response,
  };
}

async function savePlugins(params) {
  const { sourceRouterKey, plugins } = params || {};
  validateSourceRouterKey(sourceRouterKey);

  return setPluginsOnRouter(sourceRouterKey, plugins);
}

async function getPluginConflicts(params) {
  const targetRouterKeys = Array.from(
    new Set(normalizeStringList(params?.targetRouterKeys, "targetRouterKeys")),
  );
  validateTargetRouterKeys(targetRouterKeys);

  const plugins = normalizePlugins(params?.plugins || []);
  const batchSize = normalizeBatchSize(params?.batchSize);
  const conflicts = [];

  await runInBatches(targetRouterKeys, batchSize, async (targetRouterKey, targetIndex) => {
    const { plugins: existingPlugins } = await getPluginsFromRouter(targetRouterKey);
    const targetConflicts = findNameConflicts(existingPlugins, plugins);

    conflicts.push(
      ...targetConflicts.map((conflict) => ({
        ...conflict,
        targetIndex,
      })),
    );
  });

  return {
    totals: {
      targetRouters: targetRouterKeys.length,
      conflicts: conflicts.length,
    },
    conflicts,
  };
}

async function replicatePlugins(params) {
  const targetRouterKeys = Array.from(
    new Set(normalizeStringList(params?.targetRouterKeys, "targetRouterKeys")),
  );
  validateTargetRouterKeys(targetRouterKeys);

  const plugins = normalizePlugins(params?.plugins || []);
  if (plugins.length === 0) {
    throw new InputError("Selecione pelo menos um plugin.");
  }

  const mode = params?.mode === "replace" ? "replace" : "add";
  const batchSize = normalizeBatchSize(params?.batchSize);
  const continueOnError = params?.continueOnError !== false;
  const replaceDuplicates = Boolean(params?.replaceDuplicates);
  const results = {
    copied: [],
    errors: [],
  };

  await runInBatches(targetRouterKeys, batchSize, async (targetRouterKey, targetIndex) => {
    try {
      let pluginsToSave = plugins;
      let conflicts = [];
      let previousTotal = null;

      if (mode === "add") {
        const { plugins: existingPlugins } = await getPluginsFromRouter(targetRouterKey);
        const merged = mergePlugins(existingPlugins, plugins, replaceDuplicates);

        previousTotal = existingPlugins.length;
        pluginsToSave = merged.plugins;
        conflicts = merged.conflicts;
      }

      const saveResult = await setPluginsOnRouter(targetRouterKey, pluginsToSave);
      const copyResult = {
        status: "success",
        targetIndex,
        mode,
        previousTotal,
        copiedPlugins: plugins.length,
        totalPlugins: saveResult.total,
        replacedByName: conflicts.length,
        response: saveResult.response,
      };

      results.copied.push(copyResult);
      return copyResult;
    } catch (error) {
      const errorInfo = {
        step: mode === "replace" ? "replace_plugins" : "add_plugins",
        targetIndex,
        message: error.message,
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
      mode,
      continueOnError,
      batchSize,
      replaceDuplicates,
    },
    totals: {
      plugins: plugins.length,
      targetRouters: targetRouterKeys.length,
      copied: results.copied.length,
      errors: results.errors.length,
    },
    ...results,
  };
}

module.exports = {
  InputError,
  searchPlugins,
  savePlugins,
  getPluginConflicts,
  replicatePlugins,
};
