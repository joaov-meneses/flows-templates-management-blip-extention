const { createHash, randomUUID } = require("node:crypto");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { parseWhatsAppPhone } = require("./routerDirectoryService.cjs");

const COMMANDS_URL = "https://msging.net/commands";
const MAX_RESOURCES = 100;
const MAX_RESOURCE_TEXT = 512_000;
const VARIABLE_PATTERN = /\{\{router\.(id|key|number)\}\}/g;

class RouterResourceInputError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

function assertShortName(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    throw new RouterResourceInputError(`${label} inválido.`);
  }
  return value;
}

function assertKey(value, label) {
  if (typeof value !== "string" || !/^Key [A-Za-z0-9+/=]+$/.test(value)) {
    throw new RouterResourceInputError(`${label} inválida.`);
  }
  return value;
}

function reasonOf(response) {
  return response?.reason?.description || response?.status || "Resposta inesperada da Blip.";
}

async function command(key, request, { allowEmptyResourceList = false } = {}) {
  const response = await fetch(COMMANDS_URL, {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({ id: randomUUID(), ...request }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${reasonOf(body)}`);
  if (body.status !== "success") {
    const reason = reasonOf(body);
    if (
      allowEmptyResourceList &&
      typeof reason === "string" &&
      reason.trim().toLowerCase() === "no keys has been found"
    ) {
      return {
        ...body,
        status: "success",
        resource: { total: 0, items: [] },
      };
    }
    throw new Error(reason);
  }
  return body;
}

function serializeResource(resource) {
  return typeof resource === "string"
    ? { format: "text", value: resource }
    : { format: "json", value: JSON.stringify(resource, null, 2) };
}

function comparable(type, resource) {
  return JSON.stringify({ type: type || "application/json", resource });
}

async function readResourceIds(routerKey) {
  const response = await command(
    routerKey,
    {
      method: "get",
      uri: `/resources?skip=0&take=${MAX_RESOURCES}`,
    },
    { allowEmptyResourceList: true },
  );
  const items = response.resource?.items;
  if (!Array.isArray(items) || items.some((item) => typeof item !== "string")) {
    throw new Error("A Blip retornou uma lista de recursos inválida.");
  }
  if (Number(response.resource?.total || items.length) > MAX_RESOURCES) {
    throw new Error(
      `O router possui mais de ${MAX_RESOURCES} recursos; refine o limite antes de copiar.`,
    );
  }
  return items;
}

async function readResource(routerKey, resourceKey) {
  const response = await command(routerKey, {
    method: "get",
    uri: `/resources/${encodeURIComponent(resourceKey)}`,
  });
  if (!("resource" in response)) {
    throw new Error(`A Blip não retornou o valor do recurso ${resourceKey}.`);
  }
  const serialized = serializeResource(response.resource);
  if (typeof serialized.value !== "string") {
    throw new Error(`O recurso ${resourceKey} possui um formato não serializável.`);
  }
  return {
    key: resourceKey,
    type: typeof response.type === "string" ? response.type : "application/json",
    resource: response.resource,
    ...serialized,
  };
}

async function readResources(routerKey) {
  const ids = await readResourceIds(routerKey);
  return Promise.all(ids.map((resourceKey) => readResource(routerKey, resourceKey)));
}

function validateTargets(targets) {
  if (!Array.isArray(targets) || !targets.length) {
    throw new RouterResourceInputError("Selecione pelo menos um router de destino.");
  }
  const seen = new Set();
  return targets.map((target) => {
    const shortName = assertShortName(target?.shortName, "Router de destino");
    if (seen.has(shortName)) throw new RouterResourceInputError("Router de destino duplicado.");
    seen.add(shortName);
    return { shortName, key: assertKey(target?.key, "Key de destino") };
  });
}

async function previewRouterResources(params) {
  const sourceShortName = assertShortName(params?.sourceShortName, "Router de origem");
  const sourceKey = assertKey(params?.sourceRouterKey, "Key de origem");
  const targets = validateTargets(params?.targets);
  if (targets.some((target) => target.shortName === sourceShortName)) {
    throw new RouterResourceInputError("Origem e destino precisam ser diferentes.");
  }
  const [sourceResources, ...targetResources] = await Promise.all([
    readResources(sourceKey),
    ...targets.map((target) => readResources(target.key)),
  ]);
  return {
    source: {
      shortName: sourceShortName,
      resources: sourceResources.map(({ resource, ...item }) => item),
    },
    targets: targets.map((target, index) => {
      const resources = targetResources[index];
      const byKey = new Map(resources.map((item) => [item.key, item]));
      return {
        shortName: target.shortName,
        resources: sourceResources.map((source) => {
          const current = byKey.get(source.key);
          return {
            key: source.key,
            status: !current
              ? "missing"
              : comparable(current.type, current.resource) ===
                  comparable(source.type, source.resource)
                ? "same"
                : "different",
            targetType: current?.type || null,
          };
        }),
      };
    }),
  };
}

function validateDrafts(resources) {
  if (!Array.isArray(resources) || !resources.length) {
    throw new RouterResourceInputError("Selecione pelo menos um recurso.");
  }
  const seen = new Set();
  return resources.map((item) => {
    const key = typeof item?.key === "string" ? item.key.trim() : "";
    const type = typeof item?.type === "string" ? item.type.trim() : "";
    const format = item?.format;
    const value = item?.value;
    if (!key || key.length > 200 || seen.has(key)) {
      throw new RouterResourceInputError("Chave de recurso inválida ou duplicada.");
    }
    if (!type || type.length > 200 || !["text", "json"].includes(format)) {
      throw new RouterResourceInputError(`Tipo ou formato inválido no recurso ${key}.`);
    }
    if (typeof value !== "string" || value.length > MAX_RESOURCE_TEXT) {
      throw new RouterResourceInputError(`Valor inválido no recurso ${key}.`);
    }
    seen.add(key);
    return { key, type, format, value };
  });
}

async function resolveVariables(text, target) {
  let phoneNumber = null;
  if (text.includes("{{router.number}}")) {
    const gateway = await command(target.key, { method: "get", uri: "/configuration/gateways" });
    phoneNumber = parseWhatsAppPhone(gateway.resource).phoneNumber;
    if (!phoneNumber) {
      throw new Error(`Router ${target.shortName}: número conectado não encontrado.`);
    }
  }
  return text.replace(VARIABLE_PATTERN, (_match, variable) => {
    if (variable === "id") return target.shortName;
    if (variable === "key") return target.key;
    return phoneNumber;
  });
}

async function cloneRouterResources(params) {
  const targetShortName = assertShortName(params?.targetShortName, "Router de destino");
  const targetKey = assertKey(params?.targetRouterKey, "Key de destino");
  const drafts = validateDrafts(params?.resources);
  const target = { shortName: targetShortName, key: targetKey };
  const existingIds = new Set(await readResourceIds(targetKey));
  const before = [];
  for (const draft of drafts) {
    before.push(
      existingIds.has(draft.key)
        ? await readResource(targetKey, draft.key)
        : { key: draft.key, missing: true },
    );
  }
  const backupDirectory = path.join(process.cwd(), ".local", "router-resource-backups");
  await mkdir(backupDirectory, { recursive: true });
  const backupName = `${targetShortName}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.json`;
  await writeFile(
    path.join(backupDirectory, backupName),
    JSON.stringify({ targetShortName, resources: before }, null, 2),
    { flag: "wx", mode: 0o600 },
  );
  let copied = 0;
  for (const draft of drafts) {
    const resolved = await resolveVariables(draft.value, target);
    let resource;
    try {
      resource = draft.format === "json" ? JSON.parse(resolved) : resolved;
    } catch {
      throw new RouterResourceInputError(`JSON inválido no recurso ${draft.key}.`);
    }
    await command(targetKey, {
      method: "set",
      uri: `/resources/${encodeURIComponent(draft.key)}`,
      type: draft.type,
      resource,
    });
    const verified = await readResource(targetKey, draft.key);
    if (comparable(verified.type, verified.resource) !== comparable(draft.type, resource)) {
      throw new Error(`A leitura não confirmou o recurso ${draft.key} em ${targetShortName}.`);
    }
    copied += 1;
  }
  return { status: "success", copied, backup: backupName };
}

module.exports = {
  RouterResourceInputError,
  previewRouterResources,
  cloneRouterResources,
};
