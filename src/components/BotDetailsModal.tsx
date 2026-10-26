import { useEffect, useState } from "react";
import { Clipboard, LoaderCircle, X } from "lucide-react";
import { Button } from "./ui/Button";
import { Feedback } from "./ui/Feedback";
import { loadBotAccess, loadBotMetadata, type BotAccess } from "../lib/botDetails";
import { sendBlipCommand } from "../lib/blipProxy";
import { sanitizeActivityValue } from "../lib/activityLog";
import type { PortalApplicationAccount, ResolvedRouterKey } from "../types/templates";

const read = (uri: string) =>
  sendBlipCommand(
    {
      id: crypto.randomUUID(),
      method: "get",
      to: "postmaster@portal.blip.ai",
      uri,
    },
    { destination: "BlipService", timeout: 30000 },
  );

export function BotDetailsModal({
  application,
  phone,
  onClose,
  resolveKey,
  copyText,
}: {
  application: PortalApplicationAccount;
  phone?: { status: string; phoneNumber: string | null };
  onClose: () => void;
  resolveKey: (shortName: string) => Promise<ResolvedRouterKey>;
  copyText: (text: string) => Promise<void>;
}) {
  const [metadata, setMetadata] = useState<Record<string, unknown>>(application);
  const [metadataError, setMetadataError] = useState("");
  const [access, setAccess] = useState<BotAccess[] | null>(null);
  const [accessError, setAccessError] = useState("");
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState(false);
  const [notice, setNotice] = useState("");
  const [copyError, setCopyError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setAccess(null);
    setMetadataError("");
    setAccessError("");
    setMetadata(application);
    if (application.hasPermission === false) {
      setMetadataError("Sem acesso ao bot. Apenas os metadados da listagem estão disponíveis.");
      setAccessError("Sem permissão para consultar a equipe deste bot.");
      setLoading(false);
      return () => {
        active = false;
      };
    }
    void Promise.allSettled([
      loadBotMetadata(application.shortName, read)
        .then((value) => {
          if (active)
            setMetadata({
              ...application,
              ...(sanitizeActivityValue(value) as Record<string, unknown>),
            });
        })
        .catch((error: unknown) => {
          if (active)
            setMetadataError(
              error instanceof Error ? error.message : "Falha ao carregar o cadastro.",
            );
        }),
      loadBotAccess(application.shortName, read)
        .then((value) => {
          if (active) setAccess(value);
        })
        .catch((error: unknown) => {
          if (active)
            setAccessError(
              error instanceof Error
                ? error.message
                : "Não foi possível consultar as pessoas com acesso.",
            );
        }),
    ]).then(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [application]);

  async function copyKey() {
    if (application.hasPermission === false) return;
    setCopying(true);
    setCopyError("");
    setNotice("");
    try {
      const resolved = await resolveKey(application.shortName);
      await copyText(resolved.key);
      setNotice("Key copiada.");
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : "Não foi possível copiar a key.");
    } finally {
      setCopying(false);
    }
  }

  const value = (key: string) =>
    typeof metadata[key] === "string" ? String(metadata[key]) : "Não informado";
  const date = (key: string) =>
    typeof metadata[key] === "string" && Number.isFinite(Date.parse(String(metadata[key])))
      ? new Date(String(metadata[key])).toLocaleString("pt-BR")
      : "Não informado";

  return (
    <div className="ember-modal-backdrop" role="presentation">
      <section
        className="ember-modal bot-details-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bot-details-title"
        data-modal-id="bot-details"
        tabIndex={-1}
      >
        <div className="ember-modal-header">
          <div>
            <h2 id="bot-details-title">Detalhes de {application.name}</h2>
            <p>{application.shortName}</p>
          </div>
          <Button
            variant="secondary"
            className="icon-only"
            aria-label="Fechar detalhes"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </Button>
        </div>
        <div className="bot-details-body">
          {loading && (
            <p role="status">
              <LoaderCircle className="spin" size={16} aria-hidden="true" /> Consultando cadastro e
              acessos…
            </p>
          )}
          {metadataError && (
            <Feedback title="Cadastro parcialmente disponível">
              {metadataError} Os dados abaixo vieram da listagem.
            </Feedback>
          )}
          {notice && <Feedback tone="success">{notice}</Feedback>}
          {copyError && <Feedback>{copyError}</Feedback>}
          <dl className="bot-details-fields">
            <div>
              <dt>Nome</dt>
              <dd>{value("name")}</dd>
            </div>
            <div>
              <dt>ID</dt>
              <dd>{application.shortName}</dd>
            </div>
            <div>
              <dt>Tipo</dt>
              <dd>
                {metadata.template === "master" ? "Router" : "Builder"} · {value("template")}
              </dd>
            </div>
            <div>
              <dt>Contrato</dt>
              <dd>{value("tenantId")}</dd>
            </div>
            <div>
              <dt>Proprietário informado pela Blip</dt>
              <dd>{value("emailOwner")}</dd>
            </div>
            <div>
              <dt>Seu acesso ao bot</dt>
              <dd>
                {metadata.hasPermission === true
                  ? "Permitido"
                  : metadata.hasPermission === false
                    ? "Sem acesso"
                    : "Não informado"}
              </dd>
            </div>
            <div>
              <dt>Criado em</dt>
              <dd>{date("created")}</dd>
            </div>
            <div>
              <dt>Atualizado em</dt>
              <dd>{date("updated")}</dd>
            </div>
            <div className="bot-details-wide">
              <dt>Descrição</dt>
              <dd>{value("description")}</dd>
            </div>
            {application.template === "master" && (
              <div>
                <dt>WhatsApp</dt>
                <dd>
                  {phone?.status === "connected"
                    ? phone.phoneNumber
                    : phone?.status === "not-connected"
                      ? "Não conectado"
                      : "Consulta indisponível"}
                </dd>
              </div>
            )}
            <div className="bot-details-key">
              <dt>Key</dt>
              <dd>
                <code>
                  {application.hasPermission === false ? "Indisponível" : "Key ••••••••••••••••"}
                </code>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={copying || application.hasPermission === false}
                  onClick={() => void copyKey()}
                  aria-label="Copiar key do bot"
                >
                  {copying ? <LoaderCircle className="spin" size={16} /> : <Clipboard size={16} />}{" "}
                  Copiar key
                </Button>
              </dd>
            </div>
          </dl>
          <section aria-labelledby="bot-access-title">
            <h3 id="bot-access-title">Pessoas com acesso {access ? `(${access.length})` : ""}</h3>
            <p>
              Permissões diretas retornadas para este bot. Não representam todos os administradores
              do contrato.
            </p>
            {accessError && (
              <Feedback title="Consulta de acessos indisponível">{accessError}</Feedback>
            )}
            {access?.length === 0 && <p>Nenhuma permissão direta retornada pela Blip.</p>}
            {access?.map((person) => (
              <details className="bot-access-person" key={person.identity}>
                <summary>
                  {person.identity} <span>· {person.permissions.length} área(s)</span>
                </summary>
                <dl>
                  {person.permissions.map((permission, index) => (
                    <div key={`${permission.area}-${index}`}>
                      <dt>{permission.area}</dt>
                      <dd>
                        {permission.actions.join(", ") || "Sem ações"}
                        {permission.updated ? ` · ${permission.updated}` : ""}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            ))}
          </section>
          <details>
            <summary>Todos os dados do cadastro</summary>
            <pre className="code">{JSON.stringify(sanitizeActivityValue(metadata), null, 2)}</pre>
          </details>
        </div>
      </section>
    </div>
  );
}
