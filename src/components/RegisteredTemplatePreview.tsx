import { useState } from "react";
import { CopyPlus, Eye } from "lucide-react";
import type { Template } from "../types/templates";
import { templateComponents } from "../../shared/templateLibrary.mjs";
import { Button } from "./ui/Button";
import { StatusBadge } from "./ui/StatusBadge";
import { TemplateMessagePreview } from "./TemplateMessagePreview";
import "../styles/template-library.css";

export function RegisteredTemplatePreview({
  template,
  sourceName,
  onDuplicate,
  disabled,
  loading,
}: {
  template?: Template;
  sourceName: string;
  onDuplicate: (template: Template) => void;
  disabled: boolean;
  loading: boolean;
}) {
  const [examples, setExamples] = useState(true);
  const components = templateComponents(template?.components);
  const cards = components.find((c) => c.type === "CAROUSEL")?.cards || [];
  const buttonGroups = [components, ...cards.map((c) => templateComponents(c.components))];
  return (
    <aside className="tl-preview" aria-label="Visualizador de template" aria-busy={loading}>
      <div className="tl-preview-heading">
        <h3>
          <Eye size={17} /> Visualização
        </h3>
        {template && (
          <Button size="sm" onClick={() => onDuplicate(template)} disabled={disabled || loading}>
            <CopyPlus size={14} />
            Duplicar
          </Button>
        )}
      </div>
      {!template || loading ? (
        <p className="tl-empty">
          {loading
            ? "Carregando templates…"
            : "Clique no nome de um template para visualizar a mensagem."}
        </p>
      ) : (
        <>
          <div className="tl-identification">
            <strong>{template.name}</strong>
            <span>
              {template.language} · {template.category}
            </span>
            <StatusBadge status={template.status} />
          </div>
          <label className="tc-preview-toggle tl-example-toggle">
            <input
              type="checkbox"
              checked={examples}
              onChange={(e) => setExamples(e.target.checked)}
            />
            Usar exemplos
          </label>
          <TemplateMessagePreview
            key={`${template.name}|${template.language}`}
            components={components}
            sourceName={sourceName}
            useExamples={examples}
          />
          <p className="tc-preview-caption">
            Prévia com os dados cadastrados. Mídias temporárias podem expirar; a aparência pode
            variar no WhatsApp.
          </p>
          {buttonGroups.some((group) => group.some((c) => c.type === "BUTTONS")) && (
            <details className="tl-button-details">
              <summary>Links e ações dos botões</summary>
              {buttonGroups.map((group, i) =>
                group
                  .filter((c) => c.type === "BUTTONS")
                  .flatMap((c) => c.buttons || [])
                  .map((button, j) => (
                    <div key={`${i}-${j}`}>
                      <strong>
                        {cards.length && i ? `Cartão ${i} · ` : ""}
                        {button.text || button.type}
                      </strong>
                      <code>
                        {button.url || button.phone_number || button.otp_type || button.type}
                      </code>
                    </div>
                  )),
              )}
            </details>
          )}
        </>
      )}
    </aside>
  );
}
