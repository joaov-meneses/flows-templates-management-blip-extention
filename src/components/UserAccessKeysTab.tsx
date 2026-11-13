import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Clipboard, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useModalFocus } from "../hooks/useModalFocus";
import { copyText } from "../lib/clipboard";
import { getDirectoryPage } from "../lib/routerDirectory";
import {
  createUserAccessKey,
  getKeyExpiration,
  keyTtlMilliseconds,
  listUserAccessKeys,
  revokeUserAccessKey,
  type UserAccessKey,
} from "../lib/userAccessKeys";
import { Button } from "./ui/Button";
import { EmptyState, Feedback } from "./ui/Feedback";
import "../styles/user-access-keys.css";

type Dialog =
  | { kind: "create" }
  | { kind: "rotate"; oldKey: UserAccessKey }
  | { kind: "delete"; keys: UserAccessKey[] };

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

function formatDate(value?: string) {
  const time = Date.parse(value ?? "");
  return Number.isNaN(time) ? "—" : dateFormat.format(time);
}

function keyLabel(key: UserAccessKey) {
  return key.purpose || key.id;
}

export function UserAccessKeysTab({ embedded }: { embedded: boolean }) {
  const [keys, setKeys] = useState<UserAccessKey[]>([]);
  const [loading, setLoading] = useState(embedded);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [expiration, setExpiration] = useState("all");
  const [sort, setSort] = useState("creationDate");
  const [ascending, setAscending] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set<string>());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [purpose, setPurpose] = useState("");
  const [temporary, setTemporary] = useState(false);
  const [hours, setHours] = useState("");
  const [secret, setSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmRotation, setConfirmRotation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createAttempted, setCreateAttempted] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "warning" } | null>(null);
  const selectAll = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!embedded) return;
    const controller = new AbortController();
    listUserAccessKeys(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setKeys(result);
        setLoaded(true);
        const ids = new Set(result.map((key) => key.id));
        setSelected((current) => new Set([...current].filter((id) => ids.has(id))));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setLoadError("Não foi possível consultar as chaves no Portal.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [embedded, reload]);

  function refresh() {
    setLoading(true);
    setLoadError("");
    setReload((value) => value + 1);
  }

  function openDialog(value: Dialog) {
    setDialog(value);
    setDialogError("");
    setPurpose(value.kind === "rotate" ? value.oldKey.purpose || "" : "");
    setTemporary(false);
    setHours("");
    setSecret("");
    setCopied(false);
    setConfirmRotation(false);
    setCreateAttempted(false);
    setNotice(null);
  }

  function closeDialog() {
    if (busy) return;
    setSecret("");
    setDialog(null);
    if (createAttempted && !secret) refresh();
  }

  useModalFocus(dialog ? "user-access-key" : null, closeDialog);

  const now = Date.now();
  const term = search.trim().toLocaleLowerCase();
  const temporaryCount = keys.filter((key) => key.temporary).length;
  const expiredCount = keys.filter(
    (key) => getKeyExpiration(key.expiration, now) === "expired",
  ).length;
  const visibleKeys = keys
    .filter((key) => {
      if (
        term &&
        ![key.id, key.purpose, key.requirer].some((value) =>
          value?.toLocaleLowerCase().includes(term),
        )
      )
        return false;
      if (type !== "all" && key.temporary !== (type === "temporary")) return false;
      const status = getKeyExpiration(key.expiration, now);
      if (expiration === "active") return status !== "expired";
      return expiration === "all" || expiration === status;
    })
    .sort((left, right) => {
      const dateField = sort === "expiration" ? "expiration" : "creationDate";
      const fallback = dateField === "expiration" ? Infinity : -Infinity;
      const date = (key: UserAccessKey) => {
        const value = Date.parse(key[dateField] ?? "");
        return Number.isNaN(value) ? fallback : value;
      };
      const comparison =
        sort === "purpose"
          ? (left.purpose || "").localeCompare(right.purpose || "", "pt-BR")
          : date(left) - date(right) || 0;
      return (ascending ? comparison : -comparison) || left.id.localeCompare(right.id);
    });
  const directory = getDirectoryPage(visibleKeys, page);
  const selectedKeys = keys.filter((key) => selected.has(key.id));
  const allVisibleSelected =
    visibleKeys.length > 0 && visibleKeys.every((key) => selected.has(key.id));
  const someVisibleSelected = visibleKeys.some((key) => selected.has(key.id));

  useEffect(() => {
    if (selectAll.current)
      selectAll.current.indeterminate = someVisibleSelected && !allVisibleSelected;
  });

  function toggleSelection(items: UserAccessKey[], checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const item of items) {
        if (checked) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || dialog.kind === "delete" || busy || createAttempted) return;
    setDialogError("");
    let ttl: number | undefined;
    try {
      ttl = keyTtlMilliseconds(hours);
    } catch (error) {
      setDialogError((error as Error).message);
      return;
    }
    setBusy(true);
    setCreateAttempted(true);
    try {
      const created = await createUserAccessKey({
        purpose: purpose.trim() || undefined,
        ...(dialog.kind === "create" ? { temporary, ttl } : {}),
      });
      setKeys((current) => [created.key, ...current.filter((key) => key.id !== created.key.id)]);
      setSecret(created.secret);
      setPage(1);
    } catch (error) {
      setDialogError(
        `${(error as Error).message} Feche o diálogo e confira a lista antes de tentar novamente.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function revoke(items: UserAccessKey[]) {
    if (busy) return;
    setBusy(true);
    setDialogError("");
    const revoked = new Set<string>();
    const unconfirmed = new Set<string>();
    for (const key of items) {
      try {
        await revokeUserAccessKey(key.id);
        revoked.add(key.id);
      } catch {
        unconfirmed.add(key.id);
      }
    }
    setKeys((current) => current.filter((key) => !revoked.has(key.id)));
    setSelected((current) => new Set([...current].filter((id) => !revoked.has(id))));
    setSecret("");
    setDialog(null);
    setBusy(false);
    if (unconfirmed.size) {
      setNotice({
        tone: "warning",
        text: `Revogação confirmada para ${revoked.size} de ${items.length} chave(s). Confira a lista atualizada antes de tentar novamente.`,
      });
      refresh();
    } else {
      setNotice({
        tone: "success",
        text:
          dialog?.kind === "rotate"
            ? "Chave rotacionada."
            : items.length === 1
              ? "Chave revogada."
              : `${items.length} chaves revogadas.`,
      });
    }
  }

  async function copy(value: string, isSecret: boolean) {
    try {
      await copyText(value);
      if (isSecret) {
        setCopied(true);
        setDialogError("");
      } else {
        setNotice({ tone: "success", text: "ID copiado." });
      }
    } catch {
      if (isSecret) setDialogError("Selecione o valor da chave e copie manualmente.");
      else setNotice({ tone: "warning", text: "Não foi possível copiar o ID." });
    }
  }

  const canManage = loaded && !loading && !loadError;
  const isRotation = dialog?.kind === "rotate";
  const keysToRevoke =
    dialog?.kind === "delete"
      ? dialog.keys
      : dialog?.kind === "rotate" && confirmRotation
        ? [dialog.oldKey]
        : [];

  if (!embedded) return <EmptyState title="Abra a extensão dentro do Portal Blip" />;

  return (
    <section className="ember-panel user-keys" aria-label="Chaves de acesso do usuário">
      <div className="user-keys-toolbar">
        <Button onClick={refresh} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" /> Atualizar
        </Button>
        <Button
          variant="primary"
          disabled={!canManage}
          onClick={() => openDialog({ kind: "create" })}
        >
          <Plus size={17} aria-hidden="true" /> Criar chave
        </Button>
      </div>

      {notice && (
        <Feedback tone={notice.tone} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Feedback>
      )}
      {loadError && <Feedback>{loadError}</Feedback>}
      {loaded && (
        <>
          <dl className="user-keys-stats">
            {[
              ["Total", keys.length],
              ["Temporárias", temporaryCount],
              ["Permanentes", keys.length - temporaryCount],
              ["Expiradas", expiredCount],
            ].map(([label, count]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>

          <div className="user-keys-filters">
            <label className="blip-native-field">
              Buscar
              <input
                type="search"
                placeholder="ID, finalidade ou solicitante"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label className="blip-native-field">
              Tipo
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">Todos</option>
                <option value="temporary">Temporárias</option>
                <option value="permanent">Permanentes</option>
              </select>
            </label>
            <label className="blip-native-field">
              Expiração
              <select
                value={expiration}
                onChange={(e) => {
                  setExpiration(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">Todas</option>
                <option value="active">Ativas</option>
                <option value="expired">Expiradas</option>
                <option value="expiring-soon">Expiram em até 7 dias</option>
              </select>
            </label>
            <label className="blip-native-field">
              Ordenar por
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  setPage(1);
                }}
              >
                <option value="creationDate">Data de criação</option>
                <option value="expiration">Expiração</option>
                <option value="purpose">Finalidade</option>
              </select>
            </label>
            <Button
              className="icon-only"
              aria-label={ascending ? "Ordenar de forma decrescente" : "Ordenar de forma crescente"}
              title={ascending ? "Ordem crescente" : "Ordem decrescente"}
              onClick={() => {
                setAscending(!ascending);
                setPage(1);
              }}
            >
              {ascending ? (
                <ArrowUp size={17} aria-hidden="true" />
              ) : (
                <ArrowDown size={17} aria-hidden="true" />
              )}
            </Button>
          </div>
        </>
      )}

      {selectedKeys.length > 0 && (
        <div className="selection-bar" role="region" aria-label="Ações da seleção">
          <div className="selection-count">
            <Button
              variant="ghost"
              size="sm"
              className="icon-only"
              aria-label="Limpar seleção"
              onClick={() => setSelected(new Set())}
            >
              <X size={16} aria-hidden="true" />
            </Button>
            <strong>{selectedKeys.length} na seleção</strong>
          </div>
          <Button
            variant="danger"
            disabled={!canManage}
            onClick={() => openDialog({ kind: "delete", keys: selectedKeys })}
          >
            <Trash2 size={16} aria-hidden="true" /> Revogar seleção
          </Button>
        </div>
      )}

      {loading && !loaded && <EmptyState title="Carregando chaves…" loading />}
      {loaded && !visibleKeys.length && (
        <EmptyState
          title={keys.length ? "Nenhuma chave corresponde aos filtros" : "Nenhuma chave de acesso"}
        />
      )}
      {directory.items.length > 0 && (
        <>
          <div className="ember-table-wrap" aria-busy={loading}>
            <table className="ember-table">
              <thead>
                <tr>
                  <th scope="col" className="select-column">
                    <input
                      ref={selectAll}
                      type="checkbox"
                      aria-label="Selecionar todas as chaves filtradas"
                      checked={allVisibleSelected}
                      onChange={(e) => toggleSelection(visibleKeys, e.target.checked)}
                    />
                  </th>
                  <th scope="col">ID</th>
                  <th scope="col">Finalidade</th>
                  <th scope="col">Criada em</th>
                  <th scope="col">Expiração</th>
                  <th scope="col">Solicitante</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Ações</th>
                </tr>
              </thead>
              <tbody>
                {directory.items.map((key) => {
                  const status = getKeyExpiration(key.expiration, now);
                  return (
                    <tr key={key.id} className={selected.has(key.id) ? "selected" : ""}>
                      <td className="select-column">
                        <input
                          type="checkbox"
                          checked={selected.has(key.id)}
                          aria-label={`Selecionar ${keyLabel(key)}`}
                          onChange={(e) => toggleSelection([key], e.target.checked)}
                        />
                      </td>
                      <td>
                        <code title={key.id}>
                          {key.id.length > 12 ? `${key.id.slice(0, 12)}…` : key.id}
                        </code>
                      </td>
                      <td>{key.purpose || "—"}</td>
                      <td>{formatDate(key.creationDate)}</td>
                      <td>
                        {key.expiration ? formatDate(key.expiration) : "Sem expiração"}
                        {status !== "active" && (
                          <span
                            className={`ember-status ${status === "expired" ? "disabled" : "pending"}`}
                          >
                            {status === "expired" ? "Expirada" : "Expira em breve"}
                          </span>
                        )}
                      </td>
                      <td className="user-key-requirer" title={key.requirer}>
                        {key.requirer || "—"}
                      </td>
                      <td>{key.temporary ? "Temporária" : "Permanente"}</td>
                      <td>
                        <div className="table-actions">
                          <Button
                            size="sm"
                            className="icon-only"
                            title="Copiar ID"
                            aria-label={`Copiar ID de ${keyLabel(key)}`}
                            onClick={() => void copy(key.id, false)}
                          >
                            <Clipboard size={15} aria-hidden="true" />
                          </Button>
                          <Button
                            size="sm"
                            className="icon-only"
                            title="Rotacionar chave"
                            aria-label={`Rotacionar ${keyLabel(key)}`}
                            disabled={!canManage}
                            onClick={() => openDialog({ kind: "rotate", oldKey: key })}
                          >
                            <RefreshCw size={15} aria-hidden="true" />
                          </Button>
                          <Button
                            size="sm"
                            className="icon-only"
                            title="Revogar chave"
                            aria-label={`Revogar ${keyLabel(key)}`}
                            disabled={!canManage}
                            onClick={() => openDialog({ kind: "delete", keys: [key] })}
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {directory.totalPages > 1 && (
            <div className="manager-pagination">
              <span>
                {directory.start}–{directory.end} de {directory.total}
              </span>
              <div className="manager-pagination-controls">
                <Button
                  size="sm"
                  disabled={directory.page === 1}
                  onClick={() => setPage(directory.page - 1)}
                >
                  Anterior
                </Button>
                <Button
                  size="sm"
                  disabled={directory.page === directory.totalPages}
                  onClick={() => setPage(directory.page + 1)}
                >
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {dialog && (
        <div className="ember-modal-backdrop">
          <form
            className="ember-modal user-keys-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-keys-dialog-title"
            data-modal-id="user-access-key"
            tabIndex={-1}
            onSubmit={create}
          >
            <div className="ember-modal-header">
              <h2 id="user-keys-dialog-title">
                {isRotation
                  ? "Rotacionar chave"
                  : dialog.kind === "delete"
                    ? "Revogar chaves"
                    : secret
                      ? "Chave criada"
                      : "Criar chave de acesso"}
              </h2>
              <Button
                variant="ghost"
                className="icon-only"
                aria-label="Fechar"
                onClick={closeDialog}
                disabled={busy}
              >
                <X size={18} aria-hidden="true" />
              </Button>
            </div>
            {dialogError && <Feedback>{dialogError}</Feedback>}
            {keysToRevoke.length > 0 ? (
              <Feedback tone="warning">
                {keysToRevoke.length > 1
                  ? `${keysToRevoke.length} chaves serão revogadas.`
                  : `A chave ${keyLabel(keysToRevoke[0])} será revogada.`}{" "}
                As integrações que usam essas credenciais perderão acesso imediatamente.
              </Feedback>
            ) : secret ? (
              <div className="ember-modal-body">
                <Feedback tone="warning">
                  Copie a chave agora. O valor só é exibido nesta etapa.
                </Feedback>
                <div className="user-keys-secret">
                  <label className="blip-native-field">
                    Valor da chave
                    <input
                      readOnly
                      value={secret}
                      autoComplete="off"
                      spellCheck={false}
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                  <Button onClick={() => void copy(secret, true)}>
                    <Clipboard size={16} aria-hidden="true" /> {copied ? "Copiada" : "Copiar chave"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="ember-modal-body">
                {dialog.kind === "rotate" && (
                  <p>
                    Crie uma nova chave para substituir a credencial de {keyLabel(dialog.oldKey)}.
                    Atualize suas integrações antes de revogar a chave antiga.
                  </p>
                )}
                <label className="blip-native-field">
                  Finalidade (opcional)
                  <input
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    disabled={busy || createAttempted}
                    placeholder="Ex.: integração com CRM"
                  />
                </label>
                {dialog.kind === "create" && (
                  <>
                    <label className="user-keys-checkbox">
                      <input
                        type="checkbox"
                        checked={temporary}
                        onChange={(e) => setTemporary(e.target.checked)}
                        disabled={busy || createAttempted}
                      />{" "}
                      Temporária (uso único)
                    </label>
                    <label className="blip-native-field">
                      Prazo de validade em horas (opcional)
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={hours}
                        onChange={(e) => setHours(e.target.value)}
                        disabled={busy || createAttempted}
                        placeholder="Ex.: 24"
                      />
                    </label>
                  </>
                )}
              </div>
            )}
            <div className="ember-modal-footer">
              <Button onClick={closeDialog} disabled={busy}>
                {secret ? (isRotation ? "Manter a chave antiga" : "Concluir") : "Cancelar"}
              </Button>
              {keysToRevoke.length > 0 ? (
                <Button variant="danger" loading={busy} onClick={() => void revoke(keysToRevoke)}>
                  {isRotation ? "Revogar chave antiga e concluir" : "Confirmar revogação"}
                </Button>
              ) : secret ? (
                isRotation && (
                  <Button
                    variant="primary"
                    disabled={!copied}
                    onClick={() => {
                      setConfirmRotation(true);
                      setDialogError("");
                    }}
                  >
                    Avançar
                  </Button>
                )
              ) : (
                <Button type="submit" variant="primary" loading={busy} disabled={createAttempted}>
                  {isRotation ? "Criar nova chave" : "Criar chave"}
                </Button>
              )}
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
