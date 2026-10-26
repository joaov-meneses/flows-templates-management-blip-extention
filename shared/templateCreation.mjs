import { compileAuthenticationDraft, newAuthenticationDraft } from "./authenticationTemplates.mjs";
// Meta template components / fundamentals / review, consulted 2026-10-26.
export const TEMPLATE_LANGUAGES = Object.freeze([
  ["pt_BR", "Português (Brasil)"],
  ["pt_PT", "Português (Portugal)"],
  ["en_US", "Inglês (EUA)"],
  ["en_GB", "Inglês (Reino Unido)"],
  ["es", "Espanhol"],
  ..."af sq ar ar_EG ar_AE ar_LB ar_MA ar_QA az be_BY bn bn_IN bg ca zh_CN zh_HK zh_TW hr cs da prs_AF nl nl_BE en en_AE en_AU en_CA en_GH en_IE en_IN en_JM en_MY en_NZ en_QA en_SG en_UG en_ZA et fil fi fr fr_BE fr_CA fr_CH fr_CI fr_MA ka de de_AT de_CH el gu ha he hi hu id ga it ja kn kk rw_RW ko ky_KG lo lv lt mk ms ml mr nb ps_AF fa pl pa ro ru sr si_LK sk sl es_AR es_CL es_CO es_CR es_DO es_EC es_HN es_MX es_PA es_PE es_ES es_UY sw sv ta te th tr uk ur uz vi zu"
    .split(" ")
    .map((code) => [code, code]),
]);
export const countCharacters = (value) => Array.from(value || "").length;
export const variableNames = (text) => [
  ...new Set(Array.from(String(text || "").matchAll(/\{\{([^{}]+)\}\}/g), (match) => match[1])),
];
export function newTemplateDraft() {
  return {
    name: "",
    language: "pt_BR",
    category: "UTILITY",
    parameterFormat: "POSITIONAL",
    headerFormat: "NONE",
    headerText: "",
    mediaHandle: "",
    body: "",
    footer: "",
    examples: {},
    buttons: [],
    authentication: newAuthenticationDraft(),
  };
}

export function compileTemplateDraft(draft) {
  const errors = [];
  const warnings = [];
  const fail = (field, message) => errors.push({ field, message });
  const text = (key) => (typeof draft?.[key] === "string" ? draft[key] : "");
  const examples = draft?.examples && typeof draft.examples === "object" ? draft.examples : {};
  const name = text("name");
  const language = text("language");
  const category = text("category");
  const parameterFormat = text("parameterFormat");
  const headerFormat = text("headerFormat");
  const body = text("body");
  const headerText = text("headerText");
  const footer = text("footer");
  const components = [];
  if (!/^[a-z0-9_]{1,512}$/.test(name))
    fail("name", "Use de 1 a 512 letras minúsculas sem acentos, números ou _.");
  if (!TEMPLATE_LANGUAGES.some(([code]) => code === language))
    fail("language", "Selecione um idioma aceito pela Meta.");
  if (!["UTILITY", "MARKETING", "AUTHENTICATION"].includes(category))
    fail("category", "Selecione Utilidade, Marketing ou Autenticação.");
  if (category === "AUTHENTICATION") {
    const auth = compileAuthenticationDraft(draft?.authentication, { name, language });
    return {
      errors: [...errors, ...auth.errors],
      warnings: auth.warnings,
      template: auth.template,
    };
  }
  if (!["POSITIONAL", "NAMED"].includes(parameterFormat))
    fail("parameterFormat", "Selecione o formato das variáveis.");
  if (!["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT", "LOCATION"].includes(headerFormat))
    fail("headerFormat", "Tipo de cabeçalho inválido.");

  function checkVariables(value, field, max = Infinity) {
    const names = variableNames(value);
    if (/[{}]/.test(value.replace(/\{\{[^{}]+\}\}/g, "")))
      fail(field, "Variável incompleta: use duas chaves de cada lado, como {{1}}.");
    if (names.length > max) fail(field, `Este componente aceita no máximo ${max} variável.`);
    if (parameterFormat === "NAMED") {
      if (names.some((param) => !/^[a-z_]+$/.test(param)))
        fail(
          field,
          "Variáveis nomeadas aceitam somente letras minúsculas e _. Ex.: {{nome_cliente}}.",
        );
    } else if (names.some((param, index) => param !== String(index + 1))) {
      fail(
        field,
        "Numere as variáveis em ordem, sem saltos, começando por {{1}} em cada componente.",
      );
    }
    for (const param of names) {
      const sample = examples[`${field}:${param}`];
      if (typeof sample !== "string" || !sample.trim())
        fail(
          `${field}:${param}`,
          `Informe um exemplo para {{${param}}} em ${field === "body" ? "corpo" : "cabeçalho"}.`,
        );
      else if (/[{}\r\n\t]/.test(sample))
        fail(`${field}:${param}`, "O exemplo deve ser um valor real em uma linha, sem chaves.");
    }
    return names;
  }
  function componentExample(field, names) {
    if (!names.length) return {};
    const prefix = field === "body" ? "body_text" : "header_text";
    return {
      example:
        parameterFormat === "NAMED"
          ? {
              [`${prefix}_named_params`]: names.map((param) => ({
                param_name: param,
                example: examples[`${field}:${param}`],
              })),
            }
          : {
              [prefix]:
                field === "body"
                  ? [names.map((param) => examples[`${field}:${param}`])]
                  : names.map((param) => examples[`${field}:${param}`]),
            },
    };
  }

  if (headerFormat === "TEXT") {
    if (!headerText.trim() || countCharacters(headerText) > 60)
      fail("headerText", "O cabeçalho precisa ter de 1 a 60 caracteres.");
    const headerWithoutParams = headerText.replace(/\{\{[^{}]+\}\}/g, "");
    if (/[\r\n\t*_~`]/.test(headerWithoutParams))
      fail("headerText", "O cabeçalho deve ser texto simples, sem Markdown ou quebras de linha.");
    const names = checkVariables(headerText, "headerText", 1);
    const expandedHeader = headerText.replace(
      /\{\{([^{}]+)\}\}/g,
      (match, param) => examples[`headerText:${param}`] || match,
    );
    if (countCharacters(expandedHeader) > 60)
      fail("headerText", "O cabeçalho com o exemplo também ultrapassa 60 caracteres.");
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: headerText,
      ...componentExample("headerText", names),
    });
  } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat)) {
    const handle = text("mediaHandle").trim();
    if (!handle || /^https?:\/\//i.test(handle) || /\s/.test(handle))
      fail("mediaHandle", "Informe o handle da mídia já enviada à Meta. Uma URL não é um handle.");
    components.push({ type: "HEADER", format: headerFormat, example: { header_handle: [handle] } });
  } else if (headerFormat === "LOCATION") components.push({ type: "HEADER", format: "LOCATION" });

  if (!body.trim() || countCharacters(body) > 1024)
    fail("body", "O corpo precisa ter de 1 a 1.024 caracteres.");
  const bodyNames = checkVariables(body, "body");
  if (/^\s*\{\{/.test(body) || /\}\}\s*$/.test(body))
    fail("body", "O corpo não pode começar nem terminar com uma variável. Acrescente texto fixo.");
  if (/\}\}\s*\{\{/.test(body))
    fail("body", "Separe variáveis com texto que explique cada informação.");
  const expandedBody = body.replace(
    /\{\{([^{}]+)\}\}/g,
    (match, param) => examples[`body:${param}`] || match,
  );
  if (countCharacters(expandedBody) > 1024)
    fail("body", "O corpo com os exemplos também ultrapassa 1.024 caracteres.");
  components.push({ type: "BODY", text: body, ...componentExample("body", bodyNames) });
  if (footer) {
    if (countCharacters(footer) > 60) fail("footer", "O rodapé aceita até 60 caracteres.");
    if (/[{}\r\n\t*_~`]/.test(footer))
      fail(
        "footer",
        "O rodapé deve ser texto simples, sem variáveis, Markdown ou quebras de linha.",
      );
    components.push({ type: "FOOTER", text: footer });
  }
  const buttons = Array.isArray(draft?.buttons) ? draft.buttons : [];
  if (buttons.length > 10) fail("buttons", "O template aceita no máximo 10 botões.");
  for (const [type, max] of [
    ["URL", 2],
    ["PHONE_NUMBER", 1],
    ["COPY_CODE", 1],
  ]) {
    if (buttons.filter((button) => button?.type === type).length > max)
      fail("buttons", `Limite de ${max} botão(ões) do tipo ${type}.`);
  }
  const compiledButtons = [];
  const labels = new Set();
  buttons.forEach((button, index) => {
    const field = `button:${index}`;
    if (!button || !["URL", "PHONE_NUMBER", "COPY_CODE", "QUICK_REPLY"].includes(button.type)) {
      fail(field, "Tipo de botão inválido.");
      return;
    }
    if (button.type === "COPY_CODE") {
      if (
        typeof button.example !== "string" ||
        !button.example.trim() ||
        countCharacters(button.example) > 20
      )
        fail(field, "O código de exemplo precisa ter de 1 a 20 caracteres.");
      compiledButtons.push({ type: "COPY_CODE", example: button.example });
      return;
    }
    const label = typeof button.text === "string" ? button.text : "";
    if (!label.trim() || countCharacters(label) > 25 || /[{}\r\n\t]/.test(label))
      fail(field, "O rótulo precisa ter de 1 a 25 caracteres, sem variáveis ou quebras de linha.");
    if (labels.has(label.trim().toLocaleLowerCase()))
      fail(field, "Use rótulos diferentes para os botões.");
    labels.add(label.trim().toLocaleLowerCase());
    const result = { type: button.type, text: label };
    if (button.type === "PHONE_NUMBER") {
      const number = typeof button.phoneNumber === "string" ? button.phoneNumber : "";
      if (!/^\+?[1-9][0-9]{5,19}$/.test(number) || countCharacters(number) > 20)
        fail(field, "Informe telefone com DDI, somente dígitos e + opcional, até 20 caracteres.");
      result.phone_number = number;
    }
    if (button.type === "URL") {
      const url = typeof button.url === "string" ? button.url : "";
      const names = variableNames(url);
      const validName = parameterFormat === "NAMED" ? /^[a-z_]+$/ : /^1$/;
      if (
        /[{}]/.test(url.replace(/\{\{[^{}]+\}\}/g, "")) ||
        names.length > 1 ||
        names.some((param) => !validName.test(param)) ||
        (names.length && !url.endsWith(`{{${names[0]}}}`))
      )
        fail(
          field,
          "A URL aceita uma variável, somente no final; use {{1}} ou um nome conforme o formato selecionado.",
        );
      if (
        names.length &&
        (typeof button.example !== "string" ||
          !button.example.trim() ||
          /[{}\s]/.test(button.example))
      )
        fail(
          field,
          "Informe um sufixo de exemplo para a URL, codificando espaços e caracteres especiais.",
        );
      const rendered = url.replace(/\{\{[^{}]+\}\}/g, button.example || "exemplo");
      try {
        const parsed = new URL(rendered);
        if (
          !["https:", "http:"].includes(parsed.protocol) ||
          !parsed.hostname.includes(".") ||
          parsed.username ||
          parsed.password ||
          /\s/.test(rendered)
        )
          throw new Error();
      } catch {
        fail(field, "Informe uma URL pública válida começando com https:// ou http://.");
      }
      if (countCharacters(url) > 2000 || countCharacters(rendered) > 2000)
        fail(field, "A URL aceita até 2.000 caracteres, inclusive com o exemplo.");
      result.url = url;
      if (names.length) result.example = [button.example];
    }
    compiledButtons.push(result);
  });
  // Meta requires quick replies and other buttons to form contiguous groups.
  compiledButtons.sort(
    (a, b) => Number(a.type === "QUICK_REPLY") - Number(b.type === "QUICK_REPLY"),
  );
  if (compiledButtons.length) components.push({ type: "BUTTONS", buttons: compiledButtons });
  if (
    buttons.length > 3 ||
    (buttons.some((b) => b?.type === "QUICK_REPLY") &&
      buttons.some((b) => b?.type !== "QUICK_REPLY"))
  )
    warnings.push(
      "No WhatsApp para computador, esta combinação de botões pode exigir abrir a mensagem no celular. Com mais de 3 botões, o WhatsApp mostra “Ver todas as opções”.",
    );
  if (bodyNames.length)
    warnings.push(
      "Use texto fixo suficiente para contextualizar as variáveis. A Meta também analisa a proporção de variáveis e o conteúdo dos exemplos.",
    );
  if (category === "UTILITY")
    warnings.push(
      "Utilidade deve responder a uma ação ou solicitação da pessoa. Ofertas ou conteúdo promocional podem mudar a categoria para Marketing.",
    );
  return {
    errors,
    warnings,
    template: { name, language, category, parameter_format: parameterFormat, components },
  };
}
