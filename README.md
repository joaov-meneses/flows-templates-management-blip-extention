# Create Templates API

## Interface e componentes

- `src/components/ui`: botões, menus de ações, avisos, estados vazios, status e ações da seleção.
- `src/components/FlowTable.tsx` e `TemplateTable.tsx`: listas adaptadas para desktop e celular.
- `src/styles/tokens.css`: cores e tokens compartilhados dos temas Blip.
- `src/styles/ui.css`: estilos dos componentes globais; `blip-app.css` mantém os layouts específicos.
- `src/hooks/useTheme.ts` e `src/lib/theme.ts`: preferência de tema aplicada antes da primeira pintura, sem depender do acesso ao armazenamento do iframe.
- `src/hooks/useModalFocus.ts`: foco, Escape e rolagem dos diálogos.
- `src/lib/api.ts`: tratamento compartilhado de falhas de rede e respostas inválidas.

Validação local: `npm test`, `npx tsc --noEmit`, `npx eslint src tests --max-warnings 0` e `npm run build`.
Os testes exigem Node 22.6 ou superior. `npm run test:ui` disponibiliza fixtures isoladas em `http://localhost:8081/ui.html` e a tela de falha em `/error.html`. Os dados são fictícios e não alteram routers. A integração real precisa ser validada com a extensão aberta dentro do Portal Blip.

Ferramenta para buscar templates de mensagem WhatsApp em um router BLiP e replicá-los em um ou mais routers destino.

## Publicação em Massa

Em **Clone Bots → Publicação em Massa**, selecione quantos Builders quiser pelo modal existente. O filtro padrão mostra os Builders do roteador; **Todos os Builders com acesso** mostra os demais Builders acessíveis no contrato. Routers e bots sem acesso são excluídos, e **Selecionar todos** respeita o filtro e a busca. A seleção desta aba é independente da clonagem e da inatividade.

**Publicar N bot(s)** abre a confirmação nativa do Portal Blip e publica o rascunho completo de cada bot, com resultado individual. Cancelar não envia comandos de publicação. Falhas em um destino não interrompem os seguintes. Durante a operação, a seleção e a navegação ficam bloqueadas para preservar os destinos confirmados. Os resultados também ficam em Logs.

A API `POST /api/builders/publish` recebe `builderShortName` e `builderKey` e lê `builder_working_flow`, `builder_working_configuration`, `builder_working_global_actions` e o ID do fluxo. Converte o grafo do rascunho em estados executáveis, preservando a ordem das ações antes/depois da entrada, condições, destinos, ações globais, ferramentas locais e a inatividade. Não copia o runtime antigo como se fosse o rascunho novo. Usa a configuração de hosting do próprio Builder e seu cluster; na primeira publicação, busca o template oficial `/templates/builder`. Verifica novamente os documentos antes de ativar o fluxo, confirma o runtime por leitura e registra os documentos publicados e o histórico. O grafo de trabalho permanece intacto; na primeira publicação, registra o ID gerado caso ele esteja ausente.

Blocos de agente IA com mudanças em configurações externas exigem publicação pelo Builder; a API apresenta a falha nesse bot antes de alterar seu runtime. Um bloco de IA inalterado mantém sua representação compilada anterior. Subflows referenciados não são publicados separadamente por esta operação. Uma falha de registro depois da confirmação do runtime informa **Publicado, com aviso**, pois não há transação entre a ativação e os documentos. Se a resposta for incerta, confira o Builder antes de repetir. A validação automatizada e a fixture usam somente bots fictícios; a integração real requer validação no Portal Blip.

A confirmação do runtime, tanto na publicação em massa quanto na publicação automática de inatividade, compara o conteúdo completo do JSON, ignorando apenas sua formatação e a ordem das propriedades. Se a leitura ainda retornar uma versão diferente, faz até cinco consultas, com pausas progressivas que somam 5,5 segundos, sem reenviar o comando de publicação. Se nenhuma leitura confirmar o conteúdo esperado, mantém o resultado como não confirmado e não registra o histórico como sucesso.

Nas novas publicações de Builders (em massa, após salvar inatividade e após criação/clonagem), a extensão consulta `getAccount` do Portal após a confirmação e envia o e-mail atual em `publicationAuthor`. O histórico grava esse e-mail em `author` e `authorIdentity`. Sem um e-mail válido, a operação é interrompida antes de gravar, criar ou publicar bots. Salvamentos sem publicação não exigem essa informação. Registros anteriores permanecem como estavam; a clonagem não atribui a nova publicação ao autor antigo da origem. Chamadas diretas a essas APIs também precisam enviar `publicationAuthor` quando houver publicação.

## Aba Inatividade

Selecione os bots no modal existente de seleção de Builders. A lista usa o contrato atual e as permissões do Portal, excluindo routers (`template: master`). Cada rascunho é analisado separadamente; falhas de acesso aparecem por bot e não impedem a consulta dos demais.

O modal de Builders inicia em **Do roteador** (o roteador de origem selecionado, inicialmente o que abriu a extensão). Ele cruza os serviços retornados por `/api/routers/services` com os Builders acessíveis do contrato. **Todos os Builders com acesso** mostra também os Builders fora desse roteador. **Selecionar todos** marca os Builders exibidos, respeitando o filtro e a busca. Seleções fora do filtro são preservadas e contabilizadas; **Limpar seleção** desmarca todos. O seletor de uma única origem também oferece os dois filtros, mantendo a seleção individual.

A regra é a mesma de `src/app/Features/SetInactivity/index.ts` do Blip Addons 2: percorre os blocos do fluxo, ignora IDs `onboarding`, `fallback` e `error`, considera a **primeira** ação com `input` em `$contentActions` e exige `!input.bypass`. A contagem considera somente esses blocos elegíveis. Os blocos restantes e os demais campos do JSON são preservados.

O resumo mostra quantos bots e blocos têm cada tempo, incluindo os sem inatividade. Um bot pode participar de vários grupos. Clique em um bot para abrir os detalhes e em um tempo para listar os blocos, pesquisar por nome/ID, desmarcar blocos ou preparar tempos individuais. Todos os bots escolhidos e seus blocos elegíveis começam selecionados. Adicionar outro bot à seleção preserva as edições preparadas dos bots que permanecem na lista.

Informe o tempo global em minutos, maior que zero e menor que 1380, como no plugin. A conversão gravada também é a do plugin: `${Math.floor(minutos / 60)}:${minutos % 60}`. Um tempo individual preenchido tem prioridade sobre o global; vazio usa o global. **Manter tempos já preenchidos** preserva qualquer `input.expiration` já preenchido, inclusive quando há um tempo individual preparado.

Por padrão, **Salvar** atualiza exclusivamente `/buckets/blip_portal:builder_working_flow`, sem publicar. A API relê o rascunho antes de gravar e bloqueia a operação se ele mudou desde a análise (HTTP 409). Depois da escrita, uma nova leitura confirma o JSON salvo. Em caso de falha ou resposta incerta, use **Atualizar** no bot para conferir o rascunho antes de repetir; essa ação refaz a seleção de todos os blocos e limpa os tempos individuais desse bot. As gravações são independentes por bot, sem transação entre destinos.

**Publicar automaticamente** vem desmarcado. Ativar a opção exige confirmação pelo alerta nativo do Portal Blip; **Salvar e publicar** exige uma segunda confirmação com os bots e a quantidade de blocos. Cancelar a primeira mantém a opção desmarcada; cancelar a segunda não salva nem publica. Desativar volta ao salvamento de rascunho sem confirmação de publicação.

A publicação automática aplica as expirações ao runtime já compilado do próprio bot, preservando ações, condições e configurações. Exige um fluxo previamente publicado cujo rascunho difira da versão publicada **somente nas expirações elegíveis**; outras mudanças no fluxo, na configuração ou nas ações globais exigem publicação pelo Builder primeiro. Essa restrição evita republicar um runtime antigo como se ele contivesse mudanças que ainda não foram compiladas. Antes de publicar, as versões são conferidas novamente. O fluxo ativo, o documento publicado e o histórico de versões são verificados após cada escrita. A publicação informa resultados separados do salvamento: uma falha não desfaz o rascunho, e uma falha de histórico depois da confirmação do runtime informa que o fluxo está ativo, com aviso de registro. Não há transação entre o runtime e os documentos; se a resposta for incerta, confira o Builder antes de repetir.

`POST /api/inactivity/analyze` recebe `{ "builderKey": "Key ..." }` e retorna revisão, contagens e blocos elegíveis. `POST /api/inactivity/apply` recebe:

```json
{
  "builderKey": "Key ...",
  "revision": "sha256 retornado pela análise",
  "minutes": 10,
  "blockKeys": ["id-do-bloco"],
  "overrides": { "id-do-bloco": 15 },
  "keepExisting": false
}
```

`blockKeys` usa as chaves do objeto do fluxo, retornadas pela análise, mesmo quando diferem de `block.id`. A resposta inclui a análise atualizada, `updated`, `kept` e `published: false`.

Validação visual isolada: `npm run test:ui -- --port 5175` e abra `http://127.0.0.1:5175/inactivity-ui.html`. Essa fixture usa a aplicação completa, com o seletor real e respostas fictícias do Portal e da API; não consulta nem altera bots reais. A integração com os rascunhos reais ainda requer validação dentro do Portal Blip.

## Como rodar

```bash
npm install
npm run build
npm start
```

A interface e a API ficam no mesmo servidor:

```text
http://localhost:3000
```

Para desenvolvimento com reload:

```bash
npm run dev
```

## Endpoints

### `GET /api/health`

Valida se a API está online.

### `POST /api/templates/search`

Busca templates no router de origem. Para buscar sem filtro, envie `templateName` vazio ou omita o campo.

```json
{
  "sourceRouterKey": "Key ...",
  "templateName": "",
  "onlyApproved": false
}
```

### `POST /api/templates/replicate`

Replica os templates selecionados. A interface envia o array `templates` retornado pela busca.
Quando um template tem header `IMAGE` com `example.header_handle`, a API envia o arquivo para cada router de destino em `/message-templates-attachment` e substitui o `header_handle` pelo `fileHandle` retornado antes de criar o template.

```json
{
  "targetRouterKeys": ["Key ..."],
  "templates": [
    {
      "name": "nome_do_template",
      "language": "pt_BR",
      "category": "MARKETING",
      "components": []
    }
  ],
  "dryRun": false,
  "continueOnError": true,
  "onlyApproved": false,
  "batchSize": 15
}
```

### `POST /api/templates/compare`

Compara o router de origem com um ou mais routers de destino e retorna apenas os templates presentes em todos eles, respeitando os filtros de tipo e status. A comparação considera o par `name` + `language`.

```json
{
  "sourceRouterKey": "Key ...",
  "targetRouterKeys": ["Key ..."],
  "category": "UTILITY",
  "status": "APPROVED"
}
```

### `POST /api/flows/search`

Carrega todos os flows do router de origem. O filtro por nome ou ID é feito na interface.

```json
{
  "sourceRouterKey": "Key ..."
}
```

### `POST /api/flows/preview`

Busca os detalhes do flow e retorna o `preview.preview_url`.

```json
{
  "sourceRouterKey": "Key ...",
  "flowId": "837945982408597"
}
```

### `POST /api/flows/json`

Busca os assets do flow, baixa o `download_url` do `FLOW_JSON` e retorna o JSON completo.

```json
{
  "sourceRouterKey": "Key ...",
  "flowId": "837945982408597"
}
```

### `POST /api/flows/create`

Cria um flow no router de origem e envia o JSON completo. Este endpoint não publica o flow.

```json
{
  "sourceRouterKey": "Key ...",
  "name": "Novo flow",
  "isFlowApi": true,
  "endpointUri": "https://example.com/flow-interactions",
  "flowJson": {
    "version": "7.3",
    "screens": []
  }
}
```

### `POST /api/flows/publish`

Publica um flow existente no router de origem.

```json
{
  "sourceRouterKey": "Key ...",
  "flowId": "837945982408597"
}
```

### `POST /api/flows/replicate`

Envia a public key uma vez por router de destino, cria o flow, envia o JSON completo para o novo ID e publica o flow.

```json
{
  "sourceRouterKey": "Key ...",
  "targetRouterKeys": ["Key ..."],
  "flows": [
    {
      "id": "837945982408597",
      "name": "Pede CPF e E-mail Portabilidade v3"
    }
  ],
  "continueOnError": true,
  "batchSize": 15
}
```

Também é possível replicar por nomes, deixando a API buscar os templates antes de criar:

```json
{
  "sourceRouterKey": "Key ...",
  "templateNames": ["nome_do_template"],
  "targetRouterKeys": ["Key ..."],
  "dryRun": false,
  "continueOnError": true,
  "onlyApproved": false,
  "batchSize": 15
}
```
