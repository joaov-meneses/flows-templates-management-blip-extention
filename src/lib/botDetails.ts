export type PortalRead = (uri: string) => Promise<unknown>;
export type BotAccess = {
  identity: string;
  permissions: Array<{ area: string; actions: string[]; updated?: string }>;
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function resource(response: unknown) {
  if (!record(response)) throw new Error("O Portal retornou uma resposta inválida.");
  if (response.status === "failure") {
    const reason = record(response.reason) ? response.reason : {};
    throw new Error(
      reason.code === 66
        ? "Seu usuário não tem permissão para consultar essas informações."
        : String(reason.description || "Não foi possível consultar o Portal."),
    );
  }
  return record(response.resource) ? response.resource : response;
}

export async function loadBotMetadata(shortName: string, read: PortalRead) {
  if (!/^[a-z0-9_-]+$/i.test(shortName)) throw new Error("ID do bot inválido.");
  const value = resource(await read(`/applications/${shortName}@msging.net`));
  if (value.shortName !== shortName) throw new Error("O Portal retornou dados de outro bot.");
  return value;
}

/** Permissions describe app access; they do not identify the contract's administrators. */
export async function loadBotAccess(shortName: string, read: PortalRead): Promise<BotAccess[]> {
  if (!/^[a-z0-9_-]+$/i.test(shortName)) throw new Error("ID do bot inválido.");
  const people = new Map<string, BotAccess>();
  const seenPages = new Set<string>();
  const take = 100;
  let skip = 0;
  while (true) {
    const page = resource(
      await read(`/applications/${shortName}@msging.net/permissions?$skip=${skip}&$take=${take}`),
    );
    if (!Array.isArray(page.items) || !Number.isInteger(page.total) || Number(page.total) < 0) {
      throw new Error("O Portal não confirmou a lista completa de permissões.");
    }
    const fingerprint = JSON.stringify(page.items);
    if (seenPages.has(fingerprint) || (!page.items.length && skip < Number(page.total))) {
      throw new Error("A lista de permissões está incompleta. Consulte a equipe pelo Portal.");
    }
    seenPages.add(fingerprint);
    for (const item of page.items) {
      if (
        !record(item) ||
        typeof item.userIdentity !== "string" ||
        typeof item.permissionId !== "string" ||
        !Array.isArray(item.actions) ||
        !item.actions.every((action) => typeof action === "string")
      ) {
        throw new Error("O Portal retornou permissões em um formato não reconhecido.");
      }
      const person = people.get(item.userIdentity) ?? {
        identity: item.userIdentity,
        permissions: [],
      };
      person.permissions.push({
        area: item.permissionId,
        actions: item.actions,
        updated: typeof item.updateDate === "string" ? item.updateDate : undefined,
      });
      people.set(item.userIdentity, person);
    }
    skip += page.items.length;
    if (skip >= Number(page.total)) break;
  }
  return [...people.values()].sort((a, b) => a.identity.localeCompare(b.identity));
}
