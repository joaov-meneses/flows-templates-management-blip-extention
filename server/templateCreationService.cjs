const { randomUUID, createHash } = require("node:crypto");
const { InputError } = require("./templateService.cjs");
const requests = new Map();
const pendingNames = new Set();
const TTL = 15 * 60 * 1000;

async function command(routerKey, envelope) {
  let response;
  try {
    response = await fetch("https://msging.net/commands", {
      method: "POST",
      headers: { Authorization: routerKey, "Content-Type": "application/json" },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    throw new Error(
      envelope.method === "set"
        ? "A criação ficou sem confirmação. Consulte a lista de templates antes de tentar novamente."
        : "Não foi possível consultar os templates do router. Nenhuma criação foi enviada.",
    );
  }
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Resposta inválida da Blip. Consulte a lista de templates antes de repetir.");
  }
  if (!response.ok || data?.status !== "success" || data?.id !== envelope.id) {
    throw new Error(
      `A Blip não confirmou a operação (HTTP ${response.status}). ${data?.reason?.description || "Consulte a lista antes de repetir."}`,
    );
  }
  return data;
}

async function createTemplate(params = {}) {
  const { compileTemplateDraft } = await import("../shared/templateCreation.mjs");
  const { errors, template } = compileTemplateDraft(params.draft);
  if (errors.length) throw new InputError(errors.map((error) => error.message).join(" "));
  if (typeof params.sourceRouterKey !== "string" || !params.sourceRouterKey.trim())
    throw new InputError("Selecione o router onde o template será criado.");
  if (typeof params.requestId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(params.requestId))
    throw new InputError("Identificador de criação inválido.");
  const routerHash = createHash("sha256").update(params.sourceRouterKey).digest("hex");
  const cacheKey = `${routerHash}:${params.requestId}`;
  const fingerprint = JSON.stringify(template);
  for (const [key, entry] of requests) {
    if (entry.expires < Date.now()) requests.delete(key);
  }
  const previous = requests.get(cacheKey);
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      throw new InputError("Este identificador já foi usado com outro conteúdo.");
    return previous.promise;
  }
  const nameKey = `${routerHash}:${template.name}:${template.language}`;
  if (pendingNames.has(nameKey))
    throw new InputError(
      "Já existe uma criação em andamento para este nome e idioma. Aguarde e consulte a lista.",
    );
  if (requests.size >= 1000)
    throw new InputError("Há muitas criações recentes em processamento. Aguarde alguns minutos.");
  pendingNames.add(nameKey);
  const promise = (async () => {
    try {
      const existing = await command(params.sourceRouterKey, {
        id: randomUUID(),
        method: "get",
        to: "postmaster@wa.gw.msging.net",
        uri: `/message-templates?templateName=${encodeURIComponent(template.name)}`,
      });
      if (!Array.isArray(existing?.resource?.data))
        throw new Error("Não foi possível validar nomes existentes. Nenhuma criação foi enviada.");
      if (
        existing.resource.data.some(
          (item) => item.name === template.name && item.language === template.language,
        )
      )
        throw new InputError("Já existe um template com este nome e idioma neste router.");
      const response = await command(params.sourceRouterKey, {
        id: params.requestId,
        method: "set",
        type: "application/json",
        to: "postmaster@wa.gw.msging.net",
        uri: "/message-templates",
        resource: template,
      });
      return {
        template: {
          name: template.name,
          language: template.language,
          category: response.resource?.category || template.category,
          status: response.resource?.status || null,
          id: response.resource?.id || null,
        },
        response,
      };
    } finally {
      pendingNames.delete(nameKey);
    }
  })();
  // A repeated submission reuses the same result, including uncertain failures.
  requests.set(cacheKey, { fingerprint, promise, expires: Date.now() + TTL });
  return promise;
}
module.exports = { createTemplate };
