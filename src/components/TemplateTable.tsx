import { CopyPlus } from "lucide-react";
import type { Template } from "../types/templates";
import { EmptyState } from "./ui/Feedback";
import { StatusBadge } from "./ui/StatusBadge";

export function TemplateTable({
  templates,
  selected,
  loading,
  loaded,
  onToggle,
  focusedKey,
  onPreview,
  onDuplicate,
  duplicateDisabled,
}: {
  templates: Template[];
  selected: Set<string>;
  loading: boolean;
  loaded: boolean;
  onToggle: (key: string) => void;
  focusedKey: string;
  onPreview: (key: string) => void;
  onDuplicate: (template: Template) => void;
  duplicateDisabled: boolean;
}) {
  return (
    <div className="ember-table-wrap template-table-wrap" aria-busy={loading}>
      <table className="ember-table responsive-table" aria-label="Templates do router de origem">
        <thead>
          <tr>
            <th className="select-column" scope="col">
              <span className="sr-only">Selecionar</span>
            </th>
            <th scope="col">Nome</th>
            <th scope="col">Idioma</th>
            <th scope="col">Categoria</th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {loading || !templates.length ? (
            <tr>
              <td colSpan={6} className="empty-cell">
                <EmptyState
                  loading={loading}
                  title={
                    loading
                      ? "Buscando templates…"
                      : loaded
                        ? "Nenhum template encontrado"
                        : "Seus templates começam aqui"
                  }
                >
                  {loading
                    ? "Aguarde a resposta do router de origem."
                    : loaded
                      ? "Ajuste o nome ou busque sem filtro para ver todos os templates."
                      : "Selecione um router de origem e use Buscar. Depois, escolha os templates que deseja replicar."}
                </EmptyState>
              </td>
            </tr>
          ) : (
            templates.map((template) => {
              const key = `${template.name}|${template.language}`;
              return (
                <tr
                  key={key}
                  className={`${selected.has(key) ? "selected" : ""} ${focusedKey === key ? "tl-focused" : ""}`}
                >
                  <td className="select-column">
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => onToggle(key)}
                      aria-label={`Selecionar ${template.name}`}
                    />
                  </td>
                  <td className="template-name" data-label="Nome">
                    <button
                      type="button"
                      className="tl-name-button"
                      aria-label={`Visualizar ${template.name}`}
                      aria-pressed={focusedKey === key}
                      onClick={() => onPreview(key)}
                    >
                      {template.name}
                    </button>
                  </td>
                  <td data-label="Idioma">{template.language}</td>
                  <td data-label="Categoria">{template.category}</td>
                  <td data-label="Status">
                    <StatusBadge status={template.status} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="tl-row-duplicate"
                      aria-label={`Duplicar ${template.name}`}
                      title="Duplicar para edição"
                      disabled={duplicateDisabled}
                      onClick={() => onDuplicate(template)}
                    >
                      <CopyPlus size={16} />
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
