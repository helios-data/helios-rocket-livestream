import type { FlightState } from "../lib/telemetry";

// Flight state as plain text.
export function StateBadge({
  state, size = "md", live = true,
}: {
  state: FlightState | undefined;
  size?: "md" | "lg";
  live?: boolean;
}) {
  const title = (state ?? "UNKNOWN")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <div
      className={live ? "" : "stale"}
      style={{ fontSize: size === "lg" ? 30 : 14, fontWeight: 700, lineHeight: 1.1, color: "var(--text)" }}
    >
      {title}
    </div>
  );
}
