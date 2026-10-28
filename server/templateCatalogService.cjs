const { randomUUID } = require("node:crypto");
const { InputError } = require("./templateService.cjs");
const { sendTemplateCommand } = require("./templateCreationService.cjs");

async function templateCatalog({ sourceRouterKey } = {}) {
  if (typeof sourceRouterKey !== "string" || !sourceRouterKey.trim())
    throw new InputError("Selecione o router de origem.");
  const found = new Map();
  const cursors = new Set();
  let after = "";
  for (let page = 0; page < 100; page++) {
    const response = await sendTemplateCommand(sourceRouterKey, {
      id: randomUUID(),
      method: "get",
      to: "postmaster@wa.gw.msging.net",
      uri: `/message-templates${after ? `?after=${encodeURIComponent(after)}` : ""}`,
    });
    const resource = response.resource;
    if (!Array.isArray(resource?.data))
      throw new Error("A Blip retornou um catálogo incompleto. Tente atualizar.");
    for (const template of resource.data) {
      if (!template?.name || !template.language || !Array.isArray(template.components))
        throw new Error("A Blip retornou um template incompleto. Tente atualizar.");
      found.set(`${template.name}|${template.language}`, template);
    }
    // Cursors also exist on the final page. Only an explicit next page continues traversal.
    if (!resource.paging?.next)
      return { total: found.size, templates: [...found.values()], complete: true };
    let cursor = resource.paging.cursors?.after;
    if (!cursor) {
      try {
        cursor = new URL(resource.paging.next).searchParams.get("after");
      } catch {
        /* Invalid pagination is rejected below. */
      }
    }
    if (typeof cursor !== "string" || !cursor || cursor.length > 10000 || cursors.has(cursor))
      throw new Error("A paginação dos templates não pôde ser concluída. Tente atualizar.");
    cursors.add(cursor);
    after = cursor;
  }
  throw new Error("O catálogo ultrapassou o limite de páginas. A lista de nomes está incompleta.");
}
module.exports = { templateCatalog };
