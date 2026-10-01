const { randomUUID } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { confirmBuilderRuntime } = require("./builderRuntimeVerification.cjs");

const PREFIX = "/buckets/blip_portal:builder_";
const RUNTIME_URI = "lime://builder.hosting@msging.net/configuration";

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
      data?.reason?.description || `A Blip não confirmou a publicação (HTTP ${response.status}).`,
    );
  return data.resource;
}

function json(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === "string") value = JSON.parse(value);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("A Blip retornou um documento de publicação inválido.");
  return value;
}

async function bucket(key, name, optional = false) {
  return json(await command(key, { method: "get", uri: PREFIX + name }, optional), {});
}

async function setBucket(key, name, resource) {
  await command(key, { method: "set", uri: PREFIX + name, type: "application/json", resource });
  if (!isDeepStrictEqual(await bucket(key, name), resource))
    throw new Error("A leitura após publicar não confirmou os documentos do Builder.");
}

function withoutExpirations(flow, entries) {
  const copy = structuredClone(flow);
  for (const { blockKey } of entries) {
    const input = copy[blockKey]?.$contentActions?.find((action) => action?.input)?.input;
    if (input) delete input.expiration;
  }
  return copy;
}

// Inactivity has no effect on compiled actions/outputs. Reuse their published
// representation only when the draft differs exclusively in eligible expirations.
// Never claim to compile arbitrary pending Builder changes by replaying old runtime.
async function publishInactivity(key, flow, entries) {
  let published = false;
  try {
    const runtimeResource = await command(key, {
      to: "postmaster@configurations.msging.net",
      method: "get",
      uri: RUNTIME_URI,
    });
    if (runtimeResource?.Template !== "builder" || typeof runtimeResource?.Application !== "string")
      throw new Error(
        "Publique este fluxo pelo Builder antes de usar a publicação automática de inatividade.",
      );
    const runtime = json(runtimeResource.Application);
    const states = runtime.settings?.flow?.states;
    if (!Array.isArray(states) || !runtime.identifier || !runtime.settings.flow.id)
      throw new Error("O fluxo publicado não contém uma configuração válida do Builder.");
    const documents = {
      flow: await bucket(key, "published_flow"),
      configuration: await bucket(key, "published_configuration", true),
      globalActions: await bucket(key, "published_global_actions", true),
    };
    const configuration = await bucket(key, "working_configuration", true);
    const globalActions = await bucket(key, "working_global_actions", true);
    const latest = await bucket(key, "latestpublications", true);
    if (
      !isDeepStrictEqual(
        withoutExpirations(flow, entries),
        withoutExpirations(documents.flow, entries),
      ) ||
      !isDeepStrictEqual(configuration, documents.configuration) ||
      !isDeepStrictEqual(globalActions, documents.globalActions)
    )
      throw new Error(
        "Há outras alterações pendentes no fluxo, na configuração ou nas ações globais. Publique-as no Builder antes de usar a publicação automática de inatividade.",
      );

    const stateIds = new Set();
    for (const state of states) {
      if (!state?.id || stateIds.has(state.id))
        throw new Error("O fluxo publicado contém blocos inválidos ou duplicados.");
      stateIds.add(state.id);
    }
    const inputIds = new Set();
    for (const { block, input } of entries) {
      if (inputIds.has(block.id))
        throw new Error(
          "O rascunho contém entradas com IDs duplicados. Corrija o fluxo no Builder antes de publicar.",
        );
      inputIds.add(block.id);
      const state = states.find((state) => state.id === block.id);
      if (!state?.input || state.input.bypass)
        throw new Error(
          `O bloco ${block.$title || block.id} não corresponde a uma entrada do fluxo publicado. Publique o fluxo no Builder primeiro.`,
        );
      if (Object.hasOwn(input, "expiration")) state.input.expiration = input.expiration;
      else delete state.input.expiration;
    }
    // Catch edits made while the publication snapshot was being loaded.
    const unchanged = [
      isDeepStrictEqual(await bucket(key, "working_flow"), flow),
      isDeepStrictEqual(await bucket(key, "working_configuration", true), configuration),
      isDeepStrictEqual(await bucket(key, "working_global_actions", true), globalActions),
      isDeepStrictEqual(await bucket(key, "published_flow"), documents.flow),
      isDeepStrictEqual(
        await bucket(key, "published_configuration", true),
        documents.configuration,
      ),
      isDeepStrictEqual(
        await bucket(key, "published_global_actions", true),
        documents.globalActions,
      ),
      isDeepStrictEqual(await bucket(key, "latestpublications", true), latest),
      isDeepStrictEqual(
        await command(key, {
          to: "postmaster@configurations.msging.net",
          method: "get",
          uri: RUNTIME_URI,
        }),
        runtimeResource,
      ),
    ];
    if (unchanged.includes(false))
      throw new Error(
        "O Builder mudou durante a preparação da publicação. Atualize a análise antes de repetir.",
      );
    const application = JSON.stringify(runtime);
    await command(key, {
      to: "postmaster@msging.net",
      method: "set",
      uri: `${RUNTIME_URI}?caller=${encodeURIComponent(`${runtime.identifier}@msging.net`)}`,
      type: "application/json",
      resource: { Template: "builder", Application: application },
    });
    await confirmBuilderRuntime(
      () =>
        command(key, {
          to: "postmaster@configurations.msging.net",
          method: "get",
          uri: RUNTIME_URI,
        }),
      runtime,
    );
    published = true;
    await setBucket(key, "published_flow", flow);
    const index = (Number.isInteger(latest.lastInsertedIndex) ? latest.lastInsertedIndex : 0) + 1;
    const previous = Array.isArray(latest.publications) ? latest.publications : [];
    await setBucket(key, `latestpublications:${index}`, { ...documents, flow });
    await setBucket(key, "latestpublications", {
      ...latest,
      lastInsertedIndex: index,
      isMoreOptionsActive: latest.isMoreOptionsActive === true || previous.length >= 5,
      publications: [
        {
          authorIdentity: `${runtime.identifier}@msging.net`,
          author: "Templates/Flows Manager",
          publishedAt: new Date().toISOString(),
          index,
        },
        ...previous,
      ].slice(0, 5),
    });
    return { published, publicationIndex: index };
  } catch (error) {
    return {
      published,
      publicationError: published
        ? `Fluxo ativo confirmado, mas houve falha ao registrar a publicação: ${error.message}`
        : `Rascunho salvo; publicação não confirmada: ${error.message}`,
    };
  }
}

module.exports = { publishInactivity };
