const { randomUUID } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const HUB = "postmaster@msging.net";
const BUILDER = "postmaster@builder.msging.net";
const AI = "postmaster@aiplatform.msging.net";
const PREFIX = "/buckets/blip_portal:builder_";

class BuilderExportInputError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

async function readCommand(key, bot, to, uri) {
  const id = randomUUID();
  const response = await fetch("https://msging.net/commands", {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({ id, method: "get", to, uri }),
    signal: AbortSignal.timeout(60000),
    redirect: "error",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.status !== "success") {
    const error = new Error(
      data?.reason?.description || `Falha ao ler o Builder (HTTP ${response.status}).`,
    );
    error.blipCode = data?.reason?.code;
    throw error;
  }
  if (data.id !== id || (data.to && data.to.split("/")[0] !== `${bot}@msging.net`))
    throw new Error("A Blip não confirmou a identidade da resposta solicitada.");
  return data.resource;
}

function object(value, name) {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error(`O Builder retornou um JSON inválido em ${name}.`);
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`O Builder não retornou o documento ${name}.`);
  return value;
}

function latestPublication(index) {
  if (!Array.isArray(index.publications) || !index.publications.length)
    throw new Error("Este Builder não tem uma publicação disponível no histórico.");
  const entries = index.publications.map((entry) => {
    if (
      !entry ||
      !Number.isInteger(entry.index) ||
      entry.index < 0 ||
      typeof entry.publishedAt !== "string" ||
      !Number.isFinite(Date.parse(entry.publishedAt))
    )
      throw new Error("O histórico de publicações está incompleto ou inválido.");
    return entry;
  });
  const newest = Math.max(...entries.map((entry) => Date.parse(entry.publishedAt)));
  const candidates = entries.filter((entry) => Date.parse(entry.publishedAt) === newest);
  const latest = candidates.find((entry) => entry.index === index.lastInsertedIndex);
  if (!latest || candidates.some((entry) => entry.index !== latest.index))
    throw new Error(
      "O histórico mudou ou não identifica uma única publicação mais recente. Atualize e tente novamente.",
    );
  return {
    index: latest.index,
    publishedAt: latest.publishedAt,
    ...(typeof latest.title === "string" ? { title: latest.title } : {}),
  };
}

// Source detection is read-only. Portal migration helpers can write documents.
async function draftSource(read) {
  try {
    return { source: "application", flow: object(await read(BUILDER, "/flow"), "flow") };
  } catch (error) {
    const unsupported =
      error.blipCode === 67 ||
      (error.blipCode === 61 && /Invalid object name ['"]builder\.Flows['"]/i.test(error.message));
    if (!unsupported) throw error;
    return {
      source: "bucket",
      flow: object(await read(HUB, PREFIX + "working_flow"), "working_flow"),
    };
  }
}

async function enrichAgentExports(flow, read) {
  for (const block of Object.values(flow)) {
    if (!block?.id?.startsWith("ai-agent:")) continue;
    const base = `/knowledge-base/agent/${encodeURIComponent(block.id)}`;
    const catalogs = object(await read(AI, `${base}/environment/DEV/catalog`), "catálogos da IA");
    if (
      !Array.isArray(catalogs.items) ||
      (catalogs.total != null && catalogs.total !== catalogs.items.length)
    )
      throw new Error("A lista de catálogos da IA está incompleta. Baixe esse fluxo pelo Builder.");
    block.$groundingConfig = [];
    for (const catalog of catalogs.items.filter((item) => item.status === "active")) {
      if (typeof catalog.id !== "string" || !catalog.id)
        throw new Error("Um catálogo da IA não foi identificado.");
      const documents = object(
        await read(
          AI,
          `${base}/environment/DEV/catalog/${encodeURIComponent(catalog.id)}/document`,
        ),
        "documentos da IA",
      );
      if (
        !Array.isArray(documents.items) ||
        (documents.total != null && documents.total !== documents.items.length)
      )
        throw new Error(
          "A lista de documentos da IA está incompleta. Baixe esse fluxo pelo Builder.",
        );
      block.$groundingConfig.push({
        id: catalog.id,
        status: catalog.status,
        excluded_documents: documents.items
          .filter((item) => item.status === "inactive")
          .map(({ id, catalog_id }) => ({ id, catalog_id })),
      });
    }
    for (const tool of block.$localCustomActions ?? []) {
      if (
        tool.type !== "KnowledgeBaseConsult" ||
        (tool.settings && Object.keys(tool.settings).length)
      )
        continue;
      if (typeof tool.$id !== "string" || !tool.$id)
        throw new Error("Uma ferramenta da IA não foi identificada.");
      const uri = `${base}/tool/${encodeURIComponent(tool.$id)}/environment/DEV`;
      const setup = object(await read(AI, `${uri}/setup`), "configuração da IA");
      const filter = object(await read(AI, `${uri}/filter`), "filtro da IA");
      tool.settings = { ...setup, top_k: filter.top_k };
    }
  }
}

async function exportWorking(read, helpers) {
  const initial = await draftSource(read);
  const globalsUri =
    initial.source === "application" ? "/flow/global-actions" : PREFIX + "working_global_actions";
  const globalsTo = initial.source === "application" ? BUILDER : HUB;
  const globalActions = object(await read(globalsTo, globalsUri), "ações globais");
  const flow = structuredClone(initial.flow);
  await enrichAgentExports(flow, read);
  const subflows = [];
  for (const shortName of helpers.subflowNames(flow)) {
    const base = `/subflows/${encodeURIComponent(shortName)}/configurations/`;
    const edited = object(await read(BUILDER, base + "edited-flow"), `subfluxo ${shortName}`);
    const config = object(
      await read(BUILDER, base + "edited-configurations"),
      `configuração ${shortName}`,
    );
    subflows.push({
      shortName,
      flow: object(edited.document, `conteúdo de ${shortName}`),
      configuration: object(config.document, `configuração de ${shortName}`),
    });
  }
  const current = await draftSource(read);
  const currentGlobal = object(await read(globalsTo, globalsUri), "ações globais");
  if (
    current.source !== initial.source ||
    !isDeepStrictEqual(current.flow, initial.flow) ||
    !isDeepStrictEqual(currentGlobal, globalActions)
  )
    throw new Error("O rascunho mudou durante o download. Aguarde o salvamento e tente novamente.");
  for (const subflow of subflows) {
    const base = `/subflows/${encodeURIComponent(subflow.shortName)}/configurations/`;
    const edited = object(await read(BUILDER, base + "edited-flow"), "subfluxo");
    const config = object(
      await read(BUILDER, base + "edited-configurations"),
      "configuração de subfluxo",
    );
    if (
      !isDeepStrictEqual(object(edited.document, "subfluxo"), subflow.flow) ||
      !isDeepStrictEqual(object(config.document, "configuração de subfluxo"), subflow.configuration)
    )
      throw new Error(
        "Um subfluxo mudou durante o download. Aguarde o salvamento e tente novamente.",
      );
  }
  return { flow, globalActions, ...(subflows.length ? { subflows } : {}) };
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
  const helpers = await import("../shared/builderExport.mjs");
  const read = (to, uri) => readCommand(builderKey, builderShortName, to, uri);
  let document;
  let publication;
  if (version === "published") {
    const before = latestPublication(
      object(await read(HUB, PREFIX + "latestpublications"), "histórico"),
    );
    document = object(
      await read(HUB, `${PREFIX}latestpublications:${before.index}`),
      "publicação completa",
    );
    const after = latestPublication(
      object(await read(HUB, PREFIX + "latestpublications"), "histórico"),
    );
    if (!isDeepStrictEqual(before, after))
      throw new Error("Uma nova versão foi publicada durante o download. Tente novamente.");
    publication = before;
  } else {
    document = await exportWorking(read, helpers);
  }
  helpers.validateBuilderExportDocument(document);
  return { builderShortName, version, ...(publication ? { publication } : {}), document };
}

module.exports = { exportBuilderFlow, BuilderExportInputError };
