import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import type { AuthenticationDraft } from "../../shared/authenticationTemplates.mjs";
import { Button } from "./ui/Button";

type Props = {
  value: AuthenticationDraft;
  onChange: (value: AuthenticationDraft) => void;
  errors: { field: string; message: string }[];
  attempted: boolean;
};
export function AuthenticationTemplateFields({ value, onChange, errors, attempted }: Props) {
  const update = (changes: Partial<AuthenticationDraft>) => onChange({ ...value, ...changes });
  const error = (field: string) =>
    attempted
      ? errors
          .filter((item) => item.field === `auth:${field}`)
          .map((item) => (
            <span className="tc-field-error" key={item.message}>
              {item.message}
            </span>
          ))
      : null;
  const bad = (field: string) =>
    (attempted && errors.some((item) => item.field === `auth:${field}`)) || undefined;
  return (
    <>
      <section className="tc-section">
        <div className="tc-section-title">
          <h3>Autenticação por código</h3>
          <ShieldCheck size={18} />
        </div>
        <div className="tc-auth-notice">
          A Meta gera o texto no idioma selecionado. Esta categoria tem uma variável para o código,
          sem cabeçalho, texto livre, mídia, links ou botões extras.
        </div>
        <label className="tc-field">
          Modo de autenticação
          <select
            value={value.mode}
            onChange={(event) =>
              update({
                mode: event.target.value as AuthenticationDraft["mode"],
                zeroTapTermsAccepted: false,
              })
            }
            aria-invalid={bad("mode")}
          >
            <option value="COPY_CODE">Copiar código</option>
            <option value="ONE_TAP">Preencher com um toque · Android</option>
            <option value="ZERO_TAP">Preencher automaticamente (zero-tap) · Android</option>
          </select>
          {error("mode")}
        </label>
        <label className="tc-auth-check">
          <input
            type="checkbox"
            checked={value.addSecurityRecommendation}
            onChange={(event) => update({ addSecurityRecommendation: event.target.checked })}
          />
          <span>Incluir aviso para não compartilhar o código</span>
        </label>
        <div className="tc-columns">
          <label className="tc-field">
            Validade do código (minutos)
            <input
              type="number"
              min={1}
              max={90}
              step={1}
              value={value.codeExpirationMinutes}
              onChange={(event) => update({ codeExpirationMinutes: event.target.value })}
              placeholder="Sem aviso de validade"
              aria-invalid={bad("expiration")}
            />
            <span className="tc-help">De 1 a 90. Deixe vazio para omitir o aviso.</span>
            {error("expiration")}
          </label>
          <label className="tc-field">
            Prazo para entregar (segundos)
            <input
              type="number"
              min={-1}
              max={900}
              step={1}
              value={value.ttlSeconds}
              onChange={(event) => update({ ttlSeconds: event.target.value })}
              placeholder="Padrão Meta: 600 segundos"
              aria-invalid={bad("ttl")}
            />
            <span className="tc-help">
              30 a 900. Vazio usa o padrão de 10 min; -1 permite 30 dias. Prefira um prazo menor que
              a validade do código.
            </span>
            {error("ttl")}
          </label>
        </div>
        <label className="tc-field">
          Texto do botão de copiar (opcional)
          <input
            value={value.copyText}
            onChange={(event) => update({ copyText: event.target.value })}
            placeholder="Usar texto padrão do idioma"
            aria-invalid={bad("copyText")}
          />
          <span className="tc-help">
            Até 25 caracteres. Também é o botão de alternativa quando o preenchimento automático não
            está disponível.
          </span>
          {error("copyText")}
        </label>
        {value.mode !== "COPY_CODE" && (
          <label className="tc-field">
            Texto do botão de preencher (opcional)
            <input
              value={value.autofillText}
              onChange={(event) => update({ autofillText: event.target.value })}
              placeholder="Usar texto padrão do idioma"
              aria-invalid={bad("autofillText")}
            />
            <span className="tc-help">Até 25 caracteres.</span>
            {error("autofillText")}
          </label>
        )}
      </section>
      {value.mode !== "COPY_CODE" && (
        <section className="tc-section">
          <div className="tc-section-title">
            <h3>
              Apps Android <span className="tc-optional">{value.supportedApps.length}/5</span>
            </h3>
            <Button
              size="sm"
              disabled={value.supportedApps.length >= 5}
              onClick={() =>
                update({
                  supportedApps: [
                    ...value.supportedApps,
                    { id: crypto.randomUUID(), packageName: "", signatureHash: "" },
                  ],
                })
              }
            >
              <Plus size={14} />
              Adicionar app
            </Button>
          </div>
          <p className="tc-help">
            Informe os pares de pacote e hash do app que recebe o código. O app precisa integrar o
            handshake de OTP do WhatsApp; cadastrar o template não configura essa integração.
          </p>
          {error("apps")}
          {value.supportedApps.map((app, index) => (
            <div className="tc-button-editor" key={app.id}>
              <div className="tc-button-heading">
                <strong>App {index + 1}</strong>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remover app ${index + 1}`}
                  disabled={value.supportedApps.length <= 1}
                  onClick={() =>
                    update({ supportedApps: value.supportedApps.filter((_, i) => i !== index) })
                  }
                >
                  <Trash2 size={15} />
                </Button>
              </div>
              <label className="tc-field">
                Nome do pacote
                <input
                  value={app.packageName}
                  onChange={(event) =>
                    update({
                      supportedApps: value.supportedApps.map((item, i) =>
                        i === index ? { ...item, packageName: event.target.value } : item,
                      ),
                    })
                  }
                  placeholder="com.empresa.aplicativo"
                  aria-label={`Pacote Android ${index + 1}`}
                  aria-invalid={bad(`app:${index}`)}
                />
                <span className="tc-help">
                  Até 224 caracteres. Cada segmento começa por uma letra.
                </span>
              </label>
              <label className="tc-field">
                Hash de assinatura
                <input
                  value={app.signatureHash}
                  onChange={(event) =>
                    update({
                      supportedApps: value.supportedApps.map((item, i) =>
                        i === index ? { ...item, signatureHash: event.target.value } : item,
                      ),
                    })
                  }
                  placeholder="11 caracteres"
                  aria-label={`Hash de assinatura ${index + 1}`}
                  aria-invalid={bad(`app:${index}`)}
                />
              </label>
              {error(`app:${index}`)}
            </div>
          ))}
          <a
            href="https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/autofill-button-authentication-templates"
            target="_blank"
            rel="noreferrer"
          >
            Requisitos de integração Android
          </a>
        </section>
      )}
      {value.mode === "ZERO_TAP" && (
        <section className="tc-section">
          <h3>Aceite para zero-tap</h3>
          <label className="tc-auth-check tc-auth-terms">
            <input
              type="checkbox"
              checked={value.zeroTapTermsAccepted}
              onChange={(event) => update({ zeroTapTermsAccepted: event.target.checked })}
              aria-invalid={bad("terms")}
            />
            <span>
              Entendo que o zero-tap está sujeito aos Termos de Serviço do WhatsApp Business e que
              sou responsável por garantir que os clientes esperem o preenchimento automático do
              código ao escolherem recebê-lo pelo WhatsApp.
            </span>
          </label>
          {error("terms")}
          <a href="https://www.whatsapp.com/legal/business-terms" target="_blank" rel="noreferrer">
            Ler os Termos do WhatsApp Business
          </a>
        </section>
      )}
    </>
  );
}
