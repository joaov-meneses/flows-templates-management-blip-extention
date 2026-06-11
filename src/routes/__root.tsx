import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <main className="root-message-page">
      <section className="root-message-panel">
        <h1>404</h1>
        <h2>Pagina nao encontrada</h2>
        <p>A pagina que voce esta procurando nao existe ou foi movida.</p>
        <div className="root-message-actions">
          <Link to="/" className="root-message-button primary">
            Voltar
          </Link>
        </div>
      </section>
    </main>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <main className="root-message-page">
      <section className="root-message-panel">
        <h1>Esta pagina nao carregou</h1>
        <p>Algo deu errado. Voce pode tentar recarregar ou voltar para a pagina inicial.</p>
        <div className="root-message-actions">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="root-message-button primary"
          >
            Tentar novamente
          </button>
          <a href="/" className="root-message-button secondary">
            Voltar
          </a>
        </div>
      </section>
    </main>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Create Templates - BLiP" },
      { name: "description", content: "Replicacao de templates e flows entre routers BLiP." },
      { property: "og:title", content: "Create Templates - BLiP" },
      {
        property: "og:description",
        content: "Replicacao de templates e flows entre routers BLiP.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
