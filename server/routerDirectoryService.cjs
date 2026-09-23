const { randomUUID } = require("node:crypto");

const CONFIGURATIONS_TO = "postmaster@configurations.msging.net";
const COMMANDS_URL = "https://msging.net/commands";

class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
    this.statusCode = 400;
  }
}

function parseWhatsAppPhone(resource) {
  const gateway =
    resource && typeof resource === "object" ? resource["postmaster@wa.gw.msging.net"] : null;
  if (!gateway || typeof gateway !== "object") {
    return { phoneNumber: null, status: "not-connected" };
  }
  const active = String(gateway.IsChannelActive ?? "").toLowerCase() === "true";
  const countryCode = String(gateway.CountryCode ?? "").replace(/\D/g, "");
  const nationalNumber = String(gateway.PhoneNumber ?? "").replace(/\D/g, "");
  if (!active || !countryCode || !nationalNumber) {
    return { phoneNumber: null, status: "not-connected" };
  }
  return { phoneNumber: countryCode + nationalNumber, status: "connected" };
}

async function getRouterPhoneNumber({ routerKey, routerShortName }) {
  if (typeof routerKey !== "string" || !/^Key [A-Za-z0-9+/]+={0,2}$/.test(routerKey)) {
    throw new InputError("Chave do router inválida.");
  }
  if (typeof routerShortName !== "string" || !/^[a-z0-9-]+$/.test(routerShortName)) {
    throw new InputError("ID do router inválido.");
  }

  const id = randomUUID();
  const response = await fetch(COMMANDS_URL, {
    method: "POST",
    headers: { Authorization: routerKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      method: "get",
      to: CONFIGURATIONS_TO,
      uri: "/configuration/gateways",
    }),
    signal: AbortSignal.timeout(15000),
    redirect: "manual",
  });
  if (!response.ok)
    throw new Error(`A Blip recusou a consulta do canal (HTTP ${response.status}).`);

  const body = await response.json();
  if (body?.id !== id) throw new Error("A resposta da Blip não corresponde à consulta enviada.");
  if (body?.status !== "success") {
    const code = body?.reason?.code;
    throw new Error(`A Blip recusou a consulta do canal${code ? ` (código ${code})` : ""}.`);
  }
  if (!String(body?.to ?? "").startsWith(`${routerShortName}@msging.net/`)) {
    throw new Error("A resposta da Blip pertence a outro router.");
  }
  return parseWhatsAppPhone(body.resource);
}

module.exports = { InputError, getRouterPhoneNumber, parseWhatsAppPhone };
