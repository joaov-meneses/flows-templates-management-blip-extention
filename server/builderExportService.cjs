const { randomUUID } = require("node:crypto");

class BuilderExportInputError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

async function readDocument(key, name, optional = false) {
  const response = await fetch("https://msging.net/commands", {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({
      id: randomUUID(),
      method: "get",
      uri: `/buckets/blip_portal:builder_${name}`,
    }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json().catch(() => null);
  if (response.ok && optional && data?.status === "failure" && data.reason?.code === 67) return {};
  if (!response.ok || data?.status !== "success")
    throw new Error(data?.reason?.description || `Falha ao ler o fluxo (HTTP ${response.status}).`);
  let document = data.resource;
  if (typeof document === "string") {
    try {
      document = JSON.parse(document);
    } catch {
      throw new Error(`O Builder retornou um JSON inválido em ${name}.`);
    }
  }
  if (!document || typeof document !== "object" || Array.isArray(document))
    throw new Error(`O Builder retornou um documento inválido em ${name}.`);
  return document;
}

async function exportBuilderFlow({ builderShortName, builderKey, version = "working" } = {}) {
  if (
    typeof builderShortName !== "string" ||
    !/^[a-z0-9][a-z0-9_-]*$/i.test(builderShortName) ||
    typeof builderKey !== "string" ||
    !/^Key [A-Za-z0-9+/=]+$/.test(builderKey) ||
    Buffer.from(builderKey.slice(4), "base64").toString("utf8").split(":")[0] !== builderShortName
  )
    throw new BuilderExportInputError("Selecione um Builder com ID e key correspondentes.");
  if (!["working", "published"].includes(version))
    throw new BuilderExportInputError("Escolha o rascunho ou a versão publicada.");
  // Keep the Builder import document separate from transport metadata. No keys
  // or runtime commands belong in a downloadable flow.
  const flow = await readDocument(builderKey, `${version}_flow`);
  const configuration = await readDocument(builderKey, `${version}_configuration`, true);
  const globalActions = await readDocument(builderKey, `${version}_global_actions`, true);
  return { builderShortName, version, document: { flow, configuration, globalActions } };
}

module.exports = { exportBuilderFlow, BuilderExportInputError };
