import { useEffect, useState, type ReactNode } from "react";
import { StateBadge } from "../components/StateBadge";
import { AltitudeChart } from "../components/AltitudeChart";
import { GpsMap } from "../components/GpsMap";
import { Rocket3D } from "../components/Rocket3D";
import { SponsorPanel, useSponsors } from "../components/SponsorPanel";
import { getStore, useStore, hasGpsFix } from "../lib/store";
import { sourceState } from "../lib/fallback";
import { useTheme } from "../lib/theme";
import { ThemeToggle } from "../components/ThemeToggle";
import { PREDICTION } from "../lib/colors";
import { clock, feet, fmt, G_MS2, haversine, M_TO_FT } from "../lib/units";
import { VideoPanel } from "./VideoPanel";

const store = getStore("overlay");

function useClocks() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 500); return () => clearInterval(id); }, []);
  return t;
}

// Heading is optional.
function Panel({ h, children, className = "", stale = false, right }: {
  h?: string; children: ReactNode; className?: string; stale?: boolean; right?: ReactNode;
}) {
  return (
    <div className={`ov-panel ${className} ${stale ? "stale" : ""}`}>
      {h && (
        <div className="h" style={right ? { display: "flex", justifyContent: "space-between", alignItems: "center" } : undefined}>
          <span>{h}</span>{right}
        </div>
      )}
      {children}
    </div>
  );
}

// On/off toggle saved across reloads.
function usePersistedToggle(key: string): [boolean, () => void] {
  const [on, setOn] = useState<boolean>(() => {
    try { return localStorage.getItem(key) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, on ? "1" : "0"); } catch { /* ignore */ }
  }, [key, on]);
  return [on, () => setOn((v) => !v)];
}

export function App() {
  useStore(store);
  const [theme, toggleTheme] = useTheme();
  const [showPred, togglePred] = usePersistedToggle("hmc-show-landing");
  const [dualVideo, toggleDualVideo] = usePersistedToggle("hmc-dual-video");
  // Preview of the pre-launch/post-flight screen. Cleared on any real state change.
  const [phasePreview, setPhasePreview] = useState<"pre" | "post" | null>(null);
  const now = useClocks();
  const sponsors = useSponsors();
  const cfg = store.config;
  const ui = cfg.ui ?? {};
  const sradDs = sourceState(store.link, "srad", ui.srad_stale_seconds ?? 5);
  const cotsDs = sourceState(store.link, "cots", ui.cots_stale_seconds ?? 60);
  const m = store.mission;
  const s = store.srad;
  const hasSrad = sradDs.status !== "no_data" && s != null;
  const stale = sradDs.status === "stale";

  // A GPS fix at 0,0 is the flight computer's default before lock — not a real
  // fix. Only show the map once we have a genuine (non-0,0) coordinate from
  // either source (tracks already exclude 0,0, so a non-empty track counts).
  const hasGps = hasGpsFix(s?.gps.lon, s?.gps.lat)
    || hasGpsFix(store.cots?.position?.lon, store.cots?.position?.lat)
    || store.sradTrack.length > 0 || store.cotsTrack.length > 0;

  // Tilt of the nose (body +Z, axial) from vertical, from the gravity vector when
  // |a| ≈ 1 g. The IMU reports gravity, so "up" = -accel; at rest az ≈ -1 g and
  // tilt ≈ 0°. Accel is m/s^2 (~9.81 at rest), so gate the magnitude in g.
  let tiltDeg = "—";
  if (s) {
    const ax = s.accel.x ?? 0, ay = s.accel.y ?? 0, az = s.accel.z ?? -G_MS2;
    const a = Math.hypot(ax, ay, az);
    const g = a / G_MS2;
    if (g > 0.7 && g < 1.3) tiltDeg = fmt((Math.acos(Math.max(-1, Math.min(1, -az / a))) * 180) / Math.PI, 0);
  }

  // t_minus_s is positive before launch, so negate it for T−.
  const tClock = m?.t_plus_s != null ? clock(m.t_plus_s, true)
    : m?.t_minus_s != null ? clock(-m.t_minus_s, true) : "T− --:--";

  // Screen to show: pre-launch, flight, or post-flight.
  const livePhase = !m || m.flight_state === "STANDBY" || m.flight_state === "UNKNOWN" ? "pre"
    : m.flight_state === "LANDED" ? "post" : "flight";
  // A real state change ends the preview.
  useEffect(() => { setPhasePreview(null); }, [m?.flight_state]);
  const phase = phasePreview ?? livePhase;
  const togglePreview = (p: "pre" | "post") => setPhasePreview((cur) => (cur === p ? null : p));
  // Pre-launch: no rocket, chart or map. Post-flight: no rocket, smaller map.
  const isPre = phase === "pre";
  // Pre-launch shows the countdown band instead of the flight strip.
  const preBand = isPre;

  return (
    <div className={`overlay ${dualVideo ? "dual" : "single"} ${isPre ? "pre" : ""} ${phase === "post" ? "post" : ""}`}>
      <header className="ov-header">
        <img
          className="logo"
          src={theme === "light" ? "/brand/UBCRocket_Logo_Coloured_Long.png" : "/brand/UBCRocket_Logo_White_Long.png"}
          alt="UBC Rocket"
        />
        <div className="ov-mission">
          <span className="name">{cfg.mission_name ?? "CLOUDBURST"} · {cfg.event_name ?? "IREC 2026"}</span>
          <span className="sub">{cfg.callsign ?? "N0CALL"} · MISSION CONTROL</span>
        </div>
        <div className="ov-clocks">
          <div className="ov-tclock">
            <div className="big">{tClock}</div>
            <div className="lbl">MISSION CLOCK</div>
          </div>
          <div className="ov-tclock">
            <div className="big">{now.toISOString().slice(11, 19)}</div>
            <div className="lbl">UTC</div>
          </div>
          {/* Preview buttons. Click again to return to live. */}
          <button className={`header-btn mono ${phasePreview === "pre" ? "active" : ""}`}
            onClick={() => togglePreview("pre")} title="Preview the pre-launch screen">
            PRE-LAUNCH
          </button>
          <button className={`header-btn mono ${phasePreview === "post" ? "active" : ""}`}
            onClick={() => togglePreview("post")} title="Preview the post-flight summary">
            POST-FLIGHT
          </button>
          <button className="header-btn mono" onClick={toggleDualVideo}
            title="Show one or two camera feeds">
            {dualVideo ? "2 CAMERAS" : "1 CAMERA"}
          </button>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </header>

      {/* Video, with the phase strip underneath */}
      <div className={`ov-main ${dualVideo ? "dual" : ""}`}>
        <Panel className="video-panel">
          {/* Camera 1 stays mounted so it doesn't reconnect. */}
          <div className={`video-pair ${dualVideo ? "dual" : ""}`}>
            <VideoPanel config={cfg} camera={0} />
            {dualVideo && <VideoPanel config={cfg} camera={1} />}
          </div>
        </Panel>
        {/* Under the video: rocket, numbers and chart. */}
        {!preBand && <Panel className="telemetry-panel" stale={phase === "flight" && stale}>
          {phase === "flight" && (
            <div className="rocket-slot">
              <div className="rocket-canvas">
                <Rocket3D store={store} height="100%" hasData={hasSrad}
                  gyroUnits={cfg.gyro_units ?? "deg"} />
              </div>
            </div>
          )}
          <div className="telemetry-body">
            {phase === "flight" && (
              <>
                {/* Live value, with peak or unit conversion underneath. */}
                <NumberBar big={dualVideo} items={[
                  { label: "ALTITUDE", value: hasSrad ? fmt(s!.altitude_agl_m, 0) : "—", unit: "m",
                    detail: hasSrad ? feet(s!.altitude_agl_m) : "—" },
                  { label: "VELOCITY", value: hasSrad ? fmt(s!.kf_velocity, 0) : "—", unit: "m/s",
                    detail: `peak ${fmt(m?.max_velocity_ms ?? 0, 0)} m/s` },
                  { label: "MACH", value: hasSrad ? fmt(s!.mach, 2) : "—",
                    detail: `peak ${fmt(m?.max_mach ?? 0, 2)}` },
                  { label: "G-FORCE", value: hasSrad && s!.g_force != null ? fmt(s!.g_force, 1) : "—", unit: "g",
                    detail: `peak ${fmt(m?.max_g ?? 0, 1)} g` },
                  { label: "ROLL RATE", value: hasSrad ? fmt(s!.gyro.z, 0) : "—", unit: "°/s",
                    detail: "spin about the nose" },
                  { label: "TILT", value: tiltDeg, unit: "°", detail: "from vertical" },
                ]} />
                <div className="tele-chart">
                  {sradDs.status === "no_data"
                    ? <div className="awaiting" style={{ height: "100%" }}>Awaiting telemetry</div>
                    : <AltitudeChart store={store} fill dark={theme === "dark"} />}
                </div>
                {hasSrad && s!.altitude_degraded && (
                  <div className="mono degraded-note">
                    ⚠ barometers degraded — showing Kalman altitude · ground {fmt(s!.ground_altitude, 0)} m MSL
                  </div>
                )}
              </>
            )}
            {phase === "post" && <FlightSummary big={dualVideo} dark={theme === "dark"} />}
          </div>
        </Panel>}
      </div>

      {/* Right column: state, map, sponsors. */}
      <div className="ov-right">
        {!isPre && (
          <Panel className="state-panel" stale={stale}>
            <StateBadge state={m?.flight_state} size="lg" live={sradDs.status === "live"} />
          </Panel>
        )}
        {!isPre && <Panel className="gps-panel" stale={cotsDs.status === "stale" && sradDs.status !== "live"}>
          <div className="map-fill">
            {/* Landing toggle. */}
            <div className="map-toggle"><PredToggle on={showPred} onToggle={togglePred} /></div>
            {!hasGps ? (
              <div className="awaiting" style={{ height: "100%" }}>No GPS fix</div>
            ) : (
              <GpsMap store={store} fill theme={theme} showPrediction={showPred} autoFit />
            )}
            {/* Coordinates and satellite count. */}
            {hasGps && (
              <div className="map-info mono">
                <span>
                  {fmtCoord(s?.gps.lat, "N", "S")}, {fmtCoord(s?.gps.lon, "E", "W")}
                  {s && ` · ${s.gps.fix === 3 ? "" : `${fixName(s.gps.fix)} · `}${s.gps.sats ?? 0} satellites`}
                </span>
                {/* activeLanding() ignores a previous flight's prediction. */}
                {showPred && store.activeLanding()?.best_estimate && (
                  <span style={{ color: PREDICTION.estimate }}>
                    Predicted landing {fmtCoord(store.activeLanding()!.best_estimate!.lat, "N", "S")}, {fmtCoord(store.activeLanding()!.best_estimate!.lon, "E", "W")}
                  </span>
                )}
              </div>
            )}
          </div>
        </Panel>}
        {/* Pinned to the bottom of the column; hidden entirely when no logos. */}
        {sponsors.length > 0 && (
          <Panel h="Our Sponsors" className="sponsor-panel">
            <SponsorPanel sections={sponsors} intervalS={ui.sponsor_rotate_seconds ?? 10} />
          </Panel>
        )}
      </div>

      {/* Pre-launch band. */}
      {preBand && <Panel className="pre-band"><PreLaunchInfo /></Panel>}
    </div>
  );
}

function Stat({ label, value, unit, sub, size = 24 }: {
  label: string; value: string; unit?: string; sub?: string; size?: number;
}) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="big-num" style={{ fontSize: size }}>
        {value}{unit && <span className="unit" style={{ fontSize: "0.45em", color: "var(--text-dim)", marginLeft: 4 }}>{unit}</span>}
      </span>
      {sub && <span className="faint mono" style={{ fontSize: 11 }}>{sub}</span>}
    </div>
  );
}

interface NumberItem {
  label: string; value: string; unit?: string;
  detail?: string; // second line: unit conversion or the flight's peak
}

// Row of numbers under the video. `big` in two-camera mode.
function NumberBar({ items, big }: { items: NumberItem[]; big: boolean }) {
  return (
    <div className={`num-bar ${big ? "big" : ""}`}
      style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
      {items.map((it) => (
        <div key={it.label} className="num-item">
          <span className="num-label">{it.label}</span>
          <span className="num-value big-num">
            {it.value}{it.unit && <span className="num-unit">{it.unit}</span>}
          </span>
          <span className="num-detail">{it.detail ?? " "}</span>
        </div>
      ))}
    </div>
  );
}

// Pre-launch band: countdown, rocket name and facts.
function PreLaunchInfo() {
  const cfg = store.config;
  const facts: NumberItem[] = [];
  if (cfg.expected_apogee_m != null) {
    facts.push({ label: "TARGET APOGEE", value: fmt(cfg.expected_apogee_m, 0), unit: "m",
      detail: feet(cfg.expected_apogee_m) });
  }
  for (const f of cfg.rocket_facts ?? []) facts.push({ label: f.label.toUpperCase(), value: f.value });
  // Countdown if armed in /admin, else "Standing by".
  const tMinus = store.mission?.t_minus_s;
  return (
    <div className="phase-strip">
      <div className="countdown">
        <span className="phase-label">{tMinus != null ? "LAUNCH IN" : "STATUS"}</span>
        <span className="big-num countdown-value">
          {tMinus != null ? clock(-tMinus, true) : "Standing by"}
        </span>
      </div>
      <div className="mission-id">
        <span className="mission-rocket">{cfg.rocket_name ?? cfg.mission_name ?? "CloudBurst"}</span>
        <span className="mission-event">UBC Rocket · {cfg.event_name ?? "IREC 2026"}</span>
      </div>
      {facts.length > 0 && <NumberBar big items={facts} />}
    </div>
  );
}

// Post-flight summary numbers.
function FlightSummary({ big, dark }: { big: boolean; dark: boolean }) {
  const m = store.mission;
  const cfg = store.config;
  const ev = (t: string) => store.events.find((e) => e.type === t);
  const drogue = ev("DROGUE_DESCENT"), main = ev("MAIN_DESCENT"), landed = ev("LANDED");

  // Apogee as % of target.
  const apogee = m?.max_altitude_agl_m ?? null;
  const target = cfg.expected_apogee_m ?? null;
  const accuracy = apogee != null && target ? (apogee / target) * 100 : null;
  const miss = apogee != null && target ? apogee - target : null;

  // Descent rates from event altitudes and times (m/s).
  const rate = (a?: { altitude_agl_m: number; t_plus_s: number | null },
    b?: { altitude_agl_m: number; t_plus_s: number | null }) =>
    a && b && a.t_plus_s != null && b.t_plus_s != null && b.t_plus_s > a.t_plus_s
      ? (a.altitude_agl_m - b.altitude_agl_m) / (b.t_plus_s - a.t_plus_s) : null;
  const drogueRate = rate(drogue, main);
  const mainRate = rate(main, landed ? { ...landed, altitude_agl_m: 0 } : undefined);

  // Landing spot: SRAD GPS, else COTS.
  const s = store.srad;
  const c = store.cots?.position;
  const spot = hasGpsFix(s?.gps.lon, s?.gps.lat) ? { lat: s!.gps.lat!, lon: s!.gps.lon! }
    : hasGpsFix(c?.lon, c?.lat) ? { lat: c!.lat!, lon: c!.lon! } : null;
  const pad = store.groundStation();
  const fromPad = spot && pad.lat != null && pad.lon != null
    ? haversine(pad.lat, pad.lon, spot.lat, spot.lon) : null;

  return (
    <>
      <span className="summary-title">Flight summary</span>
      <NumberBar big={big} items={[
        { label: "TARGET ACCURACY", value: accuracy != null ? fmt(accuracy, 1) : "—", unit: "%",
          detail: miss != null ? `${miss >= 0 ? "+" : "−"}${fmt(Math.abs(miss), 0)} m vs ${fmt(target, 0)} m target` : "no target set" },
        { label: "TOP SPEED", value: fmt(m?.max_velocity_ms, 0), unit: "m/s",
          detail: `Mach ${fmt(m?.max_mach, 2)}` },
        { label: "MAX G", value: fmt(m?.max_g, 1), unit: "g", detail: "peak acceleration" },
        { label: "MAIN CHUTE", value: main ? fmt(main.altitude_agl_m, 0) : "—", unit: "m",
          detail: main?.t_plus_s != null ? `opened at T+${clock(main.t_plus_s)}` : "not deployed" },
        { label: "DESCENT", value: fmt(mainRate, 0), unit: "m/s",
          detail: `main · drogue ${fmt(drogueRate, 0)} m/s` },
        { label: "LANDED", value: fromPad ? `${fmt(fromPad.distance, 0)}` : "—",
          unit: fromPad ? `m ${compass(fromPad.bearing)}` : undefined,
          detail: `from pad${landed?.t_plus_s != null ? ` · ${clock(landed.t_plus_s)} flight` : ""}` },
      ]} />
      <div className="tele-chart">
        <AltitudeChart store={store} fill dark={dark} />
      </div>
    </>
  );
}

// Bearing in degrees -> "NE" etc.
function compass(deg: number): string {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

// 49.268139 -> "49.26814° N".
function fmtCoord(v: number | null | undefined, pos: string, neg: string): string {
  if (v == null || v === 0) return "—"; // 0 = no fix yet (see hasGpsFix)
  return `${Math.abs(v).toFixed(5)}° ${v >= 0 ? pos : neg}`;
}

// GPS fix type. Assumes u-blox numbering (3 = 3D); not documented in falcon-protos.
function fixName(fix: number | null | undefined): string {
  if (fix === 3) return "3D fix";
  if (fix === 2) return "2D fix";
  if (fix == null || fix < 2) return "No fix";
  return `Fix ${fix}`;
}

// Small header toggle for the predicted landing-zone overlay on the GPS map.
function PredToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="mono"
      title="Toggle predicted landing zone on the map"
      style={{
        fontSize: 9, letterSpacing: "0.08em", padding: "2px 6px", borderRadius: 3, cursor: "pointer",
        border: `1px solid ${on ? PREDICTION.estimate : "rgba(140,148,166,0.5)"}`,
        background: on ? "rgba(255,79,163,0.16)" : "transparent",
        color: on ? PREDICTION.estimate : "var(--text-dim)",
      }}
    >
      LANDING {on ? "●" : "○"}
    </button>
  );
}
