import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ExternalLink,
  FileText,
  Image,
  MapPin,
  MessageSquareText,
  Phone,
  Plus,
  Send,
  Trash2,
  Video,
} from "lucide-react";
import {
  compileTemplateDraft,
  countCharacters,
  newTemplateDraft,
  TEMPLATE_LANGUAGES,
  variableNames,
  type TemplateDraft,
  type TemplateButtonDraft,
} from "../../shared/templateCreation.mjs";
import { postJson } from "../lib/api";
import { showBlipAlert } from "../lib/blipProxy";
import { authenticationPreview } from "../../shared/authenticationTemplates.mjs";
import { TemplateMessagePreview } from "./TemplateMessagePreview";
import { normalizeTemplateName, type CatalogTemplate } from "../../shared/templateLibrary.mjs";
import { AuthenticationTemplateFields } from "./AuthenticationTemplateFields";
import { Button } from "./ui/Button";
import "../styles/template-creation.css";

const languageNames = new Intl.DisplayNames(["pt-BR"], { type: "language" });
const DOCS = "https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/";
const BUTTON_NAMES = {
  QUICK_REPLY: "Resposta rápida",
  URL: "Acessar site",
  PHONE_NUMBER: "Ligar",
  COPY_CODE: "Copiar código",
};
type Props = {
  sourceId: string;
  sourceScope: string;
  sourceName: string;
  hasSource: boolean;
  ensureSourceKey: () => Promise<string>;
  onSelectSource: () => void;
  knownNames: Set<string>;
  namesLoaded: boolean;
  namesLoading: boolean;
  namesError: string;
  onRefreshNames: () => Promise<void>;
  duplicateRequest: {
    id: string;
    scope: string;
    draft: TemplateDraft;
    originalName: string;
  } | null;
  onBusyChange: (busy: boolean) => void;
  onCreated: (scope: string, template: CatalogTemplate) => void;
};
type CreationResult = {
  template: {
    name: string;
    language: string;
    category: string;
    status: string | null;
    id: string | null;
  };
};

function formattedText(text: string): ReactNode[] {
  return text
    .split(/(\{\{[^{}]+\}\}|```[^`]+```|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g)
    .map((part, index) => {
      if (part.startsWith("{{")) return <span key={index}>{part}</span>;
      if (part.startsWith("```") && part.endsWith("```"))
        return <code key={index}>{part.slice(3, -3)}</code>;
      if (part.startsWith("*") && part.endsWith("*"))
        return <strong key={index}>{part.slice(1, -1)}</strong>;
      if (part.startsWith("_") && part.endsWith("_"))
        return <em key={index}>{part.slice(1, -1)}</em>;
      if (part.startsWith("~") && part.endsWith("~")) return <s key={index}>{part.slice(1, -1)}</s>;
      return part;
    });
}

export function TemplateCreationTab({
  sourceId,
  sourceScope,
  sourceName,
  hasSource,
  ensureSourceKey,
  onSelectSource,
  knownNames,
  namesLoaded,
  namesLoading,
  namesError,
  onRefreshNames,
  duplicateRequest,
  onBusyChange,
  onCreated,
}: Props) {
  const [draft, setDraft] = useState<TemplateDraft>(newTemplateDraft);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<(CreationResult & { source: string }) | null>(null);
  const [showExamples, setShowExamples] = useState(true);
  const [authPreviewScenario, setAuthPreviewScenario] = useState("default");
  const isAuthentication = draft.category === "AUTHENTICATION";
  const otpPreview = authenticationPreview(
    draft.authentication,
    draft.language,
    showExamples,
    authPreviewScenario,
  );
  const [sentFingerprint, setSentFingerprint] = useState("");
  const submission = useRef({ fingerprint: "", id: "" });
  const locked = useRef(false);
  const currentSource = useRef(sourceScope);
  currentSource.current = sourceScope;
  const consumedDuplicate = useRef("");
  const [duplicateOrigin, setDuplicateOrigin] = useState("");
  useEffect(() => {
    if (
      !duplicateRequest ||
      consumedDuplicate.current === duplicateRequest.id ||
      duplicateRequest.scope !== sourceScope ||
      locked.current
    )
      return;
    consumedDuplicate.current = duplicateRequest.id;
    setDraft(structuredClone(duplicateRequest.draft));
    setDuplicateOrigin(duplicateRequest.originalName);
    setAttempted(false);
    setError("");
    setResult(null);
    setSentFingerprint("");
    submission.current = { fingerprint: "", id: "" };
    setAuthPreviewScenario("default");
    requestAnimationFrame(() => document.getElementById("tc-name")?.focus());
  }, [duplicateRequest, sourceScope]);
  const nameExists =
    Boolean(draft.name.trim()) && knownNames.has(normalizeTemplateName(draft.name));
  const advanced = !isAuthentication && draft.advancedComponents;
  const compiled = useMemo(() => compileTemplateDraft(draft), [draft]);
  const fingerprint = `${sourceScope}:${JSON.stringify(compiled.template)}`;
  const sent = sentFingerprint === fingerprint;
  const update = (key: keyof TemplateDraft, value: unknown) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setError("");
  };
  function fieldErrors(field: string) {
    const messages = attempted ? compiled.errors.filter((item) => item.field === field) : [];
    if (field === "name" && nameExists && !sent)
      messages.push({
        field,
        message: "Já existe um template com este nome neste router. Escolha outro nome.",
      });
    return messages.length ? (
      <span id={`tc-error-${field}`} className="tc-field-error">
        {messages.map((item) => item.message).join(" ")}
      </span>
    ) : null;
  }
  function textField(
    key: "name" | "headerText" | "body" | "footer",
    label: string,
    max: number,
    multiline = false,
    placeholder = "",
  ) {
    const count = countCharacters(draft[key]);
    const bad =
      (attempted && compiled.errors.some((item) => item.field === key)) ||
      (key === "name" && nameExists && !sent);
    return (
      <label className="tc-field" htmlFor={`tc-${key}`}>
        <span className="tc-label">
          {label}
          <span className={count > max ? "tc-field-error" : "tc-count"}>
            {count.toLocaleString("pt-BR")} / {max.toLocaleString("pt-BR")}
          </span>
        </span>
        {multiline ? (
          <textarea
            id={`tc-${key}`}
            rows={6}
            value={draft[key]}
            onChange={(event) => update(key, event.target.value)}
            placeholder={placeholder}
            aria-invalid={bad || undefined}
            aria-describedby={bad ? `tc-error-${key}` : undefined}
          />
        ) : (
          <input
            id={`tc-${key}`}
            value={draft[key]}
            onChange={(event) => update(key, event.target.value)}
            placeholder={placeholder}
            aria-invalid={bad || undefined}
            aria-describedby={bad ? `tc-error-${key}` : undefined}
          />
        )}
        {fieldErrors(key)}
      </label>
    );
  }
  function variableExamples(field: "body" | "headerText") {
    const names = variableNames(draft[field]);
    return names.length ? (
      <div className="tc-examples">
        <p>Exemplos para análise da Meta e prévia</p>
        {names.map((name) => (
          <label className="tc-field" key={name}>
            <span>{`{{${name}}}`}</span>
            <input
              value={draft.examples[`${field}:${name}`] || ""}
              onChange={(event) =>
                update("examples", { ...draft.examples, [`${field}:${name}`]: event.target.value })
              }
              placeholder="Ex.: João, 12345, 28/10"
              aria-label={`Exemplo ${field === "body" ? "corpo" : "cabeçalho"} ${name}`}
            />
            {fieldErrors(`${field}:${name}`)}
          </label>
        ))}
      </div>
    ) : null;
  }
  function addVariable(field: "body" | "headerText") {
    const names = variableNames(draft[field]);
    if (field === "headerText" && names.length) return;
    const name =
      draft.parameterFormat === "POSITIONAL"
        ? String(names.length + 1)
        : field === "body"
          ? ["nome_cliente", "numero_pedido", "data_agendamento"].find(
              (value) => !names.includes(value),
            ) || `novo_campo${"_".repeat(names.length - 2)}`
          : "titulo";
    update(
      field,
      `${draft[field]}${draft[field] && !draft[field].endsWith(" ") ? " " : ""}{{${name}}}`,
    );
    document.getElementById(`tc-${field}`)?.focus();
  }
  function patchButton(index: number, changes: Partial<TemplateButtonDraft>) {
    update(
      "buttons",
      draft.buttons.map((button, i) => (i === index ? { ...button, ...changes } : button)),
    );
  }
  function moveButton(index: number, offset: number) {
    const buttons = [...draft.buttons];
    [buttons[index], buttons[index + offset]] = [buttons[index + offset], buttons[index]];
    update("buttons", buttons);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked.current || sent) return;
    setAttempted(true);
    setError("");
    if (compiled.errors.length || nameExists) {
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('.template-creator [aria-invalid="true"]')?.focus(),
      );
      return;
    }
    if (!hasSource) {
      onSelectSource();
      return;
    }
    if (!namesLoaded || namesLoading || namesError) {
      setError("Atualize o catálogo de nomes deste router antes de criar o template.");
      return;
    }
    const requestedSource = sourceScope;
    locked.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      const approved = await showBlipAlert({
        variant: "warning",
        icon: "warning",
        title: "Criar template neste router?",
        body: `Template: ${draft.name}\nIdioma: ${draft.language}\nCategoria: ${draft.category}\nRouter: ${sourceName} (${sourceId})\n\nO template será enviado para análise da Meta.`,
        buttons: { cancel: "Cancelar", confirm: "Criar template" },
      });
      if (!approved) return;
      const sourceRouterKey = await ensureSourceKey();
      if (currentSource.current !== requestedSource)
        throw new Error("O router selecionado mudou. Revise o destino antes de criar.");
      if (submission.current.fingerprint !== fingerprint)
        submission.current = { fingerprint, id: crypto.randomUUID() };
      const data = await postJson<CreationResult>("/api/templates/create", {
        sourceRouterKey,
        draft,
        requestId: submission.current.id,
      });
      onCreated(requestedSource, {
        ...compiled.template,
        ...data.template,
        status: data.template.status || "PENDING",
        id: data.template.id || undefined,
      });
      setResult({ ...data, source: `${sourceName} (${sourceId})` });
      setSentFingerprint(fingerprint);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível confirmar a criação. Consulte a lista antes de repetir.",
      );
    } finally {
      locked.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }
  const renderExample = (value: string, field: string) =>
    showExamples
      ? value.replace(
          /\{\{([^{}]+)\}\}/g,
          (match, param) => draft.examples[`${field}:${param}`] || match,
        )
      : value;
  const previewButtons = isAuthentication
    ? otpPreview.button
      ? [{ type: "OTP", text: otpPreview.button }]
      : []
    : compiled.template.components.find((component) => component.type === "BUTTONS")?.buttons || [];
  const [expandedButtons, setExpandedButtons] = useState(false);
  const visibleButtons =
    previewButtons.length > 3 && !expandedButtons ? previewButtons.slice(0, 2) : previewButtons;
  const headerIcon =
    draft.headerFormat === "IMAGE" ? (
      <Image size={40} />
    ) : draft.headerFormat === "VIDEO" ? (
      <Video size={40} />
    ) : draft.headerFormat === "LOCATION" ? (
      <MapPin size={40} />
    ) : (
      <FileText size={40} />
    );

  return (
    <form className="template-creator" onSubmit={submit} noValidate>
      <div className="tc-intro">
        <div>
          <span className="tc-eyebrow">NOVO TEMPLATE</span>
          <h2>Monte sua mensagem</h2>
          <p>Crie o conteúdo e veja como ele aparece no WhatsApp.</p>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setDraft(newTemplateDraft());
              setDuplicateOrigin("");
              setAttempted(false);
              setError("");
              setResult(null);
              setSentFingerprint("");
              submission.current = { fingerprint: "", id: "" };
            }}
          >
            Novo em branco
          </Button>
        </div>
        <a
          href={`${DOCS}${isAuthentication ? "authentication-templates/authentication-templates" : "utility-templates/utility-templates"}`}
          target="_blank"
          rel="noreferrer"
        >
          Regras da Meta <ExternalLink size={14} />
        </a>
      </div>
      <div className="tc-destination">
        <div>
          <strong>Router de criação</strong>
          <span>
            {hasSource
              ? `${sourceName} · ${sourceId}`
              : "Selecione um router para enviar o template."}
          </span>
        </div>
        <Button size="sm" onClick={onSelectSource} disabled={busy}>
          {hasSource ? "Trocar router" : "Selecionar router"}
        </Button>
      </div>
      {duplicateRequest && consumedDuplicate.current === duplicateRequest.id && (
        <div className="tc-copy-notice">
          Cópia de <strong>{duplicateRequest.originalName}</strong>. Revise o nome e o conteúdo
          antes de criar.
        </div>
      )}
      <div className="tc-layout">
        <fieldset className="tc-editor" disabled={busy}>
          <section className="tc-section">
            <h3>Identificação</h3>
            {textField("name", "Nome do template", 512, false, "confirmacao_pedido")}
            <div className="tc-section-title">
              <p className="tc-catalog-status" role="status">
                {namesLoading
                  ? "Carregando todos os nomes deste router…"
                  : namesError
                    ? namesError
                    : namesLoaded
                      ? `${knownNames.size} nomes em memória neste router.`
                      : "Selecione um router para verificar os nomes existentes."}
              </p>
              <Button
                size="sm"
                disabled={!hasSource || busy || namesLoading}
                onClick={() => void onRefreshNames().catch(() => {})}
              >
                Atualizar nomes
              </Button>
            </div>
            <div className="tc-columns">
              <label className="tc-field">
                Categoria
                <select
                  value={draft.category}
                  onChange={(event) => update("category", event.target.value)}
                >
                  <option value="UTILITY">Utilidade</option>
                  <option value="MARKETING">Marketing</option>
                  <option value="AUTHENTICATION">Autenticação</option>
                </select>
              </label>
              <label className="tc-field">
                Idioma
                <select
                  value={draft.language}
                  onChange={(event) => update("language", event.target.value)}
                >
                  {TEMPLATE_LANGUAGES.map(([code, label]) => (
                    <option key={code} value={code}>
                      {label === code ? languageNames.of(code.replaceAll("_", "-")) || code : label}{" "}
                      · {code}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="tc-help">
              Utilidade e Marketing usam conteúdo livre. Autenticação usa o texto e os componentes
              padronizados de código de verificação da Meta.
            </p>
          </section>
          {isAuthentication ? (
            <AuthenticationTemplateFields
              value={draft.authentication}
              onChange={(value) => {
                if (value.mode !== draft.authentication.mode) setAuthPreviewScenario("default");
                update("authentication", value);
              }}
              errors={compiled.errors}
              attempted={attempted}
            />
          ) : advanced ? (
            <section className="tc-section">
              <h3>Componentes do template</h3>
              <p className="tc-help">
                Este template usa um formato avançado. Todos os cartões, mídias, exemplos e botões
                foram preservados e podem ser editados no JSON abaixo. A prévia acompanha as
                alterações; a Meta valida as regras deste formato no envio.
              </p>
              <label className="tc-field">
                Componentes editáveis
                <textarea
                  className="tc-advanced-json"
                  value={draft.componentsJson}
                  onChange={(e) => update("componentsJson", e.target.value)}
                  aria-invalid={
                    (attempted && compiled.errors.some((e) => e.field === "componentsJson")) ||
                    undefined
                  }
                />
                {fieldErrors("componentsJson")}
              </label>
            </section>
          ) : (
            <>
              <section className="tc-section">
                <div className="tc-section-title">
                  <h3>Conteúdo</h3>
                  <label className="tc-inline-field">
                    Variáveis
                    <select
                      value={draft.parameterFormat}
                      onChange={(event) => update("parameterFormat", event.target.value)}
                    >
                      <option value="POSITIONAL">Numéricas · {"{{1}}"}</option>
                      <option value="NAMED">Nomeadas · {"{{nome}}"}</option>
                    </select>
                  </label>
                </div>
                <label className="tc-field">
                  Cabeçalho <span className="tc-optional">opcional</span>
                  <select
                    value={draft.headerFormat}
                    onChange={(event) => update("headerFormat", event.target.value)}
                  >
                    <option value="NONE">Sem cabeçalho</option>
                    <option value="TEXT">Texto</option>
                    <option value="IMAGE">Imagem</option>
                    <option value="VIDEO">Vídeo</option>
                    <option value="DOCUMENT">Documento</option>
                    <option value="LOCATION">Localização</option>
                  </select>
                </label>
                {!isAuthentication && draft.headerFormat === "TEXT" && (
                  <>
                    {textField("headerText", "Texto do cabeçalho", 60)}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => addVariable("headerText")}
                      disabled={variableNames(draft.headerText).length > 0}
                    >
                      <Plus size={14} />
                      Variável no cabeçalho
                    </Button>
                    {variableExamples("headerText")}
                  </>
                )}
                {["IMAGE", "VIDEO", "DOCUMENT"].includes(draft.headerFormat) && (
                  <div className="tc-examples">
                    <label className="tc-field">
                      URL da mídia de exemplo
                      <input
                        value={draft.mediaUrl}
                        onChange={(e) => {
                          update("mediaUrl", e.target.value);
                          update("mediaHandle", "");
                        }}
                        placeholder="https://…"
                      />
                      <span className="tc-help">
                        Ao criar, a Blip envia esta mídia para análise da Meta. Links temporários
                        precisam continuar válidos.
                      </span>
                      {fieldErrors("mediaUrl")}
                    </label>
                    <label className="tc-field">
                      Ou handle da mídia de exemplo
                      <input
                        value={draft.mediaHandle}
                        onChange={(event) => {
                          update("mediaHandle", event.target.value);
                          update("mediaUrl", "");
                        }}
                        placeholder="4::…"
                      />
                      <span className="tc-help">
                        Use o identificador retornado pelo upload da Meta para esta conta. A mídia
                        será analisada junto com o template. URLs e IDs de mensagem não substituem o
                        handle.
                      </span>
                      {fieldErrors("mediaHandle")}
                      <a
                        href="https://developers.facebook.com/docs/graph-api/guides/upload"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Como obter o handle <ExternalLink size={12} />
                      </a>
                    </label>
                  </div>
                )}
                {draft.headerFormat === "LOCATION" && (
                  <p className="tc-help">
                    O endereço e as coordenadas são informados no envio da mensagem.
                  </p>
                )}
                {textField(
                  "body",
                  "Corpo da mensagem",
                  1024,
                  true,
                  "Olá, {{1}}! Seu pedido {{2}} foi confirmado. Obrigado pela preferência.",
                )}
                <div className="tc-toolbar">
                  <Button size="sm" variant="ghost" onClick={() => addVariable("body")}>
                    <Plus size={14} />
                    Adicionar variável
                  </Button>
                  <span>*negrito* · _itálico_ · ~riscado~</span>
                </div>
                {variableExamples("body")}
                {textField(
                  "footer",
                  "Rodapé (opcional)",
                  60,
                  false,
                  "Obrigado por escolher nossa empresa",
                )}
              </section>
              <section className="tc-section">
                <div className="tc-section-title">
                  <h3>
                    Botões <span className="tc-optional">{draft.buttons.length}/10</span>
                  </h3>
                  <Button
                    size="sm"
                    onClick={() =>
                      update("buttons", [
                        ...draft.buttons,
                        {
                          id: crypto.randomUUID(),
                          type: "QUICK_REPLY",
                          text: "",
                          url: "",
                          phoneNumber: "",
                          example: "",
                        },
                      ])
                    }
                    disabled={draft.buttons.length >= 10}
                  >
                    <Plus size={14} />
                    Adicionar botão
                  </Button>
                </div>
                <p className="tc-help">
                  Até 2 links, 1 telefone e 1 código. As respostas rápidas são agrupadas ao final.
                </p>
                {fieldErrors("buttons")}
                {draft.buttons.length === 0 && (
                  <div className="tc-empty">
                    Inclua uma resposta rápida, um link, telefone ou código.
                  </div>
                )}
                {draft.buttons.map((button, index) => (
                  <div className="tc-button-editor" key={button.id}>
                    <div className="tc-button-heading">
                      <strong>Botão {index + 1}</strong>
                      <div>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Mover botão ${index + 1} para cima`}
                          disabled={index === 0}
                          onClick={() => moveButton(index, -1)}
                        >
                          <ArrowUp size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Mover botão ${index + 1} para baixo`}
                          disabled={index === draft.buttons.length - 1}
                          onClick={() => moveButton(index, 1)}
                        >
                          <ArrowDown size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remover botão ${index + 1}`}
                          onClick={() =>
                            update(
                              "buttons",
                              draft.buttons.filter((_, i) => i !== index),
                            )
                          }
                        >
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    </div>
                    <div className="tc-columns">
                      <label className="tc-field">
                        Ação
                        <select
                          value={button.type}
                          onChange={(event) =>
                            patchButton(index, {
                              type: event.target.value as TemplateButtonDraft["type"],
                            })
                          }
                        >
                          {Object.entries(BUTTON_NAMES).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {button.type !== "COPY_CODE" && (
                        <label className="tc-field">
                          <span className="tc-label">
                            Rótulo
                            <span className="tc-count">{countCharacters(button.text)}/25</span>
                          </span>
                          <input
                            value={button.text}
                            onChange={(event) => patchButton(index, { text: event.target.value })}
                            aria-label={`Rótulo botão ${index + 1}`}
                          />
                        </label>
                      )}
                    </div>
                    {button.type === "URL" && (
                      <>
                        <label className="tc-field">
                          URL
                          <input
                            value={button.url}
                            onChange={(event) => patchButton(index, { url: event.target.value })}
                            placeholder="https://exemplo.com/pedido/{{1}}"
                            aria-label={`URL botão ${index + 1}`}
                          />
                        </label>
                        {variableNames(button.url).length > 0 && (
                          <label className="tc-field">
                            Sufixo de exemplo
                            <input
                              value={button.example}
                              onChange={(event) =>
                                patchButton(index, { example: event.target.value })
                              }
                              placeholder="pedido-12345"
                            />
                          </label>
                        )}
                      </>
                    )}
                    {button.type === "PHONE_NUMBER" && (
                      <label className="tc-field">
                        Telefone com DDI
                        <input
                          value={button.phoneNumber}
                          onChange={(event) =>
                            patchButton(index, { phoneNumber: event.target.value })
                          }
                          placeholder="5511999990000"
                        />
                      </label>
                    )}
                    {button.type === "COPY_CODE" && (
                      <label className="tc-field">
                        Código de exemplo (até 20 caracteres)
                        <input
                          value={button.example}
                          onChange={(event) => patchButton(index, { example: event.target.value })}
                        />
                      </label>
                    )}
                    {fieldErrors(`button:${index}`)}
                  </div>
                ))}
              </section>
            </>
          )}
          {!isAuthentication && draft.messageSendTtl !== "" && (
            <label className="tc-field">
              Prazo de entrega (segundos)
              <input
                value={draft.messageSendTtl}
                onChange={(e) => update("messageSendTtl", e.target.value)}
              />
              {fieldErrors("messageSendTtl")}
            </label>
          )}
        </fieldset>
        <aside className="tc-preview-column" aria-label="Prévia do template">
          <div className="tc-preview-sticky">
            <div className="tc-section-title">
              <h3>Prévia da mensagem</h3>
              <label className="tc-preview-toggle">
                <input
                  type="checkbox"
                  checked={showExamples}
                  onChange={(event) => setShowExamples(event.target.checked)}
                />
                Usar exemplos
              </label>
            </div>
            {isAuthentication && draft.authentication.mode !== "COPY_CODE" && (
              <label className="tc-field">
                Cenário da prévia OTP
                <select
                  value={authPreviewScenario}
                  onChange={(event) => setAuthPreviewScenario(event.target.value)}
                >
                  <option value="default">Recebimento padrão no Android</option>
                  {draft.authentication.mode === "ZERO_TAP" && (
                    <option value="one">Alternativa: preencher com um toque</option>
                  )}
                  <option value="copy">Alternativa: copiar código</option>
                </select>
              </label>
            )}
            {advanced ? (
              <TemplateMessagePreview
                components={compiled.template.components}
                sourceName={sourceName}
                useExamples={showExamples}
              />
            ) : (
              <div className="tc-chat">
                <div className="tc-chat-brand">
                  <MessageSquareText size={20} />
                  <div>
                    <strong>{sourceName || "Sua empresa"}</strong>
                    <span>Conta comercial</span>
                  </div>
                </div>
                <div className="tc-bubble">
                  {!isAuthentication && draft.headerFormat === "TEXT" && (
                    <div className="tc-bubble-header">
                      {renderExample(draft.headerText, "headerText") || "Cabeçalho"}
                    </div>
                  )}
                  {!isAuthentication &&
                    ["IMAGE", "VIDEO", "DOCUMENT", "LOCATION"].includes(draft.headerFormat) && (
                      <div className="tc-media">
                        {draft.headerFormat === "IMAGE" && draft.mediaUrl ? (
                          <img
                            className="tl-image"
                            src={draft.mediaUrl}
                            alt="Imagem do template"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          headerIcon
                        )}
                        <span>
                          {draft.headerFormat === "LOCATION"
                            ? "Localização enviada com a mensagem"
                            : `Exemplo de ${draft.headerFormat === "IMAGE" ? "imagem" : draft.headerFormat === "VIDEO" ? "vídeo" : "documento"}`}
                        </span>
                      </div>
                    )}
                  <div
                    className={`tc-bubble-body ${!isAuthentication && !draft.body ? "tc-placeholder" : ""}`}
                  >
                    {isAuthentication
                      ? formattedText(otpPreview.body)
                      : draft.body
                        ? formattedText(renderExample(draft.body, "body"))
                        : "O corpo da sua mensagem aparece aqui. Comece a escrever no editor."}
                  </div>
                  {(isAuthentication ? otpPreview.footer : draft.footer) && (
                    <div className="tc-bubble-footer">
                      {isAuthentication ? otpPreview.footer : draft.footer}
                    </div>
                  )}
                  <div className="tc-bubble-time">
                    12:00 <span>✓✓</span>
                  </div>
                  {visibleButtons.map((button: { type: string; text?: string }, index: number) => (
                    <div className="tc-preview-button" key={index}>
                      {button.type === "URL" ? (
                        <ExternalLink size={15} />
                      ) : button.type === "PHONE_NUMBER" ? (
                        <Phone size={15} />
                      ) : (
                        <MessageSquareText size={15} />
                      )}
                      {button.type === "COPY_CODE"
                        ? "Copiar código"
                        : button.text || "Rótulo do botão"}
                    </div>
                  ))}
                  {previewButtons.length > 3 && (
                    <button
                      type="button"
                      className="tc-preview-button"
                      onClick={() => setExpandedButtons((value) => !value)}
                    >
                      {expandedButtons ? "Recolher opções" : "Ver todas as opções"}
                    </button>
                  )}
                </div>
              </div>
            )}
            <p className="tc-preview-caption">
              {isAuthentication
                ? otpPreview.caption
                : advanced || draft.mediaUrl
                  ? "Prévia com os dados do rascunho. Mídias temporárias podem expirar e a aparência pode variar no WhatsApp."
                  : "Representação visual. A aparência e os textos nativos podem variar conforme o WhatsApp e o idioma. A mídia é ilustrativa."}
            </p>
            <div className="tc-guidance">
              <strong>Antes de enviar</strong>
              <ul>
                {compiled.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
                <li>
                  Use exemplos fictícios e revise consentimento, idioma e políticas comerciais. A
                  aprovação é feita pela Meta.
                </li>
              </ul>
              <a href={`${DOCS}template-review`} target="_blank" rel="noreferrer">
                Critérios de análise <ExternalLink size={12} />
              </a>
            </div>
          </div>
        </aside>
      </div>
      {attempted && compiled.errors.length > 0 && (
        <div className="tc-feedback tc-feedback-error" role="alert">
          <strong>Revise {compiled.errors.length} pendência(s) antes de criar.</strong>
          <ul>
            {compiled.errors.map((item, index) => (
              <li key={`${item.field}:${index}`}>{item.message}</li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <div className="tc-feedback tc-feedback-error" role="alert">
          {error}
        </div>
      )}
      {result && (
        <div className="tc-feedback tc-feedback-success" role="status">
          <CheckCircle2 size={20} />
          <div>
            <strong>{result.template.name} enviado à Blip</strong>
            <p>
              {result.source} · {result.template.language} · {result.template.category}
              {result.template.status
                ? ` · Status: ${result.template.status}`
                : " · Consulte a lista para acompanhar a análise da Meta."}
            </p>
            {result.template.id && <p>ID: {result.template.id}</p>}
          </div>
        </div>
      )}
      <div className="tc-submit">
        <p>
          {sent
            ? "Este conteúdo já foi enviado neste router."
            : "Revise a mensagem e o router antes de enviar para análise."}
        </p>
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          disabled={sent || nameExists || !namesLoaded || namesLoading || Boolean(namesError)}
        >
          <Send size={17} />
          {sent ? "Template enviado" : "Criar template"}
        </Button>
      </div>
    </form>
  );
}
