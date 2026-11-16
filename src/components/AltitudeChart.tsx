import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { MissionStore } from "../lib/store";
import { FLIGHT_ORDER, VIEWER_LABEL } from "../lib/eventmeta";

const PREROLL_SECONDS = 5; // the window starts this long before liftoff

// Seconds -> m:ss (rounded to avoid 1:59.999).
const mmss = (v: number) => {
  const s = Math.round(v);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// Altitude over the whole flight.
export function AltitudeChart({
  store, height = 240, liveHz = 8, dark = true, fill = false,
}: {
  store: MissionStore;
  height?: number;
  liveHz?: number;
  dark?: boolean;
  fill?: boolean; // fill parent height instead of using `height`
}) {
  const ref = useRef<HTMLDivElement>(null);
  const liftoffRef = useRef(0);

  useEffect(() => {
    if (!ref.current) return;
    const measuredH = () => (fill ? Math.max(80, ref.current!.clientHeight) : height);
    const text = dark ? "rgba(230,235,242,0.55)" : "rgba(22,32,46,0.6)";
    const faint = dark ? "rgba(230,235,242,0.08)" : "rgba(22,32,46,0.1)";
    const lineColor = dark ? "#e6ebf2" : "#16202e";
    const font = "12px Inconsolata, monospace";

    // Event markers: vertical line + label.
    const markerPlugin: uPlot.Plugin = {
      hooks: {
        draw: (u) => {
          const { ctx } = u;
          const top = u.bbox.top;
          const bottom = u.bbox.top + u.bbox.height;
          const dpr = devicePixelRatio;
          ctx.save();
          ctx.font = `${11 * dpr}px Inconsolata, monospace`;
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          // Skip events from a previous flight.
          const reached = FLIGHT_ORDER[store.mission?.flight_state ?? "UNKNOWN"];
          for (const a of store.annotations) {
            const label = VIEWER_LABEL[a.type]?.toUpperCase();
            if (!label || FLIGHT_ORDER[a.type] > reached) continue;
            if (a.x < u.scales.x.min! || a.x > u.scales.x.max!) continue;
            const px = Math.round(u.valToPos(a.x, "x", true));
            ctx.strokeStyle = faint;
            ctx.lineWidth = dpr;
            ctx.beginPath();
            ctx.moveTo(px, top);
            ctx.lineTo(px, bottom);
            ctx.stroke();
            ctx.fillStyle = text;
            // Flip the label left near the edge.
            const w = ctx.measureText(label).width;
            const fits = px + 6 * dpr + w <= u.bbox.left + u.bbox.width;
            ctx.textAlign = fits ? "left" : "right";
            ctx.fillText(label, fits ? px + 6 * dpr : px - 6 * dpr, top + 2 * dpr);
          }
          ctx.restore();
        },
      },
    };

    const opts: uPlot.Options = {
      width: ref.current.clientWidth,
      height: measuredH(),
      padding: [20, 16, 0, 0],
      cursor: { show: false }, // broadcast: nobody hovers
      legend: { show: false },
      plugins: [markerPlugin],
      scales: {
        x: {
          time: false,
          range: (_u, dataMin, dataMax) => {
            if (dataMax == null) return [0, 1];
            const start = liftoffRef.current > 0 ? liftoffRef.current - PREROLL_SECONDS : (dataMin ?? 0);
            return [start, dataMax];
          },
        },
        y: { range: (_u, _min, max) => [0, Math.max(100, max ?? 0) * 1.08] },
      },
      axes: [
        {
          // Height of the time labels only (default leaves a gap).
          stroke: text, font, grid: { show: false }, ticks: { show: false }, gap: 6, size: 24,
          // Ticks every 10/30/60 s from liftoff.
          splits: (_u, _i, min, max) => {
            const t0 = liftoffRef.current;
            const span = max - min;
            const step = span <= 60 ? 10 : span <= 180 ? 30 : 60;
            const out: number[] = [];
            for (let k = Math.ceil((min - t0) / step); t0 + k * step <= max; k++) {
              if (k >= 0) out.push(t0 + k * step);
            }
            return out;
          },
          values: (_u, vals) => vals.map((v) => mmss(Math.max(0, v - liftoffRef.current))),
        },
        {
          stroke: text, font, size: 72, gap: 8, ticks: { show: false },
          grid: { stroke: faint, width: 1 },
          // Round steps, at least ~26px apart.
          splits: (u, _i, _min, max) => {
            const plotPx = u.bbox.height / devicePixelRatio;
            const maxTicks = Math.max(2, Math.floor(plotPx / 26) + 1);
            const steps = [100, 200, 500, 1000, 2000, 5000, 10000];
            const step = steps.find((s) => Math.floor(max / s) + 1 <= maxTicks) ?? steps[steps.length - 1];
            const out: number[] = [];
            for (let v = 0; v <= max; v += step) out.push(v);
            return out;
          },
          values: (_u, vals) => vals.map((v) => `${v.toLocaleString()} m`),
        },
      ],
      series: [
        {},
        { stroke: lineColor, width: 2, points: { show: false } },
      ],
    };
    const plot = new uPlot(opts, [[], []], ref.current);

    const ro = new ResizeObserver(() =>
      plot.setSize({ width: ref.current!.clientWidth, height: measuredH() }));
    ro.observe(ref.current);

    const timer = window.setInterval(() => {
      const a = store.alt;
      const n = a.x.length;
      if (n === 0) return;
      let liftoffX = 0;
      for (let i = 0; i < n; i++) { if (a.baroAvg[i] > 5) { liftoffX = a.x[i]; break; } }
      liftoffRef.current = liftoffX;
      plot.setData([a.x, a.baroAvg]);
    }, 1000 / liveHz);

    return () => { window.clearInterval(timer); ro.disconnect(); plot.destroy(); };
  }, [store, height, liveHz, dark, fill]);

  return <div ref={ref} style={{ width: "100%", height: fill ? "100%" : height }} />;
}
