export const FLOW_PUBLIC_KEY_URI = "/whatsapp-flows/public-key/upload";

/** Only an acknowledged, well-formed response can establish absence. */
export function readFlowPublicKeyStatus(response, shortName) {
  const ownerUri = response?.metadata?.["#command.uri"];
  if (
    shortName &&
    typeof ownerUri === "string" &&
    ownerUri.startsWith("lime://") &&
    ownerUri !== `lime://${shortName}@msging.net${FLOW_PUBLIC_KEY_URI}`
  ) {
    throw new Error("A consulta da public key respondeu por outro router. Tente novamente.");
  }
  if (response?.status !== "success" || !Array.isArray(response?.resource?.data)) {
    throw new Error("Não foi possível verificar a public key. Tente consultar novamente.");
  }
  const entries = response.resource.data;
  if (entries.some((item) => !item || typeof item.business_public_key !== "string")) {
    throw new Error("A consulta da public key retornou dados incompletos. Tente novamente.");
  }
  const registered = entries.filter((item) => item.business_public_key.trim());
  return {
    exists: registered.length > 0,
    signatureStatus: registered.length
      ? String(registered[0].business_public_key_signature_status || "")
      : null,
  };
}

export function buildFlowPublicKeyCommand(shortName, id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(shortName)) {
    throw new Error("Selecione um router válido para consultar a public key.");
  }
  const identity = `${shortName}@msging.net`;
  return {
    id,
    from: identity,
    to: "postmaster@wa.gw.msging.net",
    method: "get",
    uri: `lime://${identity}${FLOW_PUBLIC_KEY_URI}`,
  };
}
