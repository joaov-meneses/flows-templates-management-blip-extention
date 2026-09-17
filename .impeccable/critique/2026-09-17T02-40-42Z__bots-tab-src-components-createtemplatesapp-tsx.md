---
target: Bots tab (src/components/CreateTemplatesApp.tsx)
total_score: 18
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\Jeoston Araujo\\source\\repos\\Pessoal\\flows-templates-management-blip-extention\\Bots tab (src\\components\\CreateTemplatesApp.tsx)"
timestamp: 2026-09-17T02-40-42Z
slug: bots-tab-src-components-createtemplatesapp-tsx
---
Method: dual-agent (A: a91cb442fe0036848 · B: a3784f2bc5c5d5b4c)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 1 | Lookup de identidade e revelação escalonada dos cards não comunicam status real (ver P1/P2 abaixo) |
| 2 | Match System / Real World | 3 | Rótulos e nomenclatura BLiP nativos, claros |
| 3 | User Control and Freedom | 1 | Nenhum dry-run/confirmação antes de uma clonagem que pode remover dados no destino |
| 4 | Consistency and Standards | 2 | Quebra o próprio padrão de confirmação que o app usa em outro fluxo (plugins) |
| 5 | Error Prevention | 1 | Sem validação de formato da key, sem aviso de sobrescrita/remoção antes de agir |
| 6 | Recognition Rather Than Recall | 3 | Opções sempre visíveis, mas efeitos colaterais (ex.: criação de filas) só aparecem depois de rodar |
| 7 | Flexibility and Efficiency | 1 | Sem "selecionar tudo", sem agrupamento Builder×Desk nas 8 opções |
| 8 | Aesthetic and Minimalist Design | 3 | Tela enxuta, sem ruído visual |
| 9 | Error Recovery | 1 | JSON cru da API exposto sem orientação; banner de erro desconectado do campo culpado |
| 10 | Help and Documentation | 2 | Texto de apoio cobre "o quê", não "e se eu errar a key"/"isso sobrescreve o destino?" |
| **Total** | | **18/40** | **Poor — melhorias importantes necessárias antes de liberar para uso mais amplo** |

## Design Specificity Verdict

**Avaliação (LLM)**: A tela é funcionalmente específica — as 8 opções (Fluxo, Filas, Regras de atendimento/priorização, Atendentes, Respostas prontas, Tags, Variáveis) e as duas Bot Keys mostram entendimento real do domínio BLiP. Mas a casca visual (dois inputs lado a lado, grid de checkboxes genérico, botão primário, lista de alertas) é indistinguível de qualquer form CRUD admin. Nada na tela sinaliza que essa é a operação de maior risco da aba — ela pode **remover** regras/filas no bot de destino que não existem na origem, e isso não é comunicado.

**Scan determinístico**: `detect.mjs --json` retornou `0` achados estáticos no arquivo inteiro (5134 linhas) e no CSS — controle positivo confirmou que o detector funciona corretamente em `.tsx`, então o zero é um verdadeiro negativo. Isso é esperado: os problemas reais aqui são de fluxo/interação (falta de confirmação, erro cru, feedback silencioso), categorias que um scanner de padrões estáticos não detecta.

**Overlays visuais**: a injeção funcionou (live-server + detect.js). Achado único do motor de navegador: `line-length` no parágrafo de descrição do card "Clonar Bot" (`src/components/CreateTemplatesApp.tsx:3687`), ~137–140 caracteres por linha — confirma, com medição real de runtime, a observação qualitativa da Avaliação A de que esse texto é longo demais para uma frase corrida e quebra sem hierarquia em telas estreitas. Bom ponto de concordância entre as duas avaliações.

**Nota de metodologia**: a Avaliação B reportou encontrar os campos já preenchidos e um resultado de clonagem já na tela ao abrir sua própria aba — sinal de que as duas avaliações, apesar de isoladas, acabaram batendo no mesmo servidor de dev local ao mesmo tempo. Por causa disso, descartei da síntese uma afirmação da Avaliação B ("o lookup de identidade só dispara no submit, não por digitação") que contradiz o código-fonte revisado diretamente (`useEffect` com debounce de 300ms nas linhas ~2619–2653) — trato isso como ruído de contaminação de sessão, não como achado válido.

## Overall Impression

A tarefa central (colar duas keys, marcar o que clonar, clonar) é imediatamente compreensível. O problema não é complexidade — é que a tela trata uma operação potencialmente destrutiva (pode apagar configuração existente no bot de destino) com a mesma leveza visual e de fluxo de uma busca somente-leitura. A maior oportunidade aqui é adicionar uma camada de segurança/confirmação proporcional ao risco real da ação, e traduzir os erros crus da API Blip em orientação acionável.

## What's Working

1. **Cards de resultado por etapa são informativos**: em vez de sucesso/falha genérico, cada etapa relata métricas granulares (ex.: "3 criada(s), 1 atualizada(s), 0 inalterada(s), 2 removida(s)") — bom para um público técnico que precisa auditar o que aconteceu.
2. **Persistência dos valores após erro de validação**: o usuário não precisa redigitar as duas Bot Keys se esquecer de marcar uma opção — reduz atrito de retry.
3. **Escopo enxuto**: a tela não tenta fazer mais do que precisa; nenhum elemento decorativo compete por atenção.

## Priority Issues

- **[P1] Nenhuma confirmação antes de uma operação que remove dados no bot de destino**
  **Por que importa**: `describeBotCloneStep` para `attendanceRules`/`priorityRules` relata itens "removida(s)" — o espelho idempotente apaga do destino o que não existe na origem. Isso roda com um clique só, sem preview/dry-run, e é inconsistente com o padrão que o próprio app já usa (confirmação antes de sobrescrever plugins duplicados). Trocar origem/destino por engano, ou clonar contra o bot errado, apaga configuração de produção sem aviso.
  **Fix**: antes do submit real, mostrar um resumo do que vai ser criado/atualizado/**removido** no destino (mesmo que aproximado) e pedir confirmação explícita quando houver remoções previstas — reaproveitando o padrão `confirmFlowAction`/modal já usado em outras abas.
  **Suggested command**: `/impeccable harden`

- **[P1] Erros da API Blip aparecem como JSON cru, sem orientação**
  **Por que importa**: confirmado ao vivo — `Erro HTTP 401: { "code": 13, "description": "Invalid authorization header" }` é mostrado verbatim no card. Causa raiz: em `server/botCloneService.cjs`, `postCommand` só extrai `reason.description` humano quando a Blip responde 200 com `{status:"failure"}`; quando a falha é em nível HTTP (como um 401 de key inválida), ele despeja o corpo JSON cru na mensagem. Isso também faz o endpoint devolver HTTP 500 para uma falha de autenticação, então o mapeamento de mensagens amigáveis do `postJson` (que trata 401/403/429 especialmente) nunca entra em ação aqui.
  **Fix**: no branch `!response.ok` de `postCommand`, tentar extrair `responseBody?.reason?.description` antes de cair no dump JSON; considerar mapear falhas de autenticação da Blip para uma mensagem fixa tipo "Bot key inválida ou sem permissão — confira se copiou a key correta."
  **Suggested command**: `/impeccable clarify`

- **[P1] Falha na busca de identidade do bot é engolida em silêncio**
  **Por que importa**: `lookupBotIdentity` tem um `catch { return ""; }` — se a key for inválida ou a chamada falhar, o hint "Id: ..." simplesmente nunca aparece, indistinguível de "ainda não terminei de digitar". Essa dica existe justamente para dar ao usuário confirmação visual de que colou a key certa antes de disparar uma clonagem que pode ser destrutiva; falhar em silêncio anula o propósito da feature.
  **Fix**: distinguir "carregando" (indicador sutil enquanto a chamada está em voo) de "não foi possível verificar essa key" (texto curto, tom neutro) de "Id: X" (sucesso) — os três estados hoje colapsam num só ("nada aparece").
  **Suggested command**: `/impeccable clarify`

- **[P2] Erro de validação de campo aparece desconectado do campo culpado**
  **Por que importa**: "Informe a bot key de destino." aparece num banner genérico no topo da página, sem destacar/focar o input real, e não some sozinho quando o usuário corrige o campo — fica "preso" até o próximo submit ou dismiss manual.
  **Fix**: ligar a validação inline ao campo (borda de erro + foco automático) além do banner, e limpar o erro assim que o campo for preenchido.
  **Suggested command**: `/impeccable clarify`

- **[P2] Revelação escalonada dos resultados (500ms/card) cria uma contradição de status, e não é anunciada a leitores de tela**
  **Por que importa**: o servidor já respondeu tudo de uma vez quando o `setInterval` começa a revelar os cards um a um — o botão "Clonar bot" já saiu do estado de loading antes dos cards terminarem de aparecer, dando a impressão de trabalho em andamento onde não há mais nada acontecendo. Além disso, os cards individuais não estão numa região `aria-live` (só o banner-resumo do topo tem), então um usuário de leitor de tela não é avisado quando cada card de erro aparece.
  **Fix**: ou remover o delay artificial (mostrar tudo de uma vez, já que é isso que realmente aconteceu), ou, se o efeito visual for intencional, envolver a lista em `aria-live="polite"` para acompanhar o banner-resumo.
  **Suggested command**: `/impeccable polish`

- **[P3] Sem "selecionar tudo" e sem agrupamento Builder×Desk nas 8 opções de clonagem**
  **Por que importa**: as 8 opções misturam dois subsistemas BLiP conceitualmente distintos (Builder: Fluxo/Variáveis; Desk: Filas, Regras, Atendentes, Tags, Respostas) numa grade plana única, e um usuário que sempre clona "tudo" precisa marcar 8 caixas manualmente toda vez.
  **Fix**: subtítulos de grupo ("Builder" / "Desk") + um toggle "selecionar tudo".
  **Suggested command**: `/impeccable layout`

## Persona Red Flags

**Alex (Power User)**: roda essa ferramenta repetidamente entre ambientes. A ausência de "selecionar tudo", de atalho de teclado para submit, e a falta de feedback confiável no lookup de identidade (que existe justamente para ele confirmar visualmente a key antes de agir) tornam o fluxo mais lento do que precisa ser pra um uso frequente.

**Riley (Stress Tester)**: este é o red flag mais forte da tela inteira. Uma Bot Key trocada por engano entre origem e destino, e a operação prossegue sem nenhum "você está prestes a sobrescrever/remover dados em X, confirma?" — sem dry-run, sem dupla confirmação, apesar de a própria lógica interna (`describeBotCloneStep`) já ter a noção de "removida(s)".

**Sam (Acessibilidade)**: os cards de resultado por etapa não estão em região `aria-live` — um usuário de leitor de tela ouve só o resumo final ("2 com erro") e precisa navegar manualmente pra descobrir qual etapa falhou e por quê, 500ms depois de cada uma aparecer silenciosamente.

## Minor Observations

- Parágrafo de descrição do card "Clonar Bot" excede ~137-140 caracteres por linha (confirmado por medição de runtime do detector) — quebra sem hierarquia em telas estreitas.
- Os dois campos de Bot Key são `<input>` de texto simples exibindo a chave de autorização crua na tela, sem toggle de visibilidade — aceitável numa ferramenta interna, mas vale considerar já que são credenciais sensíveis.
- Nenhum `autoComplete` definido nos inputs de Bot Key.
- Endpoint `/api/bots/identity` devolve HTTP 500 para uma falha de autenticação da Blip (deveria refletir algo mais próximo de 400/401) — observação de backend, não estritamente de UI, mas alimenta o P1 do erro cru acima.

## Questions to Consider

- Se um dev colar a Bot Key errada no campo "origem" e a de destino no campo "origem" por engano, o que impede hoje que ele sobrescreva/apague dados do bot errado com um clique?
- O hint "Id: `<identidade>`" foi pensado como confirmação visual antes de uma ação de risco — por que essa confirmação desaparece em silêncio quando a verificação falha, em vez de dizer "não foi possível verificar essa key"?
- Os cards de resultado precisam mesmo aparecer em cascata de 500ms quando o servidor já respondeu tudo de uma vez — isso serve ao usuário ou só à estética?
