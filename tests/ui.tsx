// Local visual fixture, outside the application routes and production entry graph.
// No requests, credentials or mutations of real routers.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FlowTable } from "../src/components/FlowTable";
import { TemplateTable } from "../src/components/TemplateTable";
import { Button } from "../src/components/ui/Button";
import { Feedback } from "../src/components/ui/Feedback";
import { SelectionBar } from "../src/components/ui/SelectionBar";
import { themeBootstrap } from "../src/lib/theme";
import "../src/styles.css";

const flows = [
  {
    id: "837945982408597",
    name: "agendamento_de_visita",
    status: "PUBLISHED",
    categories: ["APPOINTMENT_BOOKING"],
  },
  {
    id: "837945982408598",
    name: "pesquisa_de_satisfacao",
    status: "DRAFT",
    categories: ["SURVEY"],
  },
  {
    id: "837945982408599",
    name: "flow_com_nome_muito_longo_para_validar_quebra_responsiva_em_telas_pequenas_sem_cortar_informacao",
    status: "DEPRECATED",
  },
];

export function Fixture() {
  const [selected, setSelected] = useState(new Set<string>());
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [dark, setDark] = useState(document.documentElement.dataset.theme === "dark");
  return (
    <main style={{ padding: 16, maxWidth: 1180, margin: "auto" }}>
      <header className="ember-panel-title">
        <h1>Componentes Blip · dados de teste</h1>
        <Button
          onClick={() => {
            document.documentElement.dataset.theme = dark ? "light" : "dark";
            setDark(!dark);
          }}
        >
          Alternar tema
        </Button>
      </header>
      <section className="ember-panel">
        <div className="ember-panel-title">
          <h2>Flows</h2>
          <Button onClick={() => setLoading(!loading)}>Alternar carregamento</Button>
        </div>
        <Feedback title="Não foi possível concluir">
          Falha de teste com identificador longo: {"router_".repeat(24)}. Verifique a conexão e
          tente novamente.
        </Feedback>
        {notice && (
          <Feedback tone="success" onDismiss={() => setNotice("")}>
            {notice}
          </Feedback>
        )}
        <SelectionBar
          count={selected.size}
          targets={2}
          loading={false}
          onClear={() => setSelected(new Set())}
          onTargets={() => setNotice("Selecionar destinos acionado")}
          onReplicate={() => setNotice("Replicar acionado — somente teste")}
        />
        <FlowTable
          flows={flows}
          selected={selected}
          loading={loading}
          loaded
          filtered={false}
          actionId=""
          onToggle={(id) =>
            setSelected((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onPreview={(flow) => setNotice(`Visualizar: ${flow.name}`)}
          onCopy={(flow) => setNotice(`Copiar JSON: ${flow.name}`)}
          onEdit={(flow) => setNotice(`Editar: ${flow.name}`)}
          onPublish={(flow) => setNotice(`Publicar: ${flow.name}`)}
          onDeprecate={(flow) => setNotice(`Desativar: ${flow.name}`)}
        />
        <TemplateTable
          templates={[
            {
              name: "confirmacao_de_visita",
              language: "pt_BR",
              category: "UTILITY",
              status: "APPROVED",
              components: [],
            },
          ]}
          selected={selected}
          loaded
          loading={false}
          onToggle={(key) => {
            setSelected(new Set([key]));
            setNotice(`Template selecionado: ${key}`);
          }}
        />
      </section>
    </main>
  );
}
// A dedicated fixture uses the same bootstrap with no network side effects.
const bootstrap = document.createElement("script");
bootstrap.textContent = themeBootstrap;
document.head.append(bootstrap);
createRoot(document.getElementById("root")!).render(<Fixture />);
