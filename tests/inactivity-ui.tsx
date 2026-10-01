// The full app and its existing bot picker, with synthetic Portal/API responses only.
import { createRoot } from "react-dom/client";
import CreateTemplatesApp from "../src/components/CreateTemplatesApp";
import type { InactivityAnalysis } from "../src/types/inactivity";
import { themeBootstrap } from "../src/lib/theme";
import "../src/styles.css";

const drafts = new Map<string, InactivityAnalysis>();
let version = 1;
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
  if (!path.startsWith("/api/inactivity/"))
    return Response.json({ status: "not-connected", phoneNumber: null });
  const body = JSON.parse(String(options?.body || "{}"));
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
  return Response.json({ ...draft, updated, kept, published: false });
};
new Function(themeBootstrap)();
createRoot(document.getElementById("root")!).render(<CreateTemplatesApp />);
