function requirePublicationAuthor(value) {
  const email = typeof value === "string" ? value.trim() : "";
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
    const error = new Error(
      "Não foi possível identificar o e-mail do usuário logado no Portal Blip. Reabra a extensão antes de publicar.",
    );
    error.statusCode = 400;
    throw error;
  }
  return { author: email, authorIdentity: email };
}

module.exports = { requirePublicationAuthor };
