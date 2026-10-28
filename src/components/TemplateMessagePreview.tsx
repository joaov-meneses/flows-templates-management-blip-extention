import { useState, type ReactNode } from "react";
import {
  ExternalLink,
  FileText,
  Image,
  MapPin,
  MessageSquareText,
  Phone,
  Video,
} from "lucide-react";
import {
  publicMediaUrl,
  renderComponentText,
  templateComponents,
  type PreviewComponent,
} from "../../shared/templateLibrary.mjs";

function formattedTemplateText(text: string): ReactNode[] {
  return text
    .split(/(\{\{[^{}]+\}\}|```[^`]+```|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g)
    .map((part, i) => {
      if (part.startsWith("{{")) return <span key={i}>{part}</span>;
      if (part.startsWith("```") && part.endsWith("```"))
        return <code key={i}>{part.slice(3, -3)}</code>;
      if (part.startsWith("*") && part.endsWith("*"))
        return <strong key={i}>{part.slice(1, -1)}</strong>;
      if (part.startsWith("_") && part.endsWith("_")) return <em key={i}>{part.slice(1, -1)}</em>;
      if (part.startsWith("~") && part.endsWith("~")) return <s key={i}>{part.slice(1, -1)}</s>;
      return part;
    });
}
function Media({ component }: { component: PreviewComponent }) {
  const url = publicMediaUrl(component.example?.header_handle?.[0]);
  const [failedUrl, setFailedUrl] = useState("");
  if (component.format === "IMAGE" && url && failedUrl !== url)
    return (
      <img
        className="tl-image"
        src={url}
        alt="Imagem do template"
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(url)}
      />
    );
  if (component.format === "VIDEO" && url && failedUrl !== url)
    return (
      <video
        className="tl-image"
        src={url}
        controls
        preload="none"
        onError={() => setFailedUrl(url)}
      />
    );
  const Icon =
    component.format === "IMAGE"
      ? Image
      : component.format === "VIDEO"
        ? Video
        : component.format === "LOCATION"
          ? MapPin
          : FileText;
  return (
    <div className="tc-media">
      <Icon size={32} />
      <span>
        {component.format === "LOCATION"
          ? "Localização informada no envio"
          : failedUrl === url && url
            ? "A mídia não está mais disponível"
            : `Mídia: ${component.format || "documento"}`}
      </span>
      {url && (
        <a href={url} target="_blank" rel="noreferrer">
          Abrir mídia <ExternalLink size={12} />
        </a>
      )}
    </div>
  );
}
function Bubble({
  components,
  useExamples,
}: {
  components: PreviewComponent[];
  useExamples: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const buttons = components.find((c) => c.type === "BUTTONS")?.buttons || [];
  const visible = buttons.length > 3 && !expanded ? buttons.slice(0, 2) : buttons;
  return (
    <div className="tc-bubble">
      {components
        .filter((c) => !["BUTTONS", "CAROUSEL"].includes(c.type))
        .map((c, i) => {
          if (c.type === "HEADER")
            return c.format === "TEXT" ? (
              <div key={i} className="tc-bubble-header">
                {renderComponentText(c, useExamples)}
              </div>
            ) : (
              <Media key={i} component={c} />
            );
          if (c.type === "BODY")
            return (
              <div key={i} className="tc-bubble-body">
                {formattedTemplateText(renderComponentText(c, useExamples))}
              </div>
            );
          if (c.type === "FOOTER")
            return (
              <div key={i} className="tc-bubble-footer">
                {c.text ||
                  (c.code_expiration_minutes
                    ? `O código expira em ${c.code_expiration_minutes} minutos.`
                    : "")}
              </div>
            );
          return (
            <div className="tl-unavailable" key={i}>
              Prévia indisponível para o componente {String(c.type)}.
            </div>
          );
        })}
      <div className="tc-bubble-time">
        12:00 <span>✓✓</span>
      </div>
      {visible.map((b, i) => (
        <div className="tc-preview-button" key={i}>
          {b.type === "URL" ? (
            <ExternalLink size={15} />
          ) : b.type === "PHONE_NUMBER" ? (
            <Phone size={15} />
          ) : (
            <MessageSquareText size={15} />
          )}
          <span>
            {b.text || (["OTP", "COPY_CODE"].includes(b.type) ? "Copiar código" : b.type)}
          </span>
        </div>
      ))}
      {buttons.length > 3 && (
        <button type="button" className="tc-preview-button" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Recolher opções" : "Ver todas as opções"}
        </button>
      )}
    </div>
  );
}
export function TemplateMessagePreview({
  components,
  sourceName,
  useExamples = true,
}: {
  components: unknown;
  sourceName: string;
  useExamples?: boolean;
}) {
  const parts = templateComponents(components);
  const cards = parts.find((c) => c.type === "CAROUSEL")?.cards || [];
  return (
    <div className="tc-chat tl-chat">
      <div className="tc-chat-brand">
        <MessageSquareText size={20} />
        <div>
          <strong>{sourceName || "Sua empresa"}</strong>
          <span>Conta comercial</span>
        </div>
      </div>
      <Bubble components={parts} useExamples={useExamples} />
      {cards.length > 0 && (
        <div className="tl-carousel" aria-label="Cartões do carrossel">
          {cards.map((card, i) => (
            <div className="tl-carousel-card" key={i}>
              <span className="tl-card-index">
                Cartão {i + 1} de {cards.length}
              </span>
              <Bubble components={templateComponents(card.components)} useExamples={useExamples} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
