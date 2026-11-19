import { useEffect, useState, type FormEvent } from "react";
import { Icon, LogoMark } from "./Icon";
import { MountainArt } from "./MountainArt";
import { createExternalSession } from "../lib/accounts";

export type Session = {
  username: string;
  email: string;
  remember: boolean;
  token?: string;
  accountId?: string;
  uuid?: string;
  sessionid?: string;
  license?: string;
  free?: boolean;
  /** Momento (epoch ms) en que expira la clave (segun pwfauth). */
  expiresAt?: number;
  /** Dias restantes segun pwfauth. */
  daysRemaining?: number | null;
  /** Clave de por vida (sin expiracion). */
  isLifetime?: boolean;
};

type KeyAuthApi = {
  config: () => Promise<{ name: string; ownerid: string }>;
  login: (license: string) => Promise<{ ok: boolean; message: string; username?: string; sessionid?: string; subscription?: string; daysRemaining?: number | null; expiresAt?: number | null; isLifetime?: boolean }>;
  openDashboard: () => Promise<unknown>;
};

export function Login({
  onLogin,
  background,
  playerName,
  onPlayerName,
}: {
  onLogin: (session: Session) => void;
  background?: string;
  playerName: string;
  onPlayerName: (name: string) => void;
}) {
  const api = (window as unknown as { keyauth?: KeyAuthApi }).keyauth;
  const [license, setLicense] = useState("");
  const [remember, setRemember] = useState(true);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState(true);

  useEffect(() => {
    api?.config().then((config) => setConfigured(!!config?.name && !!config?.ownerid)).catch(() => setConfigured(false));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!api) {
      setError("La validación de claves requiere la app de escritorio.");
      return;
    }
    const key = license.trim();
    if (!key) {
      setError("Escribe tu clave de acceso.");
      return;
    }
    setLoading(true);
    try {
      const result = await api.login(key);
      if (!result.ok) {
        setError(result.message || "Clave no válida.");
        setLoading(false);
        return;
      }
      const name = playerName.trim() || "ShealPlayer";
      onPlayerName(name);
      const account = createExternalSession(name, key);
      onLogin({
        username: account.username,
        email: account.email,
        remember,
        token: key,
        accountId: account.id,
        uuid: account.uuid,
        sessionid: result.sessionid,
        license: key,
        // Expiracion y dias reales segun pwfauth.
        expiresAt: result.expiresAt && result.expiresAt > Date.now() ? result.expiresAt : undefined,
        daysRemaining: result.daysRemaining,
        isLifetime: result.isLifetime,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al validar la clave.");
      setLoading(false);
    }
  };

  const enterFree = () => {
    const name = playerName.trim() || "ShealPlayer";
    onPlayerName(name);
    const account = createExternalSession(name, "free");
    onLogin({
      username: name,
      email: account.email,
      remember: true,
      token: "free",
      accountId: account.id,
      uuid: account.uuid,
      free: true,
    });
  };

  return (
    <div className="login-screen">
      <MountainArt variant="login" image={background} />
      <div className="login-glow login-glow-a" />
      <div className="login-glow login-glow-b" />

      <div className="login-card">
        <div className="login-brand">
          <span className="login-brand-mark"><LogoMark size={30} /></span>
          <span className="login-brand-text">
            <strong>SHEAL</strong>
            <small>LAUNCHER</small>
          </span>
        </div>

        <div className="login-heading">
          <span className="eyebrow"><i /> Acceso por clave</span>
          <h1>Bienvenido de nuevo</h1>
          <p>Introduce tu clave de KeyAuth para entrar.</p>
        </div>

        <form onSubmit={submit} noValidate>
          <label className="field">
            <span>Clave de acceso</span>
            <div className="field-input">
              <Icon name="key" size={16} />
              <input
                type={showKey ? "text" : "password"}
                value={license}
                onChange={(e) => { setLicense(e.target.value); setError(""); }}
                placeholder="XXXXXX-XXXXXX-XXXXXX"
                autoComplete="off"
                autoFocus
              />
              <button
                type="button"
                className="field-eye"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? "Ocultar clave" : "Mostrar clave"}
              >
                <Icon name={showKey ? "eyeOff" : "eye"} size={16} />
              </button>
            </div>
          </label>

          <label className="field">
            <span>Nombre de tu personaje (Minecraft)</span>
            <div className="field-input">
              <Icon name="user" size={16} />
              <input
                type="text"
                value={playerName}
                onChange={(e) => onPlayerName(e.target.value)}
                placeholder="ShealPlayer"
                maxLength={16}
                autoComplete="off"
              />
            </div>
          </label>

          <div className="login-options">
            <label className="checkbox">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span className="checkbox-box"><Icon name="check" size={11} /></span>
              Recordarme
            </label>
            <button type="button" className="link-button" onClick={() => api?.openDashboard()}>
              ¿Dónde consigo una clave?
            </button>
          </div>

          {!configured && (
            <p className="login-error">
              <Icon name="info" size={14} /> Configura tu aplicación de KeyAuth en Ajustes.
            </p>
          )}
          {error && (
            <p className="login-error"><Icon name="info" size={14} /> {error}</p>
          )}

          <button className="login-submit" type="submit" disabled={loading}>
            {loading ? (
              <><span className="spinner" /> Validando clave...</>
            ) : (
              <>Entrar <Icon name="arrowRight" size={17} /></>
            )}
          </button>

          <button className="free-mode-button" type="button" onClick={enterFree}>
            <Icon name="sparkles" size={15} /> Entrar gratis (sin clave)
          </button>
        </form>

        <p className="login-hint">
          <Icon name="shield" size={13} /> Las claves se validan en tiempo real contra el panel de licencias.
        </p>
      </div>

      <div className="login-footer">
        <span>SHEAL LAUNCHER · v2.0.1</span>
        <span className="login-footer-status"><i /> Servicios operativos</span>
      </div>
    </div>
  );
}
