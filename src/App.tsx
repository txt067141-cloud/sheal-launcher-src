import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon, LogoMark, type IconName } from "./components/Icon";
import { Login, type Session } from "./components/Login";
import { MountainArt } from "./components/MountainArt";
import { SkinAura } from "./components/SkinAura";
import { logout as invalidateSession, verifySession } from "./lib/accounts";

type Page = "inicio" | "servidores" | "versiones" | "skins" | "ajustes";
type Lang = "ES" | "EN";

type Server = {
  id: string;
  name: string;
  description: string;
  ip: string;
  icon: IconName;
  color: string;
  badge: string;
};

type Skin = {
  id: string;
  name: string;
  tag: string;
  skin: string;
  shirt: string;
  pants: string;
  hair: string;
  /** Archivo PNG real de la skin (cuando no es una generada). */
  file?: string;
};

type Settings = {
  autoUpdate: boolean;
  closeOnLaunch: boolean;
  verifyFiles: boolean;
  notifications: boolean;
  compact: boolean;
  fullscreen: boolean;
};

type McProgress = { id: string; phase: string; label: string; percent: number; fatal?: boolean; exitCode?: number | null };
type McLaunchResult = { ok: boolean; mode?: string; message?: string; pid?: number };
type McInfo = {
  root: string;
  versions: string;
  libraries: string;
  assets: string;
  java: { path: string; version: string } | null;
  launcher: string | null;
  config: { minecraftDir?: string; javaPath?: string; launcherPath?: string };
};
type McApi = {
  info: () => Promise<McInfo>;
  versions: () => Promise<{ latest: Record<string, string>; versions: { id: string; type: string; url: string; releaseTime: string }[] }>;
  installed: () => Promise<string[]>;
  install: (id: string) => Promise<{ ok: boolean; id: string }>;
  launch: (id: string, options?: Record<string, unknown>) => Promise<McLaunchResult>;
  setConfig: (next: Record<string, string>) => Promise<unknown>;
  openFolder: () => Promise<unknown>;
  openSubfolder: (name: string) => Promise<{ path: string; opened: boolean }>;
  installSkin: (fileName: string, username?: string, uuid?: string) => Promise<{ path: string }>;
  ensureJava: (id?: string) => Promise<{ path: string; version: string }>;
  openLauncher: () => Promise<{ opened: boolean; path?: string; url?: string }>;
  updateParticles: (shape: string, color: string, wings?: boolean, wingStyle?: string) => Promise<unknown>;
  diagnostics: () => Promise<{
    mainLog: string;
    helperLog: string;
    gameLog: string;
    info: Record<string, unknown>;
  }>;
  chooseDir: () => Promise<string | null>;
  chooseJava: () => Promise<string | null>;
  onProgress: (callback: (payload: McProgress) => void) => () => void;
};

type KeyAuthConfig = { name: string; ownerid: string };
type KeyAuthApi = {
  config: () => Promise<KeyAuthConfig>;
  saveConfig: (config: KeyAuthConfig) => Promise<KeyAuthConfig>;
  login: (license: string) => Promise<{ ok: boolean; message: string; username?: string; sessionid?: string; subscription?: string; daysRemaining?: number | null; expiresAt?: number | null; isLifetime?: boolean }>;
  check: (license: string, sessionid?: string) => Promise<boolean>;
  status: (license: string, sessionid?: string) => Promise<{ ok: boolean }>;
  openDashboard: () => Promise<unknown>;
};

type RpcConfig = { clientId: string; enabled: boolean };
type RpcApi = {
  config: () => Promise<RpcConfig>;
  saveConfig: (config: RpcConfig) => Promise<RpcConfig>;
  openPortal: () => Promise<unknown>;
  stop: () => Promise<unknown>;
};

declare global {
  interface Window {
    rpc?: RpcApi;
    keyauth?: KeyAuthApi;
    mc?: McApi;
    uris?: {
      isDesktop?: boolean;
      platform?: string;
      minimize?: () => void;
      maximize?: () => void;
      close?: () => void;
      onVisibility?: (callback: (visible: boolean) => void) => () => void;
    };
  }
}

/* ------------------------------------------------------------------ */
/* Datos                                                               */
/* ------------------------------------------------------------------ */

const DEFAULT_SERVERS: Server[] = [
  {
    id: "hypixel",
    name: "Hypixel",
    description: "Minijuegos · Comunidad internacional",
    ip: "mc.hypixel.net",
    icon: "grid",
    color: "amber",
    badge: "Java Edition",
  },
  {
    id: "cubecraft",
    name: "CubeCraft",
    description: "Minijuegos · Comunidad internacional",
    ip: "play.cubecraft.net",
    icon: "box",
    color: "blue",
    badge: "Java Edition",
  },
  {
    id: "universocraft",
    name: "UniversoCraft",
    description: "Minijuegos · Comunidad en español",
    ip: "mc.universocraft.com",
    icon: "globe",
    color: "violet",
    badge: "Java Edition",
  },
];

const SKINS: Skin[] = [
  { id: "skin-01-boy-suit", name: "Boy Suit", tag: "Ropa", skin: "#c68642", shirt: "#2d3a6e", pants: "#202a4d", hair: "#3a2a1c", file: "skin-01-boy-suit.png" },
  { id: "skin-02-earrings", name: "Chica Pendientes", tag: "Casual", skin: "#f0c0a0", shirt: "#b06fd8", pants: "#3b2d63", hair: "#6d3b2a", file: "skin-02-earrings.png" },
  { id: "skin-03-herobrine", name: "Herobrine", tag: "Leyenda", skin: "#c9a07a", shirt: "#6e8fa8", pants: "#3a4a5c", hair: "#4a4a4a", file: "skin-03-herobrine.png" },
  { id: "skin-04-technoblade-pig", name: "Technoblade Pig", tag: "Famoso", skin: "#f0a0b0", shirt: "#c94f6d", pants: "#3a2d4d", hair: "#e090a0", file: "skin-04-technoblade-pig.png" },
  { id: "skin-05-girl-kawaii", name: "Girl Kawaii", tag: "Kawaii", skin: "#f4c6b0", shirt: "#f28fb8", pants: "#5a3a6e", hair: "#7a4a3a", file: "skin-05-girl-kawaii.png" },
  { id: "skin-06-woman", name: "Woman", tag: "Casual", skin: "#e8b89a", shirt: "#d9647a", pants: "#3f3f6d", hair: "#5a3327", file: "skin-06-woman.png" },
  { id: "skin-07-steve", name: "Steve", tag: "Clásica", skin: "#c68642", shirt: "#00a8a8", pants: "#3f3f74", hair: "#4a2f1d", file: "skin-07-steve.png" },
  { id: "skin-08-black-crown", name: "Black Crown", tag: "Épica", skin: "#b98c6a", shirt: "#1e1e28", pants: "#15151f", hair: "#101018", file: "skin-08-black-crown.png" },
  { id: "skin-09-blue-penguin", name: "Blue Penguin", tag: "Animal", skin: "#7ec8f0", shirt: "#2e6fa8", pants: "#254a78", hair: "#3f7fb0", file: "skin-09-blue-penguin.png" },
  { id: "skin-10-girl-queen", name: "Girl Queen", tag: "Épica", skin: "#f0c2a8", shirt: "#9b5fd0", pants: "#4a2d70", hair: "#6a3f2c", file: "skin-10-girl-queen.png" },
  { id: "skin-11-smiley-aurora", name: "Smiley Aurora", tag: "Divertida", skin: "#f6d97a", shirt: "#7ad6c0", pants: "#3d6e9e", hair: "#e8c85a", file: "skin-11-smiley-aurora.png" },
  { id: "skin-12-school-uniform", name: "School Uniform", tag: "Ropa", skin: "#f0c0a6", shirt: "#4a5a9e", pants: "#2d3560", hair: "#5a3022", file: "skin-12-school-uniform.png" },
  { id: "skin-13-purple-girl", name: "Purple Girl", tag: "Morado", skin: "#e8bdd8", shirt: "#a855f7", pants: "#5b21b6", hair: "#6d28d9", file: "skin-13-purple-girl.png" },
  { id: "skin-14-purple-knight", name: "Purple Knight", tag: "Legendaria", skin: "#d6c2e8", shirt: "#7c3aed", pants: "#312e81", hair: "#4c1d95", file: "skin-14-purple-knight.png" },
  { id: "skin-15-duck", name: "Duck", tag: "Animal", skin: "#f6d24a", shirt: "#e8a920", pants: "#c88a10", hair: "#f6d24a", file: "skin-15-duck.png" },
  { id: "skin-16-mystic-blue", name: "Mystic Blue", tag: "Místico", skin: "#cfe4f5", shirt: "#4a90d9", pants: "#2c5f9e", hair: "#d9eaf7", file: "skin-16-mystic-blue.png" },
  { id: "skin-17-stone", name: "Stone", tag: "Única", skin: "#a8a8a8", shirt: "#7a7a7a", pants: "#555", hair: "#888", file: "skin-17-stone.png" },
  { id: "skin-18-shadow", name: "Shadow", tag: "Oscura", skin: "#8a8a95", shirt: "#22222c", pants: "#15151d", hair: "#1a1a22", file: "skin-18-shadow.png" },
  { id: "skin-19-aurora-universe", name: "Aurora Universe", tag: "Épica", skin: "#e0c8f0", shirt: "#7c3aed", pants: "#3b1d6e", hair: "#a78bfa", file: "skin-19-aurora-universe.png" },
  { id: "skin-20-eboy-mask", name: "Eboy Mask", tag: "Moderna", skin: "#e8c0a8", shirt: "#2b2b35", pants: "#1a1a22", hair: "#333", file: "skin-20-eboy-mask.png" },
  { id: "skin-21-black-shadow", name: "Black Shadow", tag: "Oscura", skin: "#7a7a82", shirt: "#111", pants: "#0a0a0a", hair: "#0d0d0d", file: "skin-21-black-shadow.png" },
  { id: "skin-22-boy-brown-hair", name: "Brown Hair Boy", tag: "Casual", skin: "#d9a878", shirt: "#8b5a3c", pants: "#3f3f6d", hair: "#5a3a22", file: "skin-22-boy-brown-hair.png" },
  { id: "skin-23-brown-cardigan", name: "Brown Cardigan", tag: "Casual", skin: "#e8bc9c", shirt: "#8b5a3c", pants: "#4a4a6a", hair: "#6b4429", file: "skin-23-brown-cardigan.png" },
  { id: "skin-24-flower-girl", name: "Flower Girl", tag: "Kawaii", skin: "#f0c2a8", shirt: "#f29ab8", pants: "#6a4a7e", hair: "#8a5a3a", file: "skin-24-flower-girl.png" },
  { id: "skin-25-purple-crown", name: "Purple Crown", tag: "Épica", skin: "#d8c2ea", shirt: "#7c3aed", pants: "#312e81", hair: "#c084fc", file: "skin-25-purple-crown.png" },
  { id: "skin-26-dream", name: "Dream", tag: "Famoso", skin: "#e8c8a8", shirt: "#4a9e8f", pants: "#2d6e62", hair: "#6b4a2a", file: "skin-26-dream.png" },
  { id: "skin-27-emo-black", name: "Emo Black", tag: "Oscura", skin: "#e0b8a8", shirt: "#1c1c24", pants: "#111", hair: "#222", file: "skin-27-emo-black.png" },
  { id: "skin-28-girl-bow", name: "Girl Bow", tag: "Kawaii", skin: "#f2c6b0", shirt: "#f28fb8", pants: "#5a3a6e", hair: "#8a4a3a", file: "skin-28-girl-bow.png" },
  { id: "skin-29-girl-frog", name: "Frog Girl", tag: "Animal", skin: "#c8e8a8", shirt: "#7ac05a", pants: "#4a7e3a", hair: "#6a9e4a", file: "skin-29-girl-frog.png" },
  { id: "skin-30-girl-pink", name: "Pink Girl", tag: "Kawaii", skin: "#f6cdd8", shirt: "#f06a9e", pants: "#7a3a6e", hair: "#d96a9a", file: "skin-30-girl-pink.png" },
  { id: "skin-31-girl-white", name: "White Girl", tag: "Elegante", skin: "#f0d2c2", shirt: "#eee", pants: "#8a8a9a", hair: "#b8a898", file: "skin-31-girl-white.png" },
  { id: "skin-32-jo", name: "Jo", tag: "Casual", skin: "#e0b89a", shirt: "#5a7ea8", pants: "#3a4a6e", hair: "#4a3428", file: "skin-32-jo.png" },
  { id: "skin-33-gold-knight", name: "Gold Knight", tag: "Épica", skin: "#d8b89a", shirt: "#c9a227", pants: "#6b5518", hair: "#8a6a2a", file: "skin-33-gold-knight.png" },
  { id: "skin-34-scary-dark", name: "Scary Dark", tag: "Terror", skin: "#8a8a92", shirt: "#1a1a22", pants: "#0f0f16", hair: "#111", file: "skin-34-scary-dark.png" },
  { id: "skin-35-slim-egirl", name: "Slim Egirl", tag: "Moderna", skin: "#f0c0ac", shirt: "#4a4a6e", pants: "#2a2a44", hair: "#2a2a2a", file: "skin-35-slim-egirl.png" },
];

const PARTICLE_SHAPES = [
  { id: "dust", label: "Polvo", icon: "✦" },
  { id: "heart", label: "Corazón", icon: "♥" },
  { id: "flame", label: "Llama", icon: "♨" },
  { id: "portal", label: "Portal", icon: "◈" },
  { id: "endrod", label: "Varita", icon: "✧" },
  { id: "spark", label: "Chispa", icon: "⚡" },
  { id: "enchant", label: "Encanto", icon: "✺" },
  { id: "note", label: "Nota", icon: "♪" },
  { id: "aura", label: "Aura", icon: "◉" },
];

const PARTICLE_COLORS = ["#a855f7", "#ec4899", "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#ffffff"];

const WING_STYLES = [
  { id: "angel", label: "Ángel", icon: "✧" },
  { id: "phoenix", label: "Fénix", icon: "♨" },
  { id: "butterfly", label: "Mariposa", icon: "✿" },
  { id: "fairy", label: "Hada", icon: "❋" },
  { id: "bat", label: "Murciélago", icon: "☾" },
  { id: "dragon", label: "Dragón", icon: "✦" },
];

// --- Limites del modo gratis (solo lectura / jugar) ---
const FREE_SKINS = SKINS.slice(0, 4);
const FREE_PARTICLES = PARTICLE_SHAPES.filter((s) => s.id === "dust" || s.id === "aura");
const FREE_WINGS = WING_STYLES.filter((s) => s.id === "angel" || s.id === "phoenix");

const VERSIONS = [
  { id: "1.21.4", label: "1.21.4", tag: "Estable" },
  { id: "1.21.1", label: "1.21.1", tag: "Estable" },
  { id: "1.20.6", label: "1.20.6", tag: "Estable" },
  { id: "1.19.4", label: "1.19.4", tag: "Legacy" },
  { id: "1.8.9", label: "1.8.9", tag: "Legacy" },
];

const BACKGROUNDS = [
  { id: "backgrounds/bg-01-fortaleza-endermen.jpg", label: "Fortaleza End" },
  { id: "backgrounds/bg-02-torre-end.jpg", label: "Torre End" },
  { id: "backgrounds/bg-03-templos-flotantes.jpg", label: "Templos flotantes" },
  { id: "backgrounds/bg-04-endermen-particulas.webp", label: "Endermen" },
  { id: "backgrounds/bg-05-islas-moradas.webp", label: "Islas moradas" },
  { id: "backgrounds/bg-06-templos-noche.webp", label: "Templos de noche" },
  { id: "backgrounds/bg-07-portal-end.png", label: "Portal End" },
  { id: "backgrounds/bg-08-aurora.jpg", label: "Aurora" },
];

const HERO_SLIDES = [
  {
    kicker: "MINECRAFT A TU MANERA",
    title: ["Un mundo.", "Infinitas posibilidades."],
    text: "Más rendimiento. Tus mods favoritos. Cero límites.",
    image: "backgrounds/bg-03-templos-flotantes.jpg",
  },
  {
    kicker: "CREA SIN LÍMITES",
    title: ["Construye.", "Sin restricciones."],
    text: "Todas tus herramientas creativas, en un solo lugar.",
    image: "backgrounds/bg-06-templos-noche.webp",
  },
  {
    kicker: "JUEGA EN COMPAÑÍA",
    title: ["Tu mundo.", "Mejor compartido."],
    text: "Conecta con comunidades de todo el mundo al instante.",
    image: "backgrounds/bg-05-islas-moradas.webp",
  },
];

const DICT = {
  ES: {
    inicio: "Inicio",
    servidores: "Servidores",
    versiones: "Versiones",
    skins: "Skins y cosméticos",
    ajustes: "Ajustes",
    homeTitle: "Vamos a jugar.",
    homeSub: "Tu próxima aventura empieza aquí.",
    serverTitle: "Tu mundo es mejor en compañía.",
    serverSub: "Descubre comunidades y encuentra tu próxima partida.",
    versionsTitle: "Versiones de Minecraft.",
    versionsSub: "Descarga e instala cualquier versión para jugar.",
    skinsTitle: "Tu estilo, tu mundo.",
    skinsSub: "Elige una skin y entra con identidad propia.",
    settingsTitle: "Ajustes",
    settingsSub: "Personaliza tu experiencia de juego.",
    play: "JUGAR AHORA",
    launching: "INICIANDO...",
    ready: "Todo listo para tu aventura",
    operational: "Servicios operativos",
    versionLabel: "VERSIÓN DE MINECRAFT",
    searchServer: "Descubrir un servidor",
    orbit: "En la órbita",
    allNews: "Todas las novedades",
    explore: "Explorar novedades",
    session: "Sesión iniciada",
    noSession: "Sin sesión",
    connect: "Conecta tu cuenta",
    community: "Mejor en compañía.",
    findCommunity: "Encuentra tu comunidad.",
    discord: "Únete a Discord",
    gameExperience: "La experiencia de juego",
    useSkin: "Usar skin",
    currentSkin: "Skin activa",
    logout: "Cerrar sesión",
    download: "Descargar",
    downloading: "Descargando",
    playVersion: "Jugar",
    installedLabel: "Instalada",
    notInstalled: "Sin instalar",
    searchVersion: "Buscar versión...",
    releases: "Lanzamientos",
    snapshots: "Snapshots",
    minecraftFolder: "Carpeta del juego · texturas y recursos",
    javaRuntime: "Java / Runtime",
    selectFolder: "Elegir carpeta",
    selectJava: "Elegir Java",
    openFolder: "Abrir carpeta",
    noJava: "Java no detectado",
    useOfficial: "Launcher oficial",
  },
  EN: {
    inicio: "Home",
    servidores: "Servers",
    versiones: "Versions",
    skins: "Skins & cosmetics",
    ajustes: "Settings",
    homeTitle: "Let's play.",
    homeSub: "Your next adventure starts here.",
    serverTitle: "Your world is better together.",
    serverSub: "Discover communities and find your next match.",
    versionsTitle: "Minecraft versions.",
    versionsSub: "Download and install any version to play.",
    skinsTitle: "Your style, your world.",
    skinsSub: "Pick a skin and jump in with your own identity.",
    settingsTitle: "Settings",
    settingsSub: "Personalize your game experience.",
    play: "PLAY NOW",
    launching: "LAUNCHING...",
    ready: "Everything is ready for your adventure",
    operational: "Services operational",
    versionLabel: "MINECRAFT VERSION",
    searchServer: "Discover a server",
    orbit: "In orbit",
    allNews: "All news",
    explore: "Explore news",
    session: "Signed in",
    noSession: "No session",
    connect: "Connect your account",
    community: "Better together.",
    findCommunity: "Find your community.",
    discord: "Join Discord",
    gameExperience: "The game experience",
    useSkin: "Use skin",
    currentSkin: "Active skin",
    logout: "Sign out",
    download: "Download",
    downloading: "Downloading",
    playVersion: "Play",
    installedLabel: "Installed",
    notInstalled: "Not installed",
    searchVersion: "Search version...",
    releases: "Releases",
    snapshots: "Snapshots",
    minecraftFolder: "Game folder · textures & resources",
    javaRuntime: "Java / Runtime",
    selectFolder: "Choose folder",
    selectJava: "Choose Java",
    openFolder: "Open folder",
    noJava: "Java not detected",
    useOfficial: "Official launcher",
  },
} as const;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function useStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* almacenamiento no disponible */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      className={`toggle ${on ? "is-on" : ""}`}
      onClick={onChange}
      role="switch"
      aria-checked={on}
      aria-label={label}
    >
      <span />
    </button>
  );
}

function SkinAvatar({ skin, size = 58 }: { skin: Skin; size?: number }) {
  if (skin.file) {
    return (
      <img
        className="skin-avatar skin-avatar-file"
        src={`skins/${skin.file}`}
        width={size}
        height={size}
        alt={skin.name}
        draggable={false}
      />
    );
  }
  return (
    <svg
      className="skin-avatar"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <rect x="5" y="1" width="6" height="5" fill={skin.skin} />
      <rect x="5" y="1" width="6" height="1.6" fill={skin.hair} />
      <rect x="6.2" y="3.4" width="1" height="1" fill="#2b1c2e" />
      <rect x="8.8" y="3.4" width="1" height="1" fill="#2b1c2e" />
      <rect x="7.2" y="4.8" width="1.6" height="0.6" fill="#00000030" />
      <rect x="3" y="6" width="2" height="5" fill={skin.skin} />
      <rect x="11" y="6" width="2" height="5" fill={skin.skin} />
      <rect x="5" y="6" width="6" height="5" fill={skin.shirt} />
      <rect x="5" y="11" width="2.6" height="4" fill={skin.pants} />
      <rect x="8.4" y="11" width="2.6" height="4" fill={skin.pants} />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export default function App() {
  const [session, setSession] = useStorage<Session | null>("sheal_launcher_session", null);
  const [lang, setLang] = useStorage<Lang>("sheal_launcher_lang", "ES");
  const [version, setVersion] = useStorage("sheal_launcher_version", "1.21.4");
  const [activeSkin, setActiveSkin] = useStorage("sheal_launcher_skin", "skin-01-boy-suit");
  const [playerName, setPlayerName] = useStorage("sheal_mc_name", "ShealPlayer");
  const [particlesInGame, setParticlesInGame] = useStorage("sheal_particles_game", false);
  const [particleShape, setParticleShape] = useStorage("sheal_particle_shape", "dust");
  const [particleColor, setParticleColor] = useStorage("sheal_particle_color", "#a855f7");
  const [wingsOn, setWingsOn] = useStorage("sheal_wings", false);
  const [wingStyle, setWingStyle] = useStorage("sheal_wing_style", "angel");
  const [background, setBackground] = useStorage("sheal_launcher_background", "backgrounds/bg-03-templos-flotantes.jpg");
  const [customServers, setCustomServers] = useStorage<Server[]>("sheal_launcher_servers", []);
  const [settings, setSettings] = useStorage<Settings>("sheal_launcher_settings", {
    autoUpdate: true,
    closeOnLaunch: false,
    verifyFiles: true,
    notifications: true,
    compact: false,
    fullscreen: false,
  });

  const [authChecked, setAuthChecked] = useState(false);
  const [remainingMs, setRemainingMs] = useState<number>(0);
  const [page, setPage] = useState<Page>("inicio");
  const [toast, setToast] = useState("");
  const [launching, setLaunching] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [serverQuery, setServerQuery] = useState("");
  const [heroIndex, setHeroIndex] = useState(0);
  const [addingServer, setAddingServer] = useState(false);
  const [newServerName, setNewServerName] = useState("");
  const [newServerIp, setNewServerIp] = useState("");

  // Minecraft real (Electron)
  const [mcInfo, setMcInfo] = useState<McInfo | null>(null);
  const [mcVersions, setMcVersions] = useState<{ id: string; type: string; releaseTime: string }[]>([]);
  const [mcInstalled, setMcInstalled] = useState<string[]>([]);
  const [mcLoading, setMcLoading] = useState(false);
  const [versionQuery, setVersionQuery] = useState("");
  const [versionFilter, setVersionFilter] = useState<"release" | "snapshot">("release");
  const [installProgress, setInstallProgress] = useState<McProgress | null>(null);
  const [javaProgress, setJavaProgress] = useState<McProgress | null>(null);
  const [launchError, setLaunchError] = useState("");
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [keyConfig, setKeyConfig] = useState<KeyAuthConfig>({ name: "", ownerid: "" });
  const [rpcConfig, setRpcConfig] = useState<RpcConfig>({ clientId: "", enabled: true });
  const [diagnostics, setDiagnostics] = useState<{ mainLog: string; helperLog: string; gameLog: string; info: Record<string, unknown> } | null>(null);


  const isDesktop = typeof window !== "undefined" && (!!window.mc || !!window.uris?.isDesktop);
  const t = DICT[lang];
  const servers = useMemo(() => [...DEFAULT_SERVERS, ...customServers], [customServers]);

  const showToast = (message: string) => setToast(message);

  const formatTime = (ms: number) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Dias de licencia restantes segun pwfauth (dato directo del SDK).
  const licenseDaysLeft = (() => {
    if (!session || session.free) return null;
    if (session.isLifetime) return null; // licencia permanente
    if (session.daysRemaining != null && Number.isFinite(session.daysRemaining)) {
      return Math.max(0, Math.ceil(session.daysRemaining));
    }
    if (session.expiresAt && session.expiresAt > Date.now()) {
      return Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 86400000));
    }
    return null;
  })();

  useEffect(() => {
    if (session?.token && !verifySession(session.token)) setSession(null);
    // Si la clave ya expiro mientras la app estaba cerrada, forzar nuevo login.
    if (session && !session.free && session.expiresAt && session.expiresAt <= Date.now()) {
      if (session.token) invalidateSession(session.token);
      try { localStorage.removeItem("sheal_launcher_session"); } catch {}
      setSession(null);
      setPage("inicio");
    }
    // En modo gratis, nunca permitir la pagina de ajustes.
    if (session?.free && page === "ajustes") setPage("inicio");
    setAuthChecked(true);
    // Solo se comprueba al arrancar la app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.keyauth?.config().then(setKeyConfig).catch(() => undefined);
    window.rpc?.config().then(setRpcConfig).catch(() => undefined);
  }, []);

  // Temporizador de la clave: cuenta atras y cierra sesion al expirar (solo claves).
  useEffect(() => {
    if (!session || session.free || !session.expiresAt) {
      setRemainingMs(0);
      return;
    }
    const tick = () => {
      const left = session.expiresAt! - Date.now();
      if (left <= 0) {
        // Clave expirada: invalidar sesion, guardar aviso y CERRAR el launcher.
        if (session.token) invalidateSession(session.token);
        try {
          localStorage.removeItem("sheal_launcher_session");
          localStorage.setItem("sheal_key_expired", "1");
        } catch {}
        setRemainingMs(0);
        // Cerrar la ventana de la app de escritorio.
        window.uris?.close?.();
        return;
      }
      setRemainingMs(left);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token, session?.expiresAt, session?.free]);

  // Escribe la configuración en vivo: el mod la relee cada 600 ms,
  // así el color y la forma cambian sin reiniciar Minecraft.
  useEffect(() => {
    if (!window.mc) return;
    window.mc.updateParticles(particleShape, particleColor, wingsOn, wingStyle).catch(() => undefined);
  }, [particleShape, particleColor, wingsOn, wingStyle]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLangOpen(false);
        setVersionOpen(false);
        setBellOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const bridge = window.uris;
    if (!bridge?.onVisibility) return;
    return bridge.onVisibility(() => undefined);
  }, []);

  // Carga la info real de Minecraft cuando la app corre en Electron.
  useEffect(() => {
    const fallback = () =>
      VERSIONS.map((v) => ({ id: v.id, type: "release", url: "", releaseTime: "" }));

    if (!isDesktop || !window.mc) {
      if (!isDesktop) {
        fetch("versions.json")
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error("sin lista local"))))
          .then((data) => setMcVersions(data.versions || fallback()))
          .catch(() => {
            fetch("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
              .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
              .then((data) => setMcVersions(data.versions || fallback()))
              .catch(() => setMcVersions(fallback()));
          });
      }
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const [info, versions, installed] = await Promise.all([
          window.mc!.info(),
          window.mc!.versions(),
          window.mc!.installed(),
        ]);
        if (!alive) return;
        setMcInfo(info);
        setMcInstalled(installed);
        setMcVersions(versions.versions?.length ? versions.versions : fallback());
      } catch (error) {
        console.warn("No se pudo cargar Minecraft:", error);
        setMcVersions(fallback());
      }
    };
    load();
    const off = window.mc.onProgress((payload) => {
      if (payload.fatal) {
        setLaunchError(payload.label);
        setConsoleOpen(true);
        window.mc?.diagnostics().then(setDiagnostics).catch(() => undefined);
        return;
      }
      if (payload.id === "java") setJavaProgress(payload);
      else setInstallProgress(payload);
    });
    return () => {
      alive = false;
      off();
    };
  }, [isDesktop]);

  // Inyecta la skin activa en el juego cada vez que se abre el launcher.
  useEffect(() => {
    if (!isDesktop || !window.mc || !session?.token) return;
    const skin = SKINS.find((s) => s.id === activeSkin);
    if (!skin?.file) return;
    window.mc
      .installSkin(skin.file, session.username, session.uuid)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop, activeSkin, session?.token]);

  const windowAction = (action: "minimize" | "maximize" | "close") => {
    if (isDesktop) {
      if (action === "minimize") window.uris?.minimize?.();
      else if (action === "maximize") window.uris?.maximize?.();
      else window.uris?.close?.();
      return;
    }
    if (action === "maximize") {
      setMaximized((v) => !v);
      showToast(maximized ? "Ventana restaurada" : "Ventana maximizada");
    } else {
      showToast(action === "minimize" ? "Minimizar funciona en la app de escritorio (.exe)" : "Cerrar funciona en la app de escritorio (.exe)");
    }
  };

  const play = () => {
    // Si la versión seleccionada no está instalada, usa la primera disponible.
    const target = mcInstalled.includes(version) ? version : mcInstalled[0];
    if (target && target !== version) {
      setVersion(target);
      playVersion(target);
      return;
    }
    playVersion(version);
  };

  const copyIp = async (ip: string) => {
    try {
      await navigator.clipboard.writeText(ip);
      showToast(`IP copiada: ${ip}`);
    } catch {
      showToast(`IP del servidor: ${ip}`);
    }
  };

  const addServer = () => {
    if (!newServerName.trim() || !newServerIp.trim()) {
      showToast("Completa el nombre y la IP del servidor");
      return;
    }
    setCustomServers([
      ...customServers,
      {
        id: `custom-${Date.now()}`,
        name: newServerName.trim(),
        description: "Servidor añadido por ti",
        ip: newServerIp.trim(),
        icon: "star",
        color: "violet",
        badge: "Java Edition",
      },
    ]);
    setNewServerName("");
    setNewServerIp("");
    setAddingServer(false);
    showToast("Servidor añadido a tu lista");
  };

  const setSetting = (key: keyof Settings) =>
    setSettings({ ...settings, [key]: !settings[key] });

  const refreshMc = async () => {
    if (!window.mc) return;
    const [info, installed] = await Promise.all([window.mc.info(), window.mc.installed()]);
    setMcInfo(info);
    setMcInstalled(installed);
  };

  const downloadVersion = async (id: string) => {
    if (!window.mc) {
      showToast("La descarga requiere la app de escritorio (.exe)");
      return;
    }
    try {
      setInstallProgress({ id, phase: "start", label: "Preparando descarga...", percent: 1 });
      await window.mc.install(id);
      await refreshMc();
      setInstallProgress(null);
      showToast(`Versión ${id} instalada correctamente`);
    } catch (error) {
      setInstallProgress(null);
      showToast(`Error al descargar: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const playVersion = async (id: string) => {
    if (!window.mc) {
      showToast("Para jugar abre la app de escritorio (.exe)");
      window.open("https://www.minecraft.net/en-us/download", "_blank", "noopener");
      return;
    }
    if (!mcInstalled.includes(id)) {
      showToast(`Primero descarga la versión ${id}`);
      setPage("versiones");
      return;
    }
    setLaunching(true);
    try {
      await window.mc.ensureJava(id);
      const result = await window.mc.launch(id, {
        username: playerName,
        particles: particlesInGame,
        particleShape,
        particleColor,
        wings: wingsOn,
        wingStyle,
        fullscreen: settings.fullscreen,
        ram: 2048,
      });
      showToast(result.message || `Minecraft ${id} iniciado`);
    } catch (error) {
      showToast(`No se pudo iniciar: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      window.setTimeout(() => setLaunching(false), 1200);
    }
  };

  const chooseFolder = async () => {
    const picked = await window.mc?.chooseDir();
    if (picked) {
      await refreshMc();
      showToast(`Carpeta de Minecraft: ${picked}`);
    }
  };
  const chooseJavaPath = async () => {
    const picked = await window.mc?.chooseJava();
    if (picked) {
      await refreshMc();
      showToast(`Java seleccionado: ${picked}`);
    }
  };

  const saveKeyConfig = async () => {
    if (!window.keyauth) {
      showToast("La configuración requiere la app de escritorio");
      return;
    }
    try {
      const saved = await window.keyauth.saveConfig(keyConfig);
      setKeyConfig(saved);
      showToast("Aplicación de KeyAuth vinculada");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudo guardar");
    }
  };

  const saveRpcConfig = async () => {
    if (!window.rpc) {
      showToast("La configuración requiere la app de escritorio");
      return;
    }
    try {
      const saved = await window.rpc.saveConfig(rpcConfig);
      setRpcConfig(saved);
      showToast(saved.clientId ? "Discord RPC vinculado" : "Discord RPC desactivado");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudo guardar");
    }
  };

  const openConsole = async () => {
    setConsoleOpen(true);
    try {
      if (window.mc) setDiagnostics(await window.mc.diagnostics());
    } catch (error) {
      setDiagnostics({ mainLog: String(error), helperLog: "", gameLog: "", info: {} });
    }
  };

  const applySkinToGame = async (skinId?: string) => {
    const skin = SKINS.find((s) => s.id === (skinId || activeSkin));
    if (!skin?.file) return false;
    if (!window.mc) return false;
    try {
      await window.mc.installSkin(skin.file, session.username, session.uuid);
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudo inyectar la skin");
      return false;
    }
  };

  if (!authChecked) return <div className="auth-loading"><LogoMark size={44} /><p>Verificando tu cuenta...</p></div>;
  if (!session) return <Login onLogin={setSession} background={background} playerName={playerName} onPlayerName={setPlayerName} />;

  const filteredServers = servers.filter((s) =>
    `${s.name} ${s.description} ${s.ip}`.toLowerCase().includes(serverQuery.toLowerCase()),
  );

  const activeSkinData = SKINS.find((s) => s.id === activeSkin) ?? SKINS[0];
  const versionOptions = mcVersions.length
    ? mcVersions.filter((v) => v.type === "release").slice(0, 14).map((v) => ({ id: v.id, label: v.id, tag: mcInstalled.includes(v.id) ? "Instalada" : "Estable" }))
    : VERSIONS;
  const heads = [
    { label: t.homeTitle, sub: t.homeSub },
    { label: t.serverTitle, sub: t.serverSub },
    { label: t.versionsTitle, sub: t.versionsSub },
    { label: t.skinsTitle, sub: t.skinsSub },
    { label: t.settingsTitle, sub: t.settingsSub },
  ];
  const head = heads[["inicio", "servidores", "versiones", "skins", "ajustes"].indexOf(page)];

  return (
    <div
      className={`launcher ${isDesktop ? "is-desktop" : ""} ${maximized ? "is-maximized" : ""} ${settings.compact ? "is-compact" : ""}`}
    >
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <div className="shell-grid" />

      <div className="window">
        {/* Barra de título */}
        <header className="titlebar" onDoubleClick={() => windowAction("maximize")}>
          <div className="titlebar-brand">
            <LogoMark size={19} />
            <strong>SHEAL LAUNCHER</strong>
          </div>
          <div className="breadcrumb">
            Launcher <span>/</span> <b>{t[page]}</b>
          </div>
          <div className="window-controls">
            <button type="button" className="console-button" onClick={openConsole} aria-label="Consola de errores" title="Consola de errores">
              <span style={{ fontSize: 11, fontWeight: 800 }}>&gt;_</span>
            </button>
            <button type="button" onClick={() => windowAction("minimize")} aria-label="Minimizar">
              <Icon name="minus" size={15} />
            </button>
            <button type="button" onClick={() => windowAction("maximize")} aria-label="Maximizar">
              <Icon name="square" size={12} />
            </button>
            <button type="button" className="close" onClick={() => windowAction("close")} aria-label="Cerrar">
              <Icon name="x" size={15} />
            </button>
          </div>
        </header>

        <div className="window-body">
          {/* Barra lateral */}
          <aside className="sidebar">
            <div className="brand">
              <span className="brand-mark"><LogoMark size={30} /></span>
              <span className="brand-name">
                <strong>SHEAL</strong>
                <small>LAUNCHER</small>
              </span>
            </div>

            <p className="nav-caption">{t.gameExperience}</p>
            <nav className="main-nav" aria-label="Navegación principal">
              {([
                ["inicio", "home"],
                ["servidores", "servers"],
                ["versiones", "download"],
                ["skins", "shirt"],
              ] as [Page, IconName][]).map(([id, icon]) => (
                <button
                  key={id}
                  className={`nav-item ${page === id ? "active" : ""}`}
                  onClick={() => setPage(id)}
                >
                  <Icon name={icon} size={18} />
                  <span>{t[id]}</span>
                  {id === "servidores" && <em>{servers.length}</em>}
                </button>
              ))}
            </nav>

            <div className="nav-divider" />
            {!session?.free && (
              <button
                className={`nav-item ${page === "ajustes" ? "active" : ""}`}
                onClick={() => setPage("ajustes")}
              >
                <Icon name="settings" size={18} />
                <span>{t.ajustes}</span>
              </button>
            )}

            <div className="sidebar-spacer" />

            <div className="discord-card">
              <p className="discord-title">{t.community}</p>
              <p className="discord-sub">{t.findCommunity}</p>
              <button type="button" onClick={() => window.open("https://discord.gg/k3hCrN7Ef", "_blank", "noopener")}>
                {t.discord} <Icon name="external" size={13} />
              </button>
            </div>

            <div className="user-card">
              <span className="user-avatar">{session.username.charAt(0).toUpperCase()}</span>
              <span className="user-info">
                <strong>{session.username}</strong>
                <small>{session.free ? "Modo gratis" : t.session}</small>
                {!session.free && session.expiresAt && remainingMs > 0 && (
                  <small className={`session-timer ${remainingMs < 60 * 60 * 1000 ? "expiring" : ""}`}>
                    <Icon name="refresh" size={10} /> {formatTime(remainingMs)}
                  </small>
                )}
                {!session.free && licenseDaysLeft != null && (
                  <small className="session-timer">
                    <Icon name="shield" size={10} /> {licenseDaysLeft}d licencia
                  </small>
                )}
              </span>
              <button
                type="button"
                className="user-logout"
                aria-label={t.logout}
                title={t.logout}
                onClick={() => {
                  invalidateSession(session.token);
                  setSession(null);
                  setPage("inicio");
                  showToast("Sesión cerrada");
                }}
              >
                <Icon name="logout" size={16} />
              </button>
            </div>

            <div className="sidebar-foot">
              <span className="status-dot" /> v2.0.1 · Todo actualizado
            </div>
          </aside>

          {/* Contenido principal */}
          <main className="main">
            <div className="main-scroll">
              <header className="page-head">
                <div>
                  <h1>{head.label}</h1>
                  <p>{head.sub}</p>
                </div>
                <div className="head-actions">
                  <div className="dropdown-wrap">
                    <button className="lang-button" type="button" onClick={() => { setLangOpen(!langOpen); setBellOpen(false); }}>
                      <Icon name="globe" size={15} /> {lang} <Icon name="chevronDown" size={13} />
                    </button>
                    {langOpen && (
                      <div className="dropdown lang-menu">
                        {(["ES", "EN"] as Lang[]).map((l) => (
                          <button key={l} type="button" className={lang === l ? "selected" : ""} onClick={() => { setLang(l); setLangOpen(false); }}>
                            {l === "ES" ? "Español" : "English"} {lang === l && <Icon name="check" size={13} />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="dropdown-wrap">
                    <button className="bell-button" type="button" aria-label="Notificaciones" onClick={() => { setBellOpen(!bellOpen); setLangOpen(false); }}>
                      <Icon name="bell" size={17} />
                      <i />
                    </button>
                    {bellOpen && (
                      <div className="dropdown bell-menu">
                        <p>Notificaciones</p>
                        <div><Icon name="sparkles" size={15} /><span><b>Nueva versión 2.8</b><small>Mejoras de rendimiento y estabilidad.</small></span></div>
                        <div><Icon name="shield" size={15} /><span><b>Servicios operativos</b><small>Todo funciona con normalidad.</small></span></div>
                        <div><Icon name="users" size={15} /><span><b>Comunidad activa</b><small>12.480 jugadores conectados.</small></span></div>
                      </div>
                    )}
                  </div>
                </div>
              </header>

              {/* ---------------- INICIO ---------------- */}
              {page === "inicio" && (
                <div className="page-content home-page">
                  <section className="hero-card">
                    <MountainArt variant="hero" image={HERO_SLIDES[heroIndex].image} />
                    <div className="hero-content">
                      <span className="hero-kicker"><i /> {HERO_SLIDES[heroIndex].kicker}</span>
                      <h2>
                        {HERO_SLIDES[heroIndex].title[0]}
                        <br />
                        {HERO_SLIDES[heroIndex].title[1]}
                      </h2>
                      <p>{HERO_SLIDES[heroIndex].text}</p>
                      <button type="button" onClick={() => setPage("servidores")}>
                        {t.explore} <Icon name="arrowRight" size={16} />
                      </button>
                    </div>
                    <span className="hero-badge">JAVA EDITION</span>
                    <div className="hero-pagination">
                      {HERO_SLIDES.map((_, i) => (
                        <button
                          key={i}
                          type="button"
                          className={heroIndex === i ? "active" : ""}
                          onClick={() => setHeroIndex(i)}
                          aria-label={`Ir a la diapositiva ${i + 1}`}
                        />
                      ))}
                      <span>0{heroIndex + 1}</span>
                    </div>
                  </section>

                  {/* Estado de la licencia (visible para el usuario) */}
                  {!session.free && (
                    <div className={`license-card ${licenseDaysLeft != null && licenseDaysLeft <= 3 ? "low" : ""}`}>
                      <span className="license-icon"><Icon name="shield" size={20} /></span>
                      <div className="license-info">
                        <span className="license-kicker">Tu licencia SHEAL</span>
                        {session.isLifetime ? (
                          <>
                            <strong>Licencia permanente</strong>
                            <small>Tu clave no tiene fecha de caducidad.</small>
                          </>
                        ) : licenseDaysLeft != null ? (
                          <>
                            <strong>{licenseDaysLeft} {licenseDaysLeft === 1 ? "día" : "días"} restantes</strong>
                            <small>Tiempo restante: {formatTime(remainingMs)}</small>
                          </>
                        ) : (
                          <>
                            <strong>Licencia activa</strong>
                            <small>Tu clave está siendo validada.</small>
                          </>
                        )}
                      </div>
                      <span className="license-badge"><Icon name="check" size={13} /> Activa</span>
                    </div>
                  )}

                  <div className="section-head">
                    <h3>{t.orbit}</h3>
                    <button type="button" onClick={() => showToast("Abriendo todas las novedades...")}>
                      {t.allNews} <Icon name="arrowRight" size={14} />
                    </button>
                  </div>

                  <div className="news-grid">
                    <button type="button" className="news-card" onClick={() => showToast("Abriendo novedades de SHEAL LAUNCHER 2.8")}>
                      <MountainArt variant="banner" image="backgrounds/bg-01-fortaleza-endermen.jpg" />
                      <div className="news-body">
                        <span className="news-tag">ACTUALIZACIÓN</span>
                        <h4>Tu cliente, un nivel por encima.</h4>
                        <p>Descubre las novedades de SHEAL LAUNCHER 2.8</p>
                        <span className="news-arrow"><Icon name="arrowRight" size={17} /></span>
                      </div>
                    </button>
                    <button type="button" className="news-card" onClick={() => setPage("skins")}>
                      <MountainArt variant="banner" image="backgrounds/bg-07-portal-end.png" />
                      <div className="news-body">
                        <span className="news-tag">EXPLORAR</span>
                        <h4>El siguiente mundo te espera.</h4>
                        <p>Prepara tu perfil y empieza a construir.</p>
                        <span className="news-arrow"><Icon name="arrowRight" size={17} /></span>
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* ---------------- SERVIDORES ---------------- */}
              {page === "servidores" && (
                <div className="page-content servers-page">
                  <section className="small-banner">
                    <MountainArt variant="banner" image="backgrounds/bg-02-torre-end.jpg" />
                    <div className="small-banner-copy">
                      <span className="hero-kicker"><i /> MULTIJUGADOR</span>
                      <h2>{t.serverTitle}</h2>
                      <p>{t.serverSub}</p>
                    </div>
                  </section>

                  <div className="section-head server-head">
                    <div>
                      <h3>Servidores</h3>
                      <p>{servers.length} comunidades para explorar · Minecraft Java Edition</p>
                    </div>
                    <div className="server-tools">
                      <label className="search-field">
                        <Icon name="search" size={16} />
                        <input
                          value={serverQuery}
                          onChange={(e) => setServerQuery(e.target.value)}
                          placeholder={t.searchServer}
                        />
                      </label>
                      <button type="button" className="add-server-button" onClick={() => setAddingServer(!addingServer)}>
                        <Icon name="plus" size={15} /> Añadir
                      </button>
                    </div>
                  </div>

                  {addingServer && (
                    <div className="add-server-form">
                      <input value={newServerName} onChange={(e) => setNewServerName(e.target.value)} placeholder="Nombre del servidor" />
                      <input value={newServerIp} onChange={(e) => setNewServerIp(e.target.value)} placeholder="mc.ejemplo.com" />
                      <button type="button" onClick={addServer}><Icon name="check" size={15} /> Guardar</button>
                      <button type="button" className="cancel" onClick={() => setAddingServer(false)}>Cancelar</button>
                    </div>
                  )}

                  <div className="server-list">
                    {filteredServers.map((server) => (
                      <article className="server-row" key={server.id}>
                        <span className={`server-icon color-${server.color}`}><Icon name={server.icon} size={20} /></span>
                        <div className="server-copy">
                          <h4>{server.name}</h4>
                          <p>{server.description}</p>
                        </div>
                        <span className="edition-badge">{server.badge}</span>
                        <div className="ip-field">
                          <input readOnly value={server.ip} onFocus={(e) => e.target.select()} />
                          <button type="button" onClick={() => copyIp(server.ip)} aria-label="Copiar IP" title="Copiar IP">
                            <Icon name="copy" size={15} />
                          </button>
                        </div>
                      </article>
                    ))}
                    {!filteredServers.length && (
                      <div className="empty-state"><Icon name="search" size={26} /><p>No se encontraron servidores.</p></div>
                    )}
                  </div>

                  <p className="server-help">
                    <Icon name="info" size={14} /> <b>Cómo entrar:</b> Minecraft → Multijugador → Añadir servidor → introduce la dirección IP.
                    <br />Las versiones compatibles y la disponibilidad dependen de cada servicio.
                  </p>
                </div>
              )}

              {/* ---------------- VERSIONES ---------------- */}
              {page === "versiones" && (
                <div className="page-content versions-page">
                  <div className="mc-info-card">
                    <div className="mc-info-row">
                      <span className="mc-info-icon"><Icon name="folder" size={17} /></span>
                      <div><strong>{t.minecraftFolder}</strong><small>{mcInfo?.root || (isDesktop ? "Cargando..." : "Disponible en la app de escritorio")}</small></div>
                      <button type="button" disabled={!isDesktop} onClick={async () => {
                        try {
                          await window.mc!.openFolder();
                          showToast("Abriendo carpeta del juego");
                        } catch (e) { showToast(e instanceof Error ? e.message : "No se pudo abrir"); }
                      }}>{t.openFolder}</button>
                      <button type="button" onClick={chooseFolder} disabled={!isDesktop}>{t.selectFolder}</button>
                      <button type="button" className="ghost" disabled={!isDesktop} onClick={async () => {
                        try {
                          const r = await window.mc!.openSubfolder("mods");
                          showToast(`Carpeta de mods: ${r.path}`);
                        } catch (e) { showToast(e instanceof Error ? e.message : "No se pudo abrir"); }
                      }}>Mods</button>
                      <button type="button" className="ghost" disabled={!isDesktop} onClick={async () => {
                        try {
                          const r = await window.mc!.openSubfolder("shaderpacks");
                          showToast(`Carpeta de shaders: ${r.path}`);
                        } catch (e) { showToast(e instanceof Error ? e.message : "No se pudo abrir"); }
                      }}>Shaders</button>
                    </div>
                    <div className="mc-info-row">
                      <span className="mc-info-icon"><Icon name="sparkles" size={17} /></span>
                      <div><strong>Pack de recursos</strong><small>Texturas y recursos que se ven en tu pantalla</small></div>
                      <button type="button" className="ghost" disabled={!isDesktop} onClick={async () => {
                        try {
                          const r = await window.mc!.openSubfolder("resourcepacks");
                          showToast(`Carpeta de recursos: ${r.path}`);
                        } catch (e) { showToast(e instanceof Error ? e.message : "No se pudo abrir"); }
                      }}>Recursos</button>
                      <button type="button" className="ghost" disabled={!isDesktop} onClick={async () => {
                        try {
                          const r = await window.mc!.openSubfolder("mods");
                          showToast(`Carpeta de mods: ${r.path}`);
                        } catch (e) { showToast(e instanceof Error ? e.message : "No se pudo abrir"); }
                      }}>Mods</button>
                    </div>
                    <div className="mc-info-row">
                      <span className="mc-info-icon"><Icon name="zap" size={17} /></span>
                      <div><strong>{t.javaRuntime}</strong><small>{mcInfo?.java ? `${mcInfo.java.version} · ${mcInfo.java.path}` : t.noJava}</small></div>
                      <button type="button" onClick={chooseJavaPath} disabled={!isDesktop}>{t.selectJava}</button>
                      {mcInfo?.launcher && <span className="launcher-tag">{t.useOfficial}</span>}
                    </div>
                    <div className="mc-info-row">
                      <span className="mc-info-icon"><Icon name="download" size={17} /></span>
                      <div><strong>Descargas desde TLauncher</strong><small>Si Mojang no responde, usamos un espejo automatico; tambien puedes abrir TLauncher.</small></div>
                      <button type="button" className="ghost" disabled={!isDesktop} onClick={async () => {
                        try {
                          const r = await window.mc!.openLauncher();
                          if (r.opened) showToast("Abriendo TLauncher...");
                          else if (r.url) window.open(r.url, "_blank", "noopener");
                        } catch (e) { showToast(e instanceof Error ? e.message : "No se pudo abrir"); }
                      }}>Abrir TLauncher</button>
                    </div>
                  </div>

                  <div className="toolbar version-toolbar">
                    <label className="search-field wide">
                      <Icon name="search" size={16} />
                      <input value={versionQuery} onChange={(e) => setVersionQuery(e.target.value)} placeholder={t.searchVersion} />
                    </label>
                    <div className="tabs">
                      <button type="button" className={versionFilter === "release" ? "active" : ""} onClick={() => setVersionFilter("release")}>{t.releases}</button>
                      <button type="button" className={versionFilter === "snapshot" ? "active" : ""} onClick={() => setVersionFilter("snapshot")}>{t.snapshots}</button>
                    </div>
                    <button type="button" className="refresh-button" onClick={async () => {
                      if (!window.mc) {
                        setMcLoading(true);
                        try {
                          const r = await fetch("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
                          const data = await r.json();
                          setMcVersions(data.versions || []);
                        } finally { setMcLoading(false); }
                        return;
                      }
                      setMcLoading(true);
                      try {
                        const v = await window.mc.versions();
                        setMcVersions(v.versions);
                        await refreshMc();
                      } finally { setMcLoading(false); }
                    }} title="Actualizar lista"><Icon name="refresh" size={15} /></button>
                    <span className="toolbar-count">{mcInstalled.length} {t.installedLabel.toLowerCase()}</span>
                  </div>

                  <div className="version-list">
                    {mcVersions
                      .filter((v) => v.type === versionFilter)
                      .filter((v) => v.id.toLowerCase().includes(versionQuery.toLowerCase()))
                      .slice(0, 60)
                      .map((v) => {
                        const isInstalled = mcInstalled.includes(v.id);
                        const progress = installProgress?.id === v.id ? installProgress : null;
                        return (
                          <article className={`version-row ${isInstalled ? "installed" : ""}`} key={v.id}>
                            <span className="version-row-icon"><Icon name="box" size={19} /></span>
                            <div className="version-row-copy">
                              <h4>{v.id} <em>{v.type}</em></h4>
                              <p>{new Date(v.releaseTime).toLocaleDateString(lang === "ES" ? "es-ES" : "en-US", { year: "numeric", month: "short", day: "numeric" })}</p>
                              {progress && (
                                <div className="install-progress">
                                  <div className="install-bar"><i style={{ width: `${progress.percent}%` }} /></div>
                                  <small>{progress.label} · {progress.percent}%</small>
                                </div>
                              )}
                            </div>
                            <span className={`install-state ${isInstalled ? "on" : ""}`}>
                              {isInstalled ? <><Icon name="check" size={13} /> {t.installedLabel}</> : t.notInstalled}
                            </span>
                            {!isInstalled && (
                              <button type="button" className="version-download" disabled={!!progress} onClick={() => downloadVersion(v.id)}>
                                <Icon name="download" size={14} /> {progress ? `${t.downloading} ${progress.percent}%` : t.download}
                              </button>
                            )}
                            <button type="button" className="version-play" disabled={!isInstalled || launching} onClick={() => playVersion(v.id)}>
                              <Icon name="play" size={13} filled /> {t.playVersion}
                            </button>
                          </article>
                        );
                      })}
                    {!mcVersions.length && (
                      <div className="empty-state">
                        <Icon name="download" size={26} />
                        <p>{mcLoading ? "Cargando versiones desde Mojang..." : "No hay versiones. Comprueba tu conexión o pulsa actualizar."}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ---------------- SKINS ---------------- */}
              {page === "skins" && (
                <div className="page-content skins-page">
                  <div className="active-skin-bar">
                    <div className="skin-aura-wrap">
                      <SkinAura color={activeSkinData.shirt} count={26} />
                      <SkinAvatar skin={activeSkinData} size={62} />
                    </div>
                    <div>
                      <span className="eyebrow"><i /> {t.currentSkin}</span>
                      <h3>{activeSkinData.name}</h3>
                      <p>Lista para usar en Minecraft Java Edition.</p>
                    </div>
                    <span className="active-badge"><Icon name="check" size={14} /> Activa</span>
                    <button type="button" className="reapply-skin" disabled={!isDesktop} onClick={async () => {
                      const ok = await applySkinToGame();
                      showToast(ok ? "Skin inyectada en el juego · reinicia Minecraft para verla" : "Abre la app de escritorio para inyectarla");
                    }}><Icon name="zap" size={14} /> Inyectar</button>
                  </div>

                  <div className="active-skin-bar particles-toggle-row">
                    <span className="mc-info-icon"><Icon name="sparkles" size={17} /></span>
                    <div>
                      <strong>Partículas dentro del juego</strong>
                      <small>Instala Fabric + un mod que dibuja partículas alrededor de tu personaje (solo 26.3).</small>
                    </div>
                    <Toggle on={particlesInGame} onChange={() => setParticlesInGame(!particlesInGame)} label="Partículas en el juego" />
                  </div>

                  {particlesInGame && (
                    <div className="settings-card particle-menu">
                      <div className="settings-group-title"><Icon name="sparkles" size={16} /> Menú de partículas</div>
                      <p className="settings-menu-label">Forma</p>
                      <div className="particle-shapes">
                        {(session?.free ? FREE_PARTICLES : PARTICLE_SHAPES).map((shape) => (
                          <button
                            key={shape.id}
                            type="button"
                            className={particleShape === shape.id ? "active" : ""}
                            onClick={() => setParticleShape(shape.id)}
                            title={shape.label}
                          >
                            <span>{shape.icon}</span>
                            <small>{shape.label}</small>
                          </button>
                        ))}
                      </div>
                      <div className="wings-row">
                        <span className="mc-info-icon"><Icon name="sparkles" size={17} /></span>
                        <div>
                          <strong>Alas decorativas</strong>
                          <small>Unas alas con plumas 3D que aletean a la espalda de tu personaje. Son un cosmético aparte de las partículas.</small>
                        </div>
                        <Toggle on={wingsOn} onChange={() => setWingsOn(!wingsOn)} label="Alas decorativas" />
                      </div>
                      {wingsOn && (
                        <>
                          <p className="settings-menu-label">Estilo de alas</p>
                          <div className="wing-styles">
                            {(session?.free ? FREE_WINGS : WING_STYLES).map((style) => (
                              <button
                                key={style.id}
                                type="button"
                                className={wingStyle === style.id ? "active" : ""}
                                onClick={() => setWingStyle(style.id)}
                                title={style.label}
                              >
                                <span>{style.icon}</span>
                                <small>{style.label}</small>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                      <p className="settings-menu-label">Color de partículas {["dust", "aura"].includes(particleShape) ? "" : "(solo polvo/aura)"}</p>
                      <div className="particle-colors">
                        {PARTICLE_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            style={{ background: color }}
                            className={particleColor === color ? "active" : ""}
                            onClick={() => setParticleColor(color)}
                            aria-label={`Color ${color}`}
                          />
                        ))}
                        <label className="custom-color">
                          <input type="color" value={particleColor} onChange={(e) => setParticleColor(e.target.value)} />
                          <span>Otro</span>
                        </label>
                      </div>
                      <p className="cape-note">
                        <Icon name="info" size={14} /> El color afecta solo a las partículas "Polvo" y "Aura". Las alas mantienen el color original de su textura.
                      </p>
                      <div className="settings-card" style={{ marginTop: 10 }}>
                        <div className="settings-group-title"><Icon name="sparkles" size={16} /> Emotes en el juego</div>
                        <p className="settings-menu-label">Mantén Ctrl y pulsa un número mientras juegas</p>
                        <div className="emote-list">
                          <span><b>Ctrl + 1</b> Saludar</span>
                          <span><b>Ctrl + 2</b> Bailar</span>
                          <span><b>Ctrl + 3</b> Saltar</span>
                          <span><b>Ctrl + 4</b> Agacharse</span>
                          <span><b>Ctrl + 5</b> Girar</span>
                          <span><b>Ctrl + 6</b> Celebrar</span>
                          <span><b>Ctrl + 7</b> Baile Disco</span>
                          <span><b>Ctrl + 8</b> Baile Lento</span>
                          <span><b>Ctrl + 9</b> Baile Salto</span>
                          <span><b>Ctrl + 0</b> Detener</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="section-head"><h3>Colección de skins</h3><p>{(session?.free ? FREE_SKINS : SKINS).length} diseños · aura y partículas visuales en la vista previa</p></div>

                  <div className="skin-grid">
                    {(session?.free ? FREE_SKINS : SKINS).map((skin) => {
                      const active = activeSkin === skin.id;
                      return (
                        <article className={`skin-card ${active ? "active" : ""}`} key={skin.id}>
                          <div className="skin-preview">
                            <SkinAura color={skin.shirt} count={14} />
                            <SkinAvatar skin={skin} size={74} />
                            <span className="skin-tag">{skin.tag}</span>
                          </div>
                          <h4>{skin.name}</h4>
                          <button type="button" className={active ? "on" : ""} onClick={async () => {
                            setActiveSkin(skin.id);
                            const ok = await applySkinToGame(skin.id);
                            showToast(ok ? `Skin "${skin.name}" inyectada · reinicia Minecraft para verla` : `Skin "${skin.name}" activada`);
                          }}>
                            {active ? <><Icon name="check" size={14} /> {t.currentSkin}</> : t.useSkin}
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ---------------- AJUSTES ---------------- */}
              {page === "ajustes" && !session?.free && (
                <div className="page-content settings-page">
                  <div className="settings-card">
                    <div className="settings-group-title"><Icon name="zap" size={16} /> General</div>
                    <SettingRow icon="refresh" title="Actualización automática" desc="Mantén el launcher siempre al día." on={settings.autoUpdate} onChange={() => setSetting("autoUpdate")} />
                    <SettingRow icon="play" title="Cerrar launcher al iniciar" desc="El launcher se cerrará al abrir Minecraft." on={settings.closeOnLaunch} onChange={() => setSetting("closeOnLaunch")} />
                    <SettingRow icon="shield" title="Verificar archivos" desc="Comprueba la integridad antes de jugar." on={settings.verifyFiles} onChange={() => setSetting("verifyFiles")} />
                  </div>


                  <div className="settings-card">
                    <div className="settings-group-title"><Icon name="sparkles" size={16} /> Interfaz</div>
                    <SettingRow icon="bell" title="Notificaciones" desc="Muestra avisos y novedades." on={settings.notifications} onChange={() => setSetting("notifications")} />
                    <SettingRow icon="grid" title="Modo compacto" desc="Interfaz más densa y pequeña." on={settings.compact} onChange={() => setSetting("compact")} />
                    <SettingRow icon="square" title="Pantalla completa" desc="Inicia Minecraft en pantalla completa." on={settings.fullscreen} onChange={() => setSetting("fullscreen")} />
                  </div>

                  <div className="settings-card">
                    <div className="settings-group-title"><Icon name="user" size={16} /> Mi cuenta SHEAL</div>
                    <div className="account-card">
                      <span className="account-avatar">{session.username.charAt(0).toUpperCase()}</span>
                      <div className="account-copy">
                        <strong>{session.username}</strong>
                        <small>{session.email}</small>
                        <small>UUID: {session.uuid || "—"}</small>
                      </div>
                      <span className="account-badge"><Icon name="key" size={13} /> Licencia</span>
                    </div>
                    {licenseDaysLeft != null && (
                      <div className="account-license">
                        <Icon name="shield" size={14} />
                        <span>Tu licencia: <b>{licenseDaysLeft} {licenseDaysLeft === 1 ? "día" : "días"} restantes</b> · {formatTime(remainingMs)}</span>
                      </div>
                    )}
                    <label className="field player-name-field">
                      <span>Nombre de tu personaje en Minecraft</span>
                      <div className="field-input">
                        <Icon name="user" size={16} />
                        <input
                          type="text"
                          value={playerName}
                          onChange={(e) => setPlayerName(e.target.value)}
                          placeholder="ShealPlayer"
                          maxLength={16}
                        />
                        <button type="button" className="field-eye" onClick={() => showToast(`Nombre guardado: ${playerName}`)} aria-label="Guardar nombre">
                          <Icon name="check" size={16} />
                        </button>
                      </div>
                    </label>
                    <p className="cape-note">
                      <Icon name="info" size={14} /> Este nombre aparecerá en el juego al pulsar Jugar. Se guarda automáticamente.
                    </p>
                  </div>

                  <div className="settings-card">
                    <div className="settings-group-title"><Icon name="sparkles" size={16} /> Fondos del launcher</div>
                    <div className="bg-grid">
                      {BACKGROUNDS.map((bg) => (
                        <button
                          key={bg.id}
                          type="button"
                          className={`bg-thumb ${background === bg.id ? "active" : ""}`}
                          style={{ backgroundImage: `url("${bg.id}")` }}
                          title={bg.label}
                          onClick={() => { setBackground(bg.id); showToast(`Fondo "${bg.label}" aplicado`); }}
                        >
                          {background === bg.id && <Icon name="check" size={16} />}
                          <span>{bg.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="settings-card">
                    <div className="settings-group-title"><Icon name="folder" size={16} /> Instalación</div>
                    <div className="path-row">
                      <Icon name="folder" size={17} />
                      <div><strong>Ruta de instalación</strong><small>{mcInfo?.root || "C:/Users/%USER%/AppData/Roaming/.minecraft"}</small></div>
                      <button type="button" onClick={chooseFolder}>Elegir</button>
                      <button type="button" className="ghost" onClick={async () => { await window.mc?.openFolder(); }}>Abrir</button>
                    </div>
                    <div className="path-row">
                      <Icon name="zap" size={17} />
                      <div><strong>Java / Runtime</strong><small>{mcInfo?.java ? mcInfo.java.path : "No detectado (elige javaw.exe)"}</small></div>
                      <button type="button" onClick={chooseJavaPath}>Elegir</button>
                    </div>
                    <div className="about-row">
                      <LogoMark size={28} />
                      <div><strong>SHEAL LAUNCHER v2.0.1</strong><small>Hecho con React + Electron · Tema morado</small></div>
                      <span className="about-badge">Estable</span>
                    </div>
                    <button type="button" className="account-action" onClick={openConsole}>
                      <Icon name="terminal" size={14} /> Abrir consola de errores (diagnóstico)
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Barra inferior */}
            <footer className="launchbar">
              <div className="dropdown-wrap version-wrap">
                <button className="version-select" type="button" onClick={() => { setVersionOpen(!versionOpen); setLangOpen(false); setBellOpen(false); }}>
                  <span className="version-icon"><Icon name="box" size={18} /></span>
                  <span className="version-copy">
                    <small>{t.versionLabel}</small>
                    <strong>{version} <em>{versionOptions.find((v) => v.id === version)?.tag ?? (mcInstalled.includes(version) ? "Instalada" : "Estable")}</em></strong>
                  </span>
                  <Icon name="chevronDown" size={15} />
                </button>
                {versionOpen && (
                  <div className="dropdown version-menu">
                    <p>Selecciona una versión</p>
                    {versionOptions.map((v) => (
                      <button key={v.id} type="button" className={version === v.id ? "selected" : ""} onClick={() => { setVersion(v.id); setVersionOpen(false); showToast(`Versión ${v.id} seleccionada`); }}>
                        <Icon name="box" size={14} /> {v.label} <em>{v.tag}</em>
                        {version === v.id && <Icon name="check" size={13} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="launch-status">
                {javaProgress && javaProgress.percent < 100 ? (
                  <>
                    <strong>{javaProgress.label}</strong>
                    <span className="java-bar"><i style={{ width: `${javaProgress.percent}%` }} /></span>
                  </>
                ) : (
                  <>
                    <strong>{t.ready}</strong>
                    <span><i /> {t.operational}</span>
                  </>
                )}
              </div>

              <button className={`play-button ${launching ? "is-launching" : ""}`} type="button" onClick={play} disabled={launching}>
                {launching ? (
                  <><span className="spinner" /> {t.launching}</>
                ) : (
                  <><Icon name="play" size={16} filled /> {t.play}</>
                )}
              </button>
            </footer>
          </main>
        </div>
      </div>

      {consoleOpen && (
        <div className="console-backdrop">
          <div className="console-panel">
            <header>
              <div><Icon name="terminal" size={17} /> <strong>Consola de diagnóstico</strong></div>
              <div className="console-actions">
                <button type="button" onClick={openConsole}><Icon name="refresh" size={14} /> Actualizar</button>
                <button type="button" onClick={() => {
                  const text = [
                    "=== INFO ===", JSON.stringify(diagnostics?.info || {}, null, 2),
                    "=== MAIN ===", diagnostics?.mainLog || "",
                    "=== HELPER ===", diagnostics?.helperLog || "",
                    "=== GAME ===", diagnostics?.gameLog || "",
                  ].join("\n");
                  navigator.clipboard?.writeText(text);
                  showToast("Diagnóstico copiado");
                }}><Icon name="copy" size={14} /> Copiar todo</button>
                <button type="button" onClick={() => setConsoleOpen(false)}><Icon name="x" size={15} /></button>
              </div>
            </header>
            <div className="console-info">
              <pre>{JSON.stringify(diagnostics?.info || {}, null, 2)}</pre>
            </div>
            <div className="console-logs">
              <section>
                <h5>Launcher (Electron)</h5>
                <pre>{diagnostics?.mainLog || "(sin datos)"}</pre>
              </section>
              <section>
                <h5>Descarga / juego (CmlLib)</h5>
                <pre>{diagnostics?.helperLog || "(sin datos)"}</pre>
              </section>
              <section>
                <h5>Juego (Java)</h5>
                <pre>{diagnostics?.gameLog || "(sin datos)"}</pre>
              </section>
            </div>
          </div>
        </div>
      )}

      {launchError && (
        <div className="ms-modal-backdrop">
          <div className="ms-modal error-modal">
            <span className="ms-modal-icon error"><Icon name="info" size={22} /></span>
            <h2>Minecraft no pudo iniciar</h2>
            <p>Este es el motivo exacto. Cópialo y mándalo para poder corregirlo:</p>
            <pre className="error-detail">{launchError}</pre>
            <div className="error-actions">
              <button type="button" onClick={() => navigator.clipboard?.writeText(launchError)}>Copiar error</button>
              <button type="button" className="ghost" onClick={() => setLaunchError("")}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <span><Icon name="checkCircle" size={17} /></span>
          {toast}
        </div>
      )}
    </div>
  );
}

function SettingRow({
  icon,
  title,
  desc,
  on,
  onChange,
}: {
  icon: IconName;
  title: string;
  desc: string;
  on: boolean;
  onChange: () => void;
}): ReactNode {
  return (
    <div className="setting-row">
      <span className="setting-icon"><Icon name={icon} size={18} /></span>
      <div className="setting-copy"><strong>{title}</strong><small>{desc}</small></div>
      <Toggle on={on} onChange={onChange} label={title} />
    </div>
  );
}
