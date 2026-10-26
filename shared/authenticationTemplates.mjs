export function newAuthenticationDraft() {
  return {
    mode: "COPY_CODE",
    addSecurityRecommendation: true,
    codeExpirationMinutes: "5",
    ttlSeconds: "300",
    copyText: "",
    autofillText: "",
    supportedApps: [{ id: "initial-app", packageName: "", signatureHash: "" }],
    zeroTapTermsAccepted: false,
  };
}

export function compileAuthenticationDraft(auth, identity) {
  const errors = [];
  const warnings = [];
  const fail = (field, message) => errors.push({ field: `auth:${field}`, message });
  const value = auth && typeof auth === "object" ? auth : {};
  const mode = value.mode;
  if (!["COPY_CODE", "ONE_TAP", "ZERO_TAP"].includes(mode))
    fail("mode", "Selecione um modo de autenticação.");
  if (typeof value.addSecurityRecommendation !== "boolean")
    fail("security", "Defina se o aviso de segurança será incluído.");
  const components = [
    { type: "BODY", add_security_recommendation: value.addSecurityRecommendation === true },
  ];
  const expiration = value.codeExpirationMinutes;
  const hasExpiration = expiration !== "" && expiration != null;
  if (hasExpiration) {
    if (
      !/^\d+$/.test(String(expiration)) ||
      !Number.isInteger(Number(expiration)) ||
      Number(expiration) < 1 ||
      Number(expiration) > 90
    )
      fail("expiration", "A validade do código deve ser um número inteiro entre 1 e 90 minutos.");
    else components.push({ type: "FOOTER", code_expiration_minutes: Number(expiration) });
  }
  const button = { type: "OTP", otp_type: mode };
  for (const [field, target, label] of [
    ["copyText", "text", "copiar código"],
    ["autofillText", "autofill_text", "preencher código"],
  ]) {
    if (field === "autofillText" && mode === "COPY_CODE") continue;
    const text = typeof value[field] === "string" ? value[field] : "";
    if (text) {
      if (
        !text.trim() ||
        Array.from(text).length > 25 ||
        /[{}\r\n\t]/.test(text) ||
        /\p{Extended_Pictographic}/u.test(text) ||
        /https?:\/\/|www\./i.test(text)
      )
        fail(
          field,
          `O rótulo de ${label} aceita até 25 caracteres, sem variáveis, URLs ou emojis.`,
        );
      button[target] = text;
    }
  }
  if (mode === "ONE_TAP" || mode === "ZERO_TAP") {
    const apps = Array.isArray(value.supportedApps) ? value.supportedApps : [];
    if (apps.length < 1 || apps.length > 5)
      fail("apps", "Cadastre entre 1 e 5 apps Android compatíveis.");
    const seen = new Set();
    button.supported_apps = apps.map((app, index) => {
      const packageName = typeof app?.packageName === "string" ? app.packageName : "";
      const signatureHash = typeof app?.signatureHash === "string" ? app.signatureHash : "";
      if (
        packageName.length > 224 ||
        !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName)
      )
        fail(
          `app:${index}`,
          `App ${index + 1}: o pacote aceita até 224 caracteres; use pelo menos dois segmentos, cada um iniciado por letra, com letras, números e _.`,
        );
      if (!/^[A-Za-z0-9+/=]{11}$/.test(signatureHash))
        fail(
          `app:${index}`,
          `App ${index + 1}: o hash de assinatura precisa ter exatamente 11 caracteres (letras, números, +, / ou =).`,
        );
      const key = `${packageName}:${signatureHash}`;
      if (seen.has(key)) fail(`app:${index}`, "Este par de pacote e hash já foi cadastrado.");
      seen.add(key);
      return { package_name: packageName, signature_hash: signatureHash };
    });
    warnings.push(
      "Um toque e zero-tap exigem integração e handshake no app Android. Se o aparelho ou o app não for elegível, o WhatsApp usa o botão de copiar código.",
    );
  }
  if (mode === "ZERO_TAP") {
    if (value.zeroTapTermsAccepted !== true)
      fail(
        "terms",
        "O responsável precisa aceitar os termos de zero-tap e confirmar que os clientes esperam o preenchimento automático.",
      );
    button.zero_tap_terms_accepted = value.zeroTapTermsAccepted === true;
  }
  components.push({ type: "BUTTONS", buttons: [button] });
  const template = { ...identity, category: "AUTHENTICATION", components };
  const ttl = value.ttlSeconds;
  const hasTtl = ttl !== "" && ttl != null;
  if (hasTtl) {
    const seconds = Number(ttl);
    if (
      !/^-?\d+$/.test(String(ttl)) ||
      !Number.isInteger(seconds) ||
      (seconds !== -1 && (seconds < 30 || seconds > 900))
    )
      fail(
        "ttl",
        "O prazo de entrega deve ser de 30 a 900 segundos. Use -1 somente para a opção de 30 dias permitida pela Meta.",
      );
    else template.message_send_ttl_seconds = seconds;
  }
  const effectiveTtl = hasTtl ? Number(ttl) : 600;
  if (effectiveTtl === -1 || (hasExpiration && effectiveTtl > Number(expiration) * 60))
    warnings.push(
      "O prazo de entrega excede a validade indicada para o código. A Meta recomenda um TTL igual ou menor que a validade do código.",
    );
  warnings.push(
    "O corpo de autenticação é fixo e traduzido pela Meta. URLs, mídia, emojis e conteúdo promocional não são permitidos. O código real, de até 15 caracteres, é informado apenas no envio da mensagem.",
  );
  return { errors, warnings, template };
}

export function authenticationPreview(auth, language, useExamples = true, scenario = "default") {
  const code = useExamples ? "123456" : "{{1}}";
  const minutes = auth.codeExpirationMinutes;
  const lang = language.split("_")[0];
  const dictionaries = {
    pt: {
      body: `*${code}* é seu código de verificação.`,
      security: "Para sua segurança, não compartilhe este código.",
      footer: `Este código expira em ${minutes} minutos.`,
      copy: "Copiar código",
      autofill: "Preencher código",
    },
    en: {
      body: `*${code}* is your verification code.`,
      security: "For your security, do not share this code.",
      footer: `This code expires in ${minutes} minutes.`,
      copy: "Copy code",
      autofill: "Autofill",
    },
    es: {
      body: `Tu código de verificación es *${code}*.`,
      security: "Por tu seguridad, no lo compartas.",
      footer: `Este código caduca en ${minutes} minutos.`,
      copy: "Copiar código",
      autofill: "Autocompletar",
    },
  };
  const strings = dictionaries[lang] || dictionaries.en;
  const copy = auth.mode === "COPY_CODE" || scenario === "copy";
  const hideButton = auth.mode === "ZERO_TAP" && scenario === "default";
  return {
    body: `${strings.body}${auth.addSecurityRecommendation ? ` ${strings.security}` : ""}`,
    footer: minutes ? strings.footer : "",
    button: hideButton
      ? null
      : copy
        ? auth.copyText || strings.copy
        : auth.autofillText || strings.autofill,
    caption: dictionaries[lang]
      ? "Prévia ilustrativa do texto fixo. A Meta define a redação final no idioma selecionado."
      : "Texto ilustrativo em inglês. A Meta gera a mensagem no idioma selecionado.",
  };
}
