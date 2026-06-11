import { createFileRoute } from "@tanstack/react-router";
import CreateTemplatesApp from "@/components/CreateTemplatesApp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Create Templates - BLiP" },
      { name: "description", content: "Replicacao de templates e flows entre routers BLiP." },
      { property: "og:title", content: "Create Templates - BLiP" },
      {
        property: "og:description",
        content: "Replicacao de templates e flows entre routers BLiP.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return <CreateTemplatesApp />;
}
