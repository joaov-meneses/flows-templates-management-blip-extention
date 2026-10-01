import { Button } from "./ui/Button";
import { Feedback } from "./ui/Feedback";
import type { FlowPublicKeyStatus } from "../../shared/flowPublicKey.mjs";

export function FlowPublicKeyField({
  id,
  value,
  onChange,
  state,
  onRetry,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  state: {
    status: string;
    entries: (FlowPublicKeyStatus & { shortName: string })[];
    missing: { shortName: string }[];
    error: string;
  };
  onRetry: () => void;
  disabled?: boolean;
}) {
  if (state.status === "loading")
    return <p role="status">Verificando a public key dos routers selecionados…</p>;
  if (state.error)
    return (
      <Feedback title="Consulta da public key indisponível">
        <p>{state.error}</p>
        <Button onClick={onRetry} disabled={disabled}>
          Tentar novamente
        </Button>
      </Feedback>
    );
  return (
    <div className="flow-public-key-field">
      {state.missing.length ? (
        <>
          <p id={`${id}-help`}>
            Informe a public key para {state.missing.length === 1 ? "o router" : "os routers"} sem
            chave:{" "}
            {state.missing.map((entry) => entry.shortName || "Router selecionado").join(", ")}. As
            chaves já cadastradas serão mantidas.
          </p>
          <label className="blip-native-field public-key-field" htmlFor={id}>
            business_public_key
            <textarea
              id={id}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              rows={6}
              required
              spellCheck={false}
              disabled={disabled}
              aria-describedby={`${id}-help`}
              placeholder={"-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"}
            />
          </label>
        </>
      ) : (
        <p role="status">Public key já cadastrada em todos os routers selecionados.</p>
      )}
      {state.entries.some(
        (entry) => entry.exists && entry.signatureStatus && entry.signatureStatus !== "VALID",
      ) && (
        <p>
          Há uma chave cadastrada com assinatura diferente de VALID. Confira a configuração no
          WhatsApp antes de usar o Flow API.
        </p>
      )}
    </div>
  );
}
