import { useEffect, useRef, useState } from "react";
import type { MissionConfig } from "../lib/telemetry";
import { playWhep, type WhepSession } from "../lib/whep";

// Two run-mode-driven video methods (the backend sets ui.video_source):
//   webrtc-url    — production: pull the go2rtc Video node's WHEP restream, so
//                   both OBS and this overlay share the single capture card.
//   local-capture — STANDALONE only: no go2rtc node running, so read the capture
//                   card directly in the browser via getUserMedia.
// `camera`: 0 = first feed, 1 = second feed.
export function VideoPanel({ config, camera = 0 }: { config: MissionConfig; camera?: 0 | 1 }) {
  const mode = config.ui?.video_source ?? "webrtc-url";
  const videoUrl = camera === 0 ? config.ui?.video_url : config.ui?.video_url_2;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [live, setLive] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLive(false);
    setErr(null);
    const video = videoRef.current;
    if (!video) return;

    if (mode === "local-capture") {
      let stream: MediaStream | null = null;
      let cancelled = false;
      const open = async () => {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (camera === 1) {
          // Switch to the second camera if there is one.
          const cams = (await navigator.mediaDevices.enumerateDevices())
            .filter((d) => d.kind === "videoinput");
          if (cams.length > 1) {
            try {
              const second = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: { exact: cams[1].deviceId } }, audio: false,
              });
              stream.getTracks().forEach((t) => t.stop());
              stream = second;
            } catch {
              /* not available: keep the first camera */
            }
          }
        }
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = stream;
        setLive(true);
      };
      open().catch((e) => setErr(String(e)));
      return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); };
    }

    // webrtc-url
    if (!videoUrl) {
      setErr(camera === 0 ? "no ui.video_url configured for webrtc-url mode"
        : "no ui.video_url_2 configured for the second camera");
      return;
    }
    let session: WhepSession | null = null;
    let retry: number | undefined;
    let cancelled = false;

    const connect = async () => {
      try {
        session = await playWhep(videoUrl, video, (state) => {
          if (state === "connected") setLive(true);
          if (state === "failed" || state === "disconnected") { setLive(false); scheduleRetry(); }
        });
        setErr(null);
      } catch (e) {
        if (!cancelled) { setErr(String(e)); scheduleRetry(); }
      }
    };
    const scheduleRetry = () => {
      if (cancelled) return;
      window.clearTimeout(retry);
      retry = window.setTimeout(() => { session?.close(); connect(); }, 3000);
    };

    connect();
    return () => { cancelled = true; window.clearTimeout(retry); session?.close(); };
  }, [mode, videoUrl, camera]);

  return (
    <div className="video-fit">
      <div className="video-box">
        <video ref={videoRef} autoPlay muted playsInline style={{ display: live ? "block" : "none" }} />
        {!live && (
          <div className="no-signal">
            <span className="icon">◉</span>
            <span className="upper">No signal · stream offline</span>
            {mode === "webrtc-url" && videoUrl && <span className="mono" style={{ fontSize: 10 }}>connecting to {videoUrl}…</span>}
            {mode === "local-capture" && <span className="mono" style={{ fontSize: 10 }}>waiting for camera permission…</span>}
            {err && <span className="mono" style={{ fontSize: 10, color: "var(--err)" }}>{err}</span>}
          </div>
        )}
        {live && <span className="video-live-dot" title="live" />}
      </div>
    </div>
  );
}
