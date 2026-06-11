# Create Templates API

Ferramenta para buscar templates de mensagem WhatsApp em um router BLiP e replicá-los em um ou mais routers destino.

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
