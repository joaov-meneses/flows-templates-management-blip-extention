const { randomUUID } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { compileBuilderFlow } = require("./builderCompiler.cjs");

const PREFIX = "/buckets/blip_portal:builder_";
const CONFIGURATIONS = "postmaster@configurations.msging.net";
class BuilderPublicationInputError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function command(key, request, optional = false) {
  const response = await fetch("https://msging.net/commands", {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({ id: randomUUID(), ...request }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json().catch(() => null);
  if (response.ok && optional && data?.status === "failure" && data.reason?.code === 67)
    return undefined;
  if (!response.ok || data?.status !== "success")
    throw new Error(
      data?.reason?.description || `A Blip não confirmou o comando (HTTP ${response.status}).`,
    );
  return data.resource;
}
function json(value, fallback) {
  if (value === undefined) {
    if (fallback === undefined)
      throw new Error("O Builder não retornou o documento necessário para publicar.");
    return fallback;
  }
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error("O Builder retornou um JSON inválido.");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("O Builder retornou um documento inválido.");
  return value;
}
async function readBucket(key, name, optional = false) {
  return json(await command(key, { method: "get", uri: PREFIX + name }, optional), {});
}
async function writeBucket(key, name, resource) {
  await command(key, { method: "set", uri: PREFIX + name, type: "application/json", resource });
  if (!isDeepStrictEqual(await readBucket(key, name), resource))
    throw new Error("A leitura após publicar não confirmou os documentos do Builder.");
}

async function publishBuilderDraft({ builderKey, builderShortName } = {}) {
  if (
    typeof builderShortName !== "string" ||
    !/^[a-z0-9][a-z0-9_-]*$/i.test(builderShortName) ||
    typeof builderKey !== "string" ||
    !/^Key [A-Za-z0-9+/=]+$/.test(builderKey) ||
    Buffer.from(builderKey.slice(4), "base64").toString("utf8").split(":")[0] !== builderShortName
  )
    throw new BuilderPublicationInputError("Selecione um Builder com ID e key correspondentes.");

  const admin = await command(
    builderKey,
    { to: CONFIGURATIONS, method: "get", uri: "lime://admin@msging.net/configuration" },
    true,
  );
  const cluster = admin?.Cluster;
  if (cluster && (typeof cluster !== "string" || !/^[a-z0-9-]+$/i.test(cluster)))
    throw new Error("O Builder retornou um cluster inválido.");
  const host = `${cluster ? `${cluster.toLowerCase()}.` : ""}builder.hosting@msging.net`;
  const uri = `lime://${host}/configuration`;
  const getRuntime = () => command(builderKey, { to: CONFIGURATIONS, method: "get", uri }, true);
  const originalRuntime = await getRuntime();
  if (originalRuntime && originalRuntime.Template !== "builder")
    throw new BuilderPublicationInputError("A publicação em massa aceita somente Builders.");
  const runtime = originalRuntime
    ? json(originalRuntime.Application)
    : json(await command(builderKey, { to: host, method: "get", uri: "/templates/builder" }));
  if (originalRuntime && runtime.identifier !== builderShortName)
    throw new Error("O runtime retornado não pertence ao Builder selecionado.");
  if (!runtime.settings || typeof runtime.settings !== "object")
    throw new Error("O Builder não retornou uma configuração de execução válida.");
  const flow = await readBucket(builderKey, "working_flow");
  const configuration = await readBucket(builderKey, "working_configuration", true);
  const globalActions = await readBucket(builderKey, "working_global_actions", true);
  const latest = await readBucket(builderKey, "latestpublications", true);
  const flowIdRaw = await command(
    builderKey,
    { method: "get", uri: PREFIX + "working_flow_id" },
    true,
  );
  const flowId = flowIdRaw ?? runtime.settings.flow?.id ?? randomUUID();
  if (typeof flowId !== "string" || !flowId.trim())
    throw new Error("O ID do fluxo em rascunho é inválido.");
  // External AI catalogs/settings need additional Portal publication steps. An
  // unchanged AI block can retain its compiled representation; pending AI edits
  // must not be silently represented by stale external settings.
  const aiBlocks = Object.values(flow).filter(
    (block) =>
      block?.$groundingConfig ||
      [...(block?.$enteringCustomActions || []), ...(block?.$leavingCustomActions || [])].some(
        (action) => ["ForwardToAgent", "ProcessContentAssistant"].includes(action.type),
      ),
  );
  const compiled = compileBuilderFlow({
    flow,
    configuration,
    globalActions,
    flowId,
    previousFlow: runtime.settings.flow,
  });
  if (aiBlocks.length) {
    const publishedFlow = await readBucket(builderKey, "published_flow");
    for (const block of aiBlocks) {
      const previous = Object.values(publishedFlow).find((entry) => entry?.id === block.id);
      const previousState = runtime.settings.flow?.states?.find((state) => state.id === block.id);
      if (!isDeepStrictEqual(block, previous) || !previousState)
        throw new Error(
          `O bloco de IA ${block.$title || block.id} tem mudanças que exigem publicação pelo Builder.`,
        );
      compiled.states[compiled.states.findIndex((state) => state.id === block.id)] =
        structuredClone(previousState);
    }
  }
  runtime.identifier = builderShortName;
  runtime.settings.flow = compiled;
  const snapshots = [
    isDeepStrictEqual(await readBucket(builderKey, "working_flow"), flow),
    isDeepStrictEqual(await readBucket(builderKey, "working_configuration", true), configuration),
    isDeepStrictEqual(await readBucket(builderKey, "working_global_actions", true), globalActions),
    isDeepStrictEqual(await readBucket(builderKey, "latestpublications", true), latest),
    isDeepStrictEqual(
      await command(builderKey, { method: "get", uri: PREFIX + "working_flow_id" }, true),
      flowIdRaw,
    ),
    isDeepStrictEqual(await getRuntime(), originalRuntime),
  ];
  if (snapshots.includes(false))
    throw new BuilderPublicationInputError(
      "O Builder mudou durante a preparação. Revise o rascunho antes de publicar novamente.",
      409,
    );

  let published = false;
  try {
    const application = JSON.stringify(runtime);
    await command(builderKey, {
      to: CONFIGURATIONS,
      method: "set",
      uri: `${uri}?caller=${encodeURIComponent(`${builderShortName}@msging.net`)}`,
      type: "application/json",
      resource: { Template: "builder", Application: application },
    });
    const verified = await getRuntime();
    if (verified?.Application !== application)
      throw new Error(
        "A leitura não confirmou o fluxo ativo. O comando pode ter sido aplicado; confira o Builder antes de repetir.",
      );
    published = true;
    for (const [name, document] of Object.entries({
      flow,
      configuration,
      global_actions: globalActions,
    }))
      await writeBucket(builderKey, `published_${name}`, document);
    if (flowIdRaw === undefined) {
      await command(builderKey, {
        method: "set",
        uri: PREFIX + "working_flow_id",
        type: "text/plain",
        resource: flowId,
      });
      if (
        (await command(builderKey, { method: "get", uri: PREFIX + "working_flow_id" })) !== flowId
      )
        throw new Error("A leitura não confirmou o ID do fluxo publicado.");
    }
    const deskStates = compiled.states.filter((state) => state.id.startsWith("desk:"));
    await command(builderKey, {
      to: CONFIGURATIONS,
      method: "set",
      uri: "lime://postmaster@desk.msging.net/configuration",
      type: "application/json",
      resource: {
        AutomaticClosedTicketIsAllowed: deskStates.every(
          (state) => Number(state.deskStateVersion || 0) >= 2,
        ),
        IgnoreCreateTicketOnUserMessage: deskStates.every(
          (state) => Number(state.deskStateVersion || 0) >= 1,
        ),
        AttendanceSatisfactionSurveyEnabled:
          deskStates.some((state) => Number(state.deskStateVersion || 0) >= 3) &&
          compiled.states.some((state) => state.id.startsWith("survey:")),
      },
    });
    const index = (Number.isInteger(latest.lastInsertedIndex) ? latest.lastInsertedIndex : 0) + 1;
    const previous = Array.isArray(latest.publications) ? latest.publications : [];
    await writeBucket(builderKey, `latestpublications:${index}`, {
      flow,
      configuration,
      globalActions,
    });
    await writeBucket(builderKey, "latestpublications", {
      ...latest,
      lastInsertedIndex: index,
      isMoreOptionsActive: latest.isMoreOptionsActive === true || previous.length >= 5,
      publications: [
        {
          index,
          publishedAt: new Date().toISOString(),
          author: "Templates/Flows Manager",
          authorIdentity: `${builderShortName}@msging.net`,
        },
        ...previous,
      ].slice(0, 5),
    });
    return { builderShortName, published, states: compiled.states.length, publicationIndex: index };
  } catch (error) {
    return {
      builderShortName,
      published,
      error: published
        ? `Fluxo ativo confirmado, mas houve falha ao concluir o registro da publicação: ${error.message}`
        : `Publicação não confirmada: ${error.message}`,
    };
  }
}

module.exports = { publishBuilderDraft, BuilderPublicationInputError };
