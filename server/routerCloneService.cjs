const { createHash, randomUUID } = require("node:crypto");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");

const COMMANDS_URL = "https://msging.net/commands";
const CONFIGURATIONS_TO = "postmaster@configurations.msging.net";
const CONFIGURATION_HOSTS = [
  "master.hosting",
  "business.master.hosting",
  "enterprise.master.hosting",
];

class RouterCloneInputError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

function assertShortName(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    throw new RouterCloneInputError(`${label} inválido.`);
  }
  return value;
}

function assertKey(value, label) {
  if (typeof value !== "string" || !/^Key [A-Za-z0-9+/=]+$/.test(value)) {
    throw new RouterCloneInputError(`${label} inválida.`);
  }
  return value;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function reasonOf(response) {
  return response?.reason?.description || response?.status || "Resposta inesperada da Blip.";
}

async function command(key, request) {
  const response = await fetch(COMMANDS_URL, {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({ id: randomUUID(), ...request }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${reasonOf(body)}`);
  return body;
}

function decodeConfiguration(resource, expectedShortName) {
  if (!resource || typeof resource !== "object" || typeof resource.Application !== "string") {
    throw new Error("Configuração avançada Application ausente.");
  }
  const application = JSON.parse(resource.Application);
  if (
    application?.identifier !== expectedShortName ||
    !Array.isArray(application?.settings?.children)
  ) {
    throw new Error(
      `A configuração não pertence ao router ${expectedShortName} ou não contém serviços válidos.`,
    );
  }
  const services = application.settings.children;
  const identities = new Set();
  for (const service of services) {
    if (
      !service ||
      typeof service.identity !== "string" ||
      !service.identity.endsWith("@msging.net") ||
      identities.has(service.identity)
    ) {
      throw new Error("A configuração contém um serviço inválido ou duplicado.");
    }
    identities.add(service.identity);
  }
  return { application, services, applicationHash: hash(resource.Application) };
}

async function readRouterConfigurationIfPresent(routerKey, routerShortName) {
  assertKey(routerKey, "Key do router");
  assertShortName(routerShortName, "ID do router");
  for (const host of CONFIGURATION_HOSTS) {
    const response = await command(routerKey, {
      to: CONFIGURATIONS_TO,
      method: "get",
      uri: `lime://${host}@msging.net/configuration`,
    });
    if (response.status === "success") {
      let decoded;
      try {
        decoded = decodeConfiguration(response.resource, routerShortName);
      } catch (error) {
        throw new Error(`Router ${routerShortName}: ${error.message}`);
      }
      return { host, resource: response.resource, ...decoded };
    }
    const reason = reasonOf(response);
    if (response.reason?.code !== 67 && !/not found/i.test(reason)) {
      throw new Error(
        `Router ${routerShortName}: não foi possível ler a configuração (${reason}).`,
      );
    }
  }
  const account = await command(routerKey, {
    to: "postmaster@msging.net",
    method: "get",
    uri: "/account",
  });
  if (account.status !== "success") {
    throw new Error(
      `Router ${routerShortName}: a chave não pôde ser validada (${reasonOf(account)}).`,
    );
  }
  if (account.resource?.identity !== `${routerShortName}@msging.net`) {
    throw new Error(`Router ${routerShortName}: a chave pertence a outro bot.`);
  }
  return null;
}

async function readRouterConfiguration(routerKey, routerShortName) {
  const configuration = await readRouterConfigurationIfPresent(routerKey, routerShortName);
  if (configuration) return configuration;
  throw new Error(
    `Router ${routerShortName}: a chave é válida, mas a Blip retornou código 67 para a configuração avançada nos hosts conhecidos (${CONFIGURATION_HOSTS.join(", ")}). Não é seguro listar ou clonar seus serviços por esta API. Confira o domínio Application nas configurações avançadas desse router.`,
  );
}

function summarize(config) {
  return {
    routerShortName: config.application.identifier,
    template: config.resource.Template || null,
    applicationHash: config.applicationHash,
    services: config.services.map((service) => ({
      identity: service.identity,
      shortName:
        typeof service.shortName === "string" ? service.shortName : service.identity.split("@")[0],
      name: typeof service.longName === "string" ? service.longName : service.identity,
      isDefault: service.isDefault === true,
      isOnline: service.isOnline === true,
    })),
  };
}

async function getRouterServices(params) {
  const routerShortName = assertShortName(params?.routerShortName, "Router");
  const configuration = await readRouterConfiguration(params?.routerKey, routerShortName);
  return summarize(configuration);
}

async function previewRouterClone(params) {
  const sourceShortName = assertShortName(params?.sourceShortName, "Router de origem");
  const targetShortName = assertShortName(params?.targetShortName, "Router de destino");
  if (sourceShortName === targetShortName)
    throw new RouterCloneInputError("Origem e destino precisam ser diferentes.");
  const [source, target] = await Promise.all([
    readRouterConfiguration(params.sourceRouterKey, sourceShortName),
    readRouterConfiguration(params.targetRouterKey, targetShortName),
  ]);
  return {
    source: summarize(source),
    target: summarize(target),
    compatible:
      source.host === target.host &&
      source.resource.Template === target.resource.Template &&
      source.application.settingsType === target.application.settingsType,
  };
}

async function prepareRouterClone(params) {
  const sourceShortName = assertShortName(params?.sourceShortName, "Router de origem");
  const targetShortName = assertShortName(params?.targetShortName, "Router de destino");
  if (sourceShortName === targetShortName)
    throw new RouterCloneInputError("Origem e destino precisam ser diferentes.");
  const sourceKey = assertKey(params.sourceRouterKey, "Key de origem");
  const targetKey = assertKey(params.targetRouterKey, "Key de destino");
  if (!/^[a-f0-9]{64}$/.test(params.sourceHash) || !/^[a-f0-9]{64}$/.test(params.targetHash)) {
    throw new RouterCloneInputError("Atualize a prévia antes de clonar.");
  }
  const selected = params.selectedServiceIdentities;
  if (
    !Array.isArray(selected) ||
    selected.some((item) => typeof item !== "string") ||
    new Set(selected).size !== selected.length
  ) {
    throw new RouterCloneInputError("Seleção de serviços inválida.");
  }
  const [source, target] = await Promise.all([
    readRouterConfiguration(sourceKey, sourceShortName),
    readRouterConfiguration(targetKey, targetShortName),
  ]);
  if (
    source.applicationHash !== params.sourceHash ||
    target.applicationHash !== params.targetHash
  ) {
    throw new Error("A configuração mudou desde a prévia. Atualize antes de clonar.");
  }
  if (
    source.host !== target.host ||
    source.resource.Template !== target.resource.Template ||
    source.application.settingsType !== target.application.settingsType
  ) {
    throw new Error("Origem e destino usam templates de router incompatíveis.");
  }
  const allIdentities = new Set(source.services.map((item) => item.identity));
  if (selected.some((identity) => !allIdentities.has(identity))) {
    throw new RouterCloneInputError("A seleção contém serviços ausentes na origem.");
  }
  const selectedSet = new Set(selected);
  const services = source.services.filter((service) => selectedSet.has(service.identity));
  const application = structuredClone(target.application);
  const existingIdentities = new Set(target.services.map((service) => service.identity));
  const additions = services
    .filter((service) => !existingIdentities.has(service.identity))
    .map((service) => ({
      ...structuredClone(service),
      isDefault: target.services.length === 0 && service.isDefault === true,
    }));
  application.settings.children = [...target.services, ...additions];
  const nextApplication = JSON.stringify(application);
  if (nextApplication === target.resource.Application) {
    return {
      status: "unchanged",
      services: application.settings.children.length,
      backup: null,
      host: target.host,
      application: nextApplication,
      expectedHash: hash(nextApplication),
      previousHash: target.applicationHash,
    };
  }

  const backupDirectory = path.join(process.cwd(), ".local", "router-clone-backups");
  await mkdir(backupDirectory, { recursive: true });
  const backupName = `${targetShortName}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.json`;
  await writeFile(
    path.join(backupDirectory, backupName),
    JSON.stringify({ targetShortName, host: target.host, resource: target.resource }, null, 2),
    { flag: "wx", mode: 0o600 },
  );

  return {
    status: "ready",
    services: application.settings.children.length,
    backup: backupName,
    host: target.host,
    application: nextApplication,
    expectedHash: hash(nextApplication),
    previousHash: target.applicationHash,
  };
}

async function verifyRouterClone(params) {
  const targetShortName = assertShortName(params?.targetShortName, "Router de destino");
  const targetKey = assertKey(params?.targetRouterKey, "Key de destino");
  if (!/^[a-f0-9]{64}$/.test(params?.expectedHash)) {
    throw new RouterCloneInputError("Hash esperado inválido.");
  }
  const actual = await readRouterConfiguration(targetKey, targetShortName);
  if (actual.applicationHash !== params.expectedHash) {
    throw new Error("A leitura após gravação não confirmou o conteúdo. Consulte o backup local.");
  }
  return { verified: true };
}

async function cloneRouter(params) {
  const prepared = await prepareRouterClone(params);
  if (prepared.status === "unchanged") {
    return { status: "unchanged", services: prepared.services, backup: null };
  }
  const response = await command(params.targetRouterKey, {
    to: "postmaster@msging.net",
    method: "set",
    uri: `lime://${prepared.host}@msging.net/configuration?caller=${params.targetShortName}@msging.net`,
    type: "application/json",
    resource: { Application: prepared.application },
  });
  if (response.status !== "success")
    throw new Error(`A Blip recusou a gravação: ${reasonOf(response)}`);
  await verifyRouterClone({
    targetRouterKey: params.targetRouterKey,
    targetShortName: params.targetShortName,
    expectedHash: prepared.expectedHash,
  });
  return { status: "success", services: prepared.services, backup: prepared.backup };
}

async function cloneNewRouter(params) {
  const sourceShortName = assertShortName(params?.sourceShortName, "Router de origem");
  const targetShortName = assertShortName(params?.targetShortName, "Router de destino");
  if (sourceShortName === targetShortName) {
    throw new RouterCloneInputError("Origem e destino precisam ser diferentes.");
  }
  const sourceKey = assertKey(params?.sourceRouterKey, "Key de origem");
  const targetKey = assertKey(params?.targetRouterKey, "Key de destino");
  const [source, target] = await Promise.all([
    readRouterConfiguration(sourceKey, sourceShortName),
    readRouterConfigurationIfPresent(targetKey, targetShortName),
  ]);

  if (target) {
    if (
      source.host !== target.host ||
      source.resource.Template !== target.resource.Template ||
      source.application.settingsType !== target.application.settingsType
    ) {
      throw new Error("Origem e novo destino usam templates de router incompatíveis.");
    }
    return cloneRouter({
      sourceShortName,
      targetShortName,
      sourceRouterKey: sourceKey,
      targetRouterKey: targetKey,
      sourceHash: source.applicationHash,
      targetHash: target.applicationHash,
      selectedServiceIdentities: source.services.map((service) => service.identity),
    });
  }

  const application = structuredClone(source.application);
  application.identifier = targetShortName;
  const nextApplication = JSON.stringify(application);
  const expectedHash = hash(nextApplication);
  const response = await command(targetKey, {
    to: "postmaster@msging.net",
    method: "set",
    uri: `lime://${source.host}@msging.net/configuration?caller=${targetShortName}@msging.net`,
    type: "application/json",
    resource: { Application: nextApplication },
  });
  if (response.status !== "success") {
    throw new Error(`A Blip recusou a primeira configuração do router: ${reasonOf(response)}`);
  }
  await verifyRouterClone({ targetRouterKey: targetKey, targetShortName, expectedHash });
  return { status: "success", services: source.services.length, backup: null };
}

module.exports = {
  RouterCloneInputError,
  readRouterConfiguration,
  getRouterServices,
  previewRouterClone,
  prepareRouterClone,
  verifyRouterClone,
  cloneRouter,
  cloneNewRouter,
};
