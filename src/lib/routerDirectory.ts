export type RouterPhone = {
  phoneNumber: string | null;
  status: "connected" | "not-connected";
};

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function getActiveTenantId(application: unknown): string {
  const value =
    isRecord(application) && isRecord(application.response) ? application.response : application;
  const tenantId =
    isRecord(value) && typeof value.tenantId === "string"
      ? value.tenantId.trim().toLowerCase()
      : "";
  if (!/^[a-z0-9-]+$/.test(tenantId)) {
    throw new Error(
      "O Portal não informou o contrato atual. Reabra a extensão pelo contrato desejado.",
    );
  }
  return tenantId;
}

export function getAccessibleApplicationUri(tenantId: string): string {
  if (!/^[a-z0-9-]+$/.test(tenantId)) throw new Error("Contrato inválido.");
  return `/applications?tenantId=${encodeURIComponent(tenantId)}`;
}

export function getApplicationListUri(tenantId: string, roleId?: string): string {
  const accessibleUri = getAccessibleApplicationUri(tenantId);
  if (roleId === "admin") return `/tenants/${tenantId}/applications`;
  return accessibleUri;
}

export function readWhatsAppPhone(resource: unknown): RouterPhone {
  const gateway = isRecord(resource) ? resource["postmaster@wa.gw.msging.net"] : null;
  if (!isRecord(gateway)) return { phoneNumber: null, status: "not-connected" };

  const active = String(gateway.IsChannelActive ?? "").toLowerCase() === "true";
  const countryCode = String(gateway.CountryCode ?? "").replace(/\D/g, "");
  const nationalNumber = String(gateway.PhoneNumber ?? "").replace(/\D/g, "");
  if (!active || !countryCode || !nationalNumber) {
    return { phoneNumber: null, status: "not-connected" };
  }
  return { phoneNumber: countryCode + nationalNumber, status: "connected" };
}

export function matchesRouterSearch(
  application: { name: string; shortName: string; tenantId?: string },
  phoneNumber: string | null,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, "");
  return (
    application.name.toLowerCase().includes(q) ||
    application.shortName.toLowerCase().includes(q) ||
    Boolean(application.tenantId?.toLowerCase().includes(q)) ||
    Boolean(digits && phoneNumber?.includes(digits))
  );
}
