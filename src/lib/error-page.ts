import { themeBootstrap } from "./theme";
import errorStyles from "../styles.css?inline";

// Shared theme and styles remain available even when SSR fails.
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>Não foi possível abrir a extensão — Blip</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script>${themeBootstrap}</script>
    <style>${errorStyles}</style>
  </head>
  <body>
    <main class="root-message-page">
      <section class="root-message-panel" role="alert">
        <h1>Não foi possível abrir a extensão</h1>
        <p>A página não terminou de carregar. Verifique sua conexão e tente novamente. Se o problema continuar, abra a extensão novamente pelo Portal Blip.</p>
        <div class="root-message-actions">
          <button class="blip-button primary" onclick="location.reload()">Tentar novamente</button>
          <a class="blip-button secondary" href="/">Voltar ao início</a>
        </div>
      </section>
    </main>
  </body>
</html>`;
}
