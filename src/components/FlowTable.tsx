import { Clipboard, Eye, Pencil, Send, Trash2 } from "lucide-react";
import type { FlowSummary } from "../types/templates";
import { ActionsMenu } from "./ui/ActionsMenu";
import { Button } from "./ui/Button";
import { EmptyState } from "./ui/Feedback";
import { StatusBadge } from "./ui/StatusBadge";

export function FlowTable({
  flows,
  selected,
  loading,
  loaded,
  filtered,
  actionId,
  onToggle,
  onPreview,
  onCopy,
  onEdit,
  onPublish,
  onDeprecate,
}: {
  flows: FlowSummary[];
  selected: Set<string>;
  loading: boolean;
  loaded: boolean;
  filtered: boolean;
  actionId: string;
  onToggle: (id: string) => void;
  onPreview: (flow: FlowSummary) => void;
  onCopy: (flow: FlowSummary) => void;
  onEdit: (flow: FlowSummary) => void;
  onPublish: (flow: FlowSummary) => void;
  onDeprecate: (flow: FlowSummary) => void;
}) {
  return (
    <div className="ember-table-wrap template-table-wrap" aria-busy={loading}>
      <table
        className="ember-table flow-table responsive-table"
        aria-label="Flows do router de origem"
      >
        <thead>
          <tr>
            <th className="select-column" scope="col">
              <span className="sr-only">Selecionar</span>
            </th>
            <th scope="col">Nome</th>
            <th scope="col">ID</th>
            <th scope="col">Categorias</th>
            <th scope="col">Status</th>
            <th scope="col">Ações</th>
          </tr>
        </thead>
        <tbody>
          {loading || !flows.length ? (
            <tr>
              <td colSpan={6} className="empty-cell">
                <EmptyState
                  loading={loading}
                  title={
                    loading
                      ? "Carregando flows…"
                      : filtered && loaded
                        ? "Nenhum flow encontrado"
                        : loaded
                          ? "Este router não tem flows"
                          : "Explore os flows do seu router"
                  }
                >
                  {loading
                    ? "Aguarde a resposta do router de origem."
                    : filtered && loaded
                      ? "Tente outro nome ou ID para ajustar o filtro."
                      : "Selecione um router de origem e use Buscar para carregar a lista."}
                </EmptyState>
              </td>
            </tr>
          ) : (
            flows.map((flow) => (
              <tr key={flow.id} className={selected.has(flow.id) ? "selected" : ""}>
                <td className="select-column">
                  <input
                    type="checkbox"
                    checked={selected.has(flow.id)}
                    onChange={() => onToggle(flow.id)}
                    aria-label={`Selecionar ${flow.name}`}
                  />
                </td>
                <td className="template-name" data-label="Nome">
                  {flow.name}
                </td>
                <td className="mono-cell" data-label="ID">
                  {flow.id}
                </td>
                <td data-label="Categorias">{flow.categories?.join(", ") || "—"}</td>
                <td data-label="Status">
                  <StatusBadge status={flow.status} />
                </td>
                <td data-label="Ações">
                  <div className="table-actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onPreview(flow)}
                      loading={actionId === `preview:${flow.id}`}
                      disabled={!!actionId}
                    >
                      {actionId !== `preview:${flow.id}` && <Eye size={16} aria-hidden="true" />}
                      Visualizar
                    </Button>
                    <ActionsMenu
                      compact
                      label={`Ações de ${flow.name}`}
                      disabled={!!actionId}
                      actions={[
                        {
                          label: "Copiar JSON",
                          icon: <Clipboard size={16} />,
                          onSelect: () => onCopy(flow),
                        },
                        {
                          label: "Editar flow",
                          icon: <Pencil size={16} />,
                          onSelect: () => onEdit(flow),
                        },
                        {
                          label: "Publicar flow",
                          icon: <Send size={16} />,
                          onSelect: () => onPublish(flow),
                          hidden: flow.status?.toUpperCase() !== "DRAFT",
                        },
                        {
                          label: "Desativar flow",
                          icon: <Trash2 size={16} />,
                          onSelect: () => onDeprecate(flow),
                          danger: true,
                          hidden: ["DEPRECATED", "DISABLED"].includes(
                            flow.status?.toUpperCase() || "",
                          ),
                        },
                      ]}
                    />
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
