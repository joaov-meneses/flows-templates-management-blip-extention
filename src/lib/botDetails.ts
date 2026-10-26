export type PortalRead = (uri: string) => Promise<unknown>;
export type BotAccess = {
  identity: string;
  roleId?: string;
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
      if (typeof item.roleId === "string") person.roleId = item.roleId;
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

export type BotAccessRole = "Admin" | "Leitura" | "Editor" | "Personalizado";

export function decodePortalIdentity(identity: string): string {
  let value = identity.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    /* Keep malformed identities readable. */
  }
  // Portal user identities encode the email before the Blip domain.
  if (value.toLowerCase().endsWith("@blip.ai") && value.split("@").length > 2) {
    value = value.slice(0, -"@blip.ai".length);
  }
  return value;
}

export function summarizeBotAccess(person: BotAccess): BotAccessRole {
  const roles: Record<string, BotAccessRole> = {
    admin: "Admin",
    administrator: "Admin",
    reader: "Leitura",
    read: "Leitura",
    "read-only": "Leitura",
    editor: "Editor",
    custom: "Personalizado",
  };
  if (person.roleId && roles[person.roleId.toLowerCase()])
    return roles[person.roleId.toLowerCase()];
  const permissions = person.permissions.map(({ area, actions }) => ({
    area: area.toLowerCase(),
    actions: new Set(actions.map((action) => action.toLowerCase())),
  }));
  // Managing the bot's team distinguishes administrative access from content editing.
  if (permissions.some(({ area, actions }) => area === "team" && actions.has("write")))
    return "Admin";
  if (
    permissions.length &&
    permissions.every(({ actions }) => actions.size === 1 && actions.has("read"))
  )
    return "Leitura";
  if (
    permissions.length &&
    permissions.every(
      ({ actions }) => actions.size === 2 && actions.has("read") && actions.has("write"),
    )
  )
    return "Editor";
  return "Personalizado";
}

export type BotPerson = { identity: string; role?: BotAccessRole; isOwner: boolean };

export function getBotPeople(access: BotAccess[] | null, owner: unknown): BotPerson[] {
  const people = new Map<string, BotPerson>();
  for (const person of access ?? []) {
    const identity = decodePortalIdentity(person.identity);
    people.set(identity.toLowerCase(), {
      identity,
      role: summarizeBotAccess(person),
      isOwner: false,
    });
  }
  if (typeof owner === "string" && owner.trim()) {
    const identity = decodePortalIdentity(owner);
    const key = identity.toLowerCase();
    people.set(key, { ...(people.get(key) ?? { identity }), isOwner: true });
  }
  return [...people.values()].sort(
    (a, b) => Number(b.isOwner) - Number(a.isOwner) || a.identity.localeCompare(b.identity),
  );
}
