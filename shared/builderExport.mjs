export function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function subflowNames(flow) {
  const names = new Set();
  for (const [id, block] of Object.entries(flow)) {
    if (!isRecord(block)) throw new Error(`O bloco ${id} do Builder é inválido.`);
    const name = block.shortNameOfSubflow;
    if (name == null && !id.startsWith("subflow:")) continue;
    if (typeof name !== "string" || !/^[a-z0-9][a-z0-9_-]*$/i.test(name))
      throw new Error(`O bloco ${id} está sem uma referência válida de subfluxo.`);
    names.add(name);
  }
  return [...names];
}

export function validateBuilderExportDocument(document) {
  if (!isRecord(document) || !isRecord(document.flow) || !Object.keys(document.flow).length)
    throw new Error("O Builder não retornou um fluxo completo para download.");
  if (!isRecord(document.globalActions))
    throw new Error("As ações globais não foram obtidas. O download foi interrompido.");
  if (document.configuration !== undefined && !isRecord(document.configuration))
    throw new Error("A configuração do pacote publicado é inválida.");
  const references = subflowNames(document.flow);
  if (document.subflows === undefined && !references.length) return;
  if (!Array.isArray(document.subflows))
    throw new Error("O pacote está sem as implementações dos subfluxos.");
  const names = new Set();
  for (const item of document.subflows) {
    if (!isRecord(item) || typeof item.shortName !== "string" || !item.shortName)
      throw new Error("O pacote contém um subfluxo sem identificação.");
    if (names.has(item.shortName))
      throw new Error(`O subfluxo ${item.shortName} está duplicado no pacote.`);
    names.add(item.shortName);
    if (!isRecord(item.flow) || !Object.keys(item.flow).length || !isRecord(item.configuration))
      throw new Error(`O conteúdo ou a configuração do subfluxo ${item.shortName} não foi obtido.`);
    for (const id of ["onboarding", "fallback", "end"]) {
      if (!isRecord(item.flow[id]) || item.flow[id].id !== id)
        throw new Error(`O subfluxo ${item.shortName} está sem o bloco nativo ${id}.`);
    }
    if (subflowNames(item.flow).length)
      throw new Error(
        `O subfluxo ${item.shortName} contém internos aninhados. Baixe esse caso pelo Builder.`,
      );
  }
  for (const name of references) {
    if (!names.has(name)) throw new Error(`O pacote está sem a implementação do subfluxo ${name}.`);
  }
}

export function builderExportFilename(exported) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(exported.builderShortName))
    throw new Error("O Builder retornou um ID inválido para download.");
  if (exported.version === "working") return `${exported.builderShortName}.json`;
  if (exported.version !== "published") throw new Error("A versão do download é inválida.");
  const publication = exported.publication;
  if (
    !isRecord(publication) ||
    !Number.isInteger(publication.index) ||
    typeof publication.publishedAt !== "string" ||
    !Number.isFinite(Date.parse(publication.publishedAt))
  )
    throw new Error("A publicação não foi identificada no histórico do Builder.");
  const title =
    typeof publication.title === "string" && publication.title.trim()
      ? publication.title
      : exported.builderShortName;
  const base = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "");
  const timestamp = new Date(publication.publishedAt).toISOString().replace(/:/g, "_");
  return `${base || exported.builderShortName}_${timestamp}.json`;
}
