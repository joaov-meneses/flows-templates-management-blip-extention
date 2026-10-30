// The full app and its existing bot picker, with synthetic Portal/API responses only.
import { createRoot } from "react-dom/client";
import CreateTemplatesApp from "../src/components/CreateTemplatesApp";
import type { InactivityAnalysis } from "../src/types/inactivity";
import { themeBootstrap } from "../src/lib/theme";
import "../src/styles.css";

const deskQueues = new Map<
  string,
  Array<{
    id: string;
    uniqueId: string;
    name: string;
    isActive: boolean;
    attendantCount: number;
    ruleCount: number;
    priorityRuleCount: number;
  }>
>();
function deskFixture(path: string, body: Record<string, string>) {
  const builderShortName = body.builderShortName;
  if (builderShortName === "builder_falha")
    return Response.json(
      { error: { message: "Falha simulada ao consultar o Desk." } },
      { status: 403 },
    );
  const queues = deskQueues.get(builderShortName) || [
    {
      id: "fixture-default",
      uniqueId: "fixture-default",
      name: "Default",
      isActive: true,
      attendantCount: 4,
      ruleCount: 0,
      priorityRuleCount: 1,
    },
    {
      id: "fixture-sales",
      uniqueId: "fixture-sales",
      name: "Comercial",
      isActive: true,
      attendantCount: 8,
      ruleCount: 3,
      priorityRuleCount: 2,
    },
    {
      id: "fixture-support",
      uniqueId: "fixture-support",
      name: "Suporte Especializado",
      isActive: false,
      attendantCount: 5,
      ruleCount: 2,
      priorityRuleCount: 0,
    },
  ];
  deskQueues.set(builderShortName, queues);
  if (path.endsWith("search"))
    return Response.json({ builderShortName, queues, total: queues.length });
  const queue = queues.find((q) => q.id === body.queueId)!;
  if (path.endsWith("preview")) {
    if (queues.some((q) => q.name.toLowerCase() === body.name.toLowerCase()))
      return Response.json(
        { error: { message: "Já existe uma fila com esse nome." } },
        { status: 409 },
      );
    return Response.json({
      builderShortName,
      queue,
      action: body.action,
      name: body.name,
      revision: "a".repeat(64),
      counts: {
        attendants: queue.attendantCount,
        rules: queue.ruleCount,
        priorityRules: queue.priorityRuleCount,
        tags: 2,
      },
      backup: {
        version: 1,
        queue,
        attendants: [],
        rules: [],
        priorities: [],
        tags: [],
        settings: {},
      },
    });
  }
  const result = { ...queue, name: body.name };
  if (body.action === "duplicate") {
    result.id = crypto.randomUUID();
    result.uniqueId = result.id;
    queues.push(result);
  } else Object.assign(queue, result);
  return Response.json({ builderShortName, status: "success", action: body.action, queue: result });
}

const drafts = new Map<string, InactivityAnalysis>();
let version = 1;
let keyChecks = 0;
let templateCreates = 0;
const sourceReads = { templates: 0, flows: 0 };
function initialDraft(): InactivityAnalysis {
  return {
    revision: "fixture-1",
    totalBlocks: 7,
    eligibleBlocks: 4,
    configuredBlocks: 3,
    blocks: [
      { blockKey: "name", id: "name", title: "Perguntar nome", expiration: "0:10" },
      { blockKey: "date", id: "date", title: "Escolher data", expiration: "00:10:00" },
      {
        blockKey: "confirm",
        id: "confirm",
        title: "Confirmar agendamento e revisar todas as informações fornecidas pelo contato",
        expiration: "0:30",
      },
      { blockKey: "email", id: "email", title: "Solicitar e-mail", expiration: null },
    ],
  };
}
window.fetch = async (input, options) => {
  const path = String(input);
  if (path.startsWith("/api/desk/queues/"))
    return deskFixture(path, JSON.parse(String(options?.body || "{}")));
  let readSource = "";
  if (
    path === "/api/templates/search" ||
    path === "/api/templates/catalog" ||
    path === "/api/flows/search"
  ) {
    const request = JSON.parse(String(options?.body || "{}"));
    readSource = atob(request.sourceRouterKey.slice(4)).split(":")[0];
    const kind = path.includes("templates") ? "templates" : "flows";
    sourceReads[kind]++;
    const parent = window.parent.document;
    parent.querySelector("#fixture-source-reads")!.textContent =
      `Templates: ${sourceReads.templates} · Flows: ${sourceReads.flows} · última busca: ${kind}/${readSource}`;
    const delay = Number(
      (parent.querySelector("#fixture-source-delay") as HTMLSelectElement).value,
    );
    if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
  }
  if (path === "/api/templates/create") {
    const body = JSON.parse(String(options?.body || "{}"));
    const { compileTemplateDraft } = await import("../shared/templateCreation.mjs");
    const compiled = compileTemplateDraft(body.draft);
    if (compiled.errors.length)
      return Response.json({ error: { message: compiled.errors[0].message } }, { status: 400 });
    templateCreates++;
    let counter = window.parent.document.querySelector("#fixture-template-creates");
    if (!counter) {
      counter = window.parent.document.createElement("output");
      counter.id = "fixture-template-creates";
      window.parent.document.body.prepend(counter);
    }
    counter.textContent = `${templateCreates} criações simuladas de template · ${body.draft.name}`;
    return Response.json({
      template: { ...compiled.template, id: "template-ficticio", status: "PENDING" },
      response: {
        id: body.requestId,
        status: "success",
        resource: { id: "template-ficticio", status: "PENDING" },
      },
    });
  }
  if (path === "/api/templates/search" || path === "/api/templates/catalog") {
    const base = { language: "pt_BR", category: "MARKETING", status: "APPROVED" };
    const image = {
      type: "HEADER",
      format: "IMAGE",
      example: { header_handle: [`${location.origin}/fixture-template.svg`] },
    };
    const templates = [
      {
        ...base,
        name: `template_${readSource}`,
        components: [
          image,
          {
            type: "BODY",
            text: "Olá, {{1}}! Conheça nossa *oferta especial* de internet. Aproveite!",
            example: { body_text: [["Ana"]] },
          },
          { type: "FOOTER", text: "Condições no site." },
          {
            type: "BUTTONS",
            buttons: [
              {
                type: "URL",
                text: "Quero contratar",
                url: "https://example.com/oferta?origem=whatsapp&plano=20",
              },
            ],
          },
        ],
      },
      {
        ...base,
        name: `template_${readSource}_copy`,
        components: [{ type: "BODY", text: "Uma cópia já cadastrada neste router." }],
      },
      {
        ...base,
        name: `autenticacao_${readSource}`,
        category: "AUTHENTICATION",
        components: [
          {
            type: "BODY",
            text: "Seu código de verificação é *{{1}}*. Não compartilhe.",
            add_security_recommendation: true,
            example: { body_text: [["123456"]] },
          },
          {
            type: "BUTTONS",
            buttons: [
              {
                type: "URL",
                text: "Copiar código",
                url: "https://www.whatsapp.com/otp/code/?otp_type=COPY_CODE&code=otp{{1}}",
              },
            ],
          },
        ],
      },
      {
        ...base,
        name: `carrossel_${readSource}`,
        components: [
          { type: "BODY", text: "Compare as ofertas e escolha seu plano." },
          {
            type: "CAROUSEL",
            cards: ["600 Mega", "700 Mega", "1 Giga"].map((text) => ({
              components: [
                image,
                { type: "BODY", text: `Plano *${text}* para sua casa.` },
                { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: `Quero ${text}` }] },
              ],
            })),
          },
        ],
      },
      {
        ...base,
        name: `nomeado_${readSource}`,
        category: "UTILITY",
        parameter_format: "NAMED",
        components: [
          {
            type: "HEADER",
            format: "TEXT",
            text: "Pedido {{numero_pedido}}",
            example: {
              header_text_named_params: [{ param_name: "numero_pedido", example: "123" }],
            },
          },
          {
            type: "BODY",
            text: "Olá, {{nome_cliente}}! Seu pedido foi confirmado.",
            example: { body_text_named_params: [{ param_name: "nome_cliente", example: "João" }] },
          },
          {
            type: "BUTTONS",
            buttons: [
              {
                type: "URL",
                text: "Acompanhar",
                url: "https://example.com/pedido/{{id_pedido}}",
                example: ["https://example.com/pedido/123"],
              },
            ],
          },
        ],
      },
      {
        ...base,
        name: `documento_${readSource}`,
        components: [
          {
            type: "HEADER",
            format: "DOCUMENT",
            example: { header_handle: ["https://example.com/comprovante.pdf"] },
          },
          { type: "BODY", text: "Aqui está o documento solicitado." },
        ],
      },
    ];
    return Response.json({
      search: { templateName: "", onlyApproved: false },
      total: templates.length,
      templates,
      complete: true,
    });
  }
  if (path === "/api/routers/whatsapp-number")
    return Response.json({ status: "connected", phoneNumber: "5511999990000" });
  if (path === "/api/flows/public-key") {
    const body = JSON.parse(String(options?.body || "{}"));
    const shortName = atob(body.sourceRouterKey.slice(4)).split(":")[0];
    const parentDocument = window.parent.document;
    const mode = (parentDocument.querySelector("#fixture-public-key") as HTMLSelectElement).value;
    keyChecks++;
    parentDocument.querySelector("#fixture-key-checks")!.textContent =
      `${keyChecks} consultas de public key · ${shortName}@msging.net`;
    if (mode === "error") {
      return Response.json({ error: { message: "Sem permissão (fictício)" } }, { status: 403 });
    }
    return Response.json({
      exists: mode === "present" || (mode === "per-router" && shortName !== "router_sem_chave"),
      signatureStatus: null,
    });
  }
  if (path === "/api/flows/search")
    return Response.json({
      total: 2,
      flows: [
        {
          id: "flow-api",
          name: `Flow API fictício · ${readSource}`,
          status: "DRAFT",
          categories: ["OTHER"],
          isFlowApi: true,
          endpoint_uri: "https://example.test/endpoint",
        },
        {
          id: "flow-common",
          name: `Flow comum fictício · ${readSource}`,
          status: "DRAFT",
          categories: ["OTHER"],
          isFlowApi: false,
        },
      ],
    });
  if (path === "/api/flows/create") {
    const body = JSON.parse(String(options?.body || "{}"));
    return Response.json({
      flow: { id: "new-flow", name: body.name, status: "DRAFT", isFlowApi: body.isFlowApi },
      publicKeyUpload: null,
    });
  }
  if (path === "/api/flows/replicate/progress") {
    const body = JSON.parse(String(options?.body || "{}"));
    const data = {
      totals: {
        foundFlows: body.flows.length,
        targetRouters: body.targetRouterKeys.length,
        createJobs: body.flows.length * body.targetRouterKeys.length,
        copied: body.flows.length * body.targetRouterKeys.length,
        errors: 0,
        publicKeyUploads: body.businessPublicKey ? 1 : 0,
      },
      copied: [],
      errors: [],
      foundFlows: body.flows,
      publicKeyUploads: [],
    };
    return new Response(`${JSON.stringify({ kind: "result", data })}\n`, {
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }
  if (path === "/api/builders/export") {
    const body = JSON.parse(String(options?.body || "{}"));
    if (body.builderShortName === "builder_falha")
      return Response.json(
        { error: { message: "Falha simulada de acesso ao fluxo." } },
        { status: 403 },
      );
    return Response.json({
      builderShortName: body.builderShortName,
      version: body.version,
      document: {
        flow: {
          start: {
            id: "start",
            root: true,
            $title: body.version === "working" ? "Rascunho fictício" : "Publicado fictício",
          },
        },
        configuration: { fixture: true },
        globalActions: { $enteringCustomActions: [], $leavingCustomActions: [] },
      },
    });
  }
  if (path === "/api/builders/publish") {
    const body = JSON.parse(String(options?.body || "{}"));
    window.parent.postMessage(
      { fixturePublication: true, publicationAuthor: body.publicationAuthor },
      location.origin,
    );
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    return Response.json({
      builderShortName: body.builderShortName,
      published: body.builderShortName !== "builder_falha",
      states: 7,
      publicationIndex: 4,
      ...(body.builderShortName === "builder_falha"
        ? {
            error:
              "Publicação não confirmada: falha simulada de permissão. Confira o Builder antes de repetir.",
          }
        : {}),
    });
  }
  if (path === "/api/routers/services")
    return Response.json({
      routerShortName: "router_test",
      template: "master",
      applicationHash: "fixture-router",
      services: ["builder_agendamento", "builder_suporte", "sem_acesso"].map((shortName) => ({
        identity: `${shortName}@msging.net`,
        shortName,
        name: shortName,
        isDefault: false,
        isOnline: true,
      })),
    });
  if (!path.startsWith("/api/inactivity/"))
    return Response.json({ status: "not-connected", phoneNumber: null });
  const body = JSON.parse(String(options?.body || "{}"));
  if (path.endsWith("apply"))
    window.parent.postMessage(
      { fixtureApply: true, published: body.publishAfterSave },
      location.origin,
    );
  const bot = atob(body.builderKey.slice(4)).split(":")[0];
  if (bot === "builder_falha")
    return Response.json(
      { error: { message: "Falha simulada de acesso ao rascunho." } },
      { status: 500 },
    );
  const draft = structuredClone(drafts.get(bot) || initialDraft());
  if (path.endsWith("analyze")) return Response.json(draft);
  let updated = 0;
  let kept = 0;
  for (const block of draft.blocks) {
    if (!body.blockKeys.includes(block.blockKey)) continue;
    if (body.keepExisting && block.expiration) {
      kept++;
      continue;
    }
    const minutes = body.overrides[block.blockKey] ?? body.minutes;
    const expiration = `${Math.floor(minutes / 60)}:${minutes % 60}`;
    if (block.expiration !== expiration) {
      block.expiration = expiration;
      updated++;
    }
  }
  draft.revision = `fixture-${++version}`;
  draft.configuredBlocks = draft.blocks.filter((block) => block.expiration).length;
  drafts.set(bot, draft);
  return Response.json({ ...draft, updated, kept, published: Boolean(body.publishAfterSave) });
};
new Function(themeBootstrap)();
createRoot(document.getElementById("root")!).render(<CreateTemplatesApp />);
