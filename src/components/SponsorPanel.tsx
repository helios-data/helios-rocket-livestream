import { useEffect, useMemo, useRef, useState } from "react";
import { LogoPlate } from "./LogoPlate";

export interface SponsorSection {
  name: string;
  logos: string[];
}

/** Fetch the rotation sections served from the linked /app/sponsorships volume. */
export function useSponsors(): SponsorSection[] {
  const [sections, setSections] = useState<SponsorSection[]>([]);
  useEffect(() => {
    let live = true;
    fetch("/api/sponsors")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no sponsors"))))
      .then((d) => {
        const list: SponsorSection[] = (d?.sections ?? []).filter(
          (s: SponsorSection) => s.logos?.length,
        );
        if (live) setSections(list);
      })
      .catch(() => { /* no sponsor volume linked — panel stays hidden */ });
    return () => { live = false; };
  }, []);
  return sections;
}

/** Cross-fade duration; must match the .sponsor-grid transition in overlay.css. */
const FADE_MS = 450;
const GAP = 8; // px; same as the CSS gap
const PLATE_ASPECT = 2.4; // plate width : height
// Max logo growth, so a few logos don't get huge.
const MAX_SCALE = 2;

// Sponsor level from the folder name (e.g. "gold" = large). Base logo width in px.
type Tier = "large" | "medium" | "small";
const TIER_BASE_W: Record<Tier, number> = { large: 260, medium: 170, small: 120 };
function tierOf(folder: string): Tier {
  if (/title|presenting|diamond|platinum|gold/i.test(folder)) return "large";
  if (/bronze|supporter|friend|community/i.test(folder)) return "small";
  return "medium";
}

interface Item { src: string; tier: Tier }
interface Row { logos: string[]; w: number; h: number }

/** Arrange logos in rows at scale `s`. Each level starts a new row. */
function layoutRows(items: Item[], width: number, s: number): Row[] {
  const rows: Row[] = [];
  let i = 0;
  while (i < items.length) {
    const tier = items[i].tier;
    const w = Math.min(width, TIER_BASE_W[tier] * s);
    const cols = Math.max(1, Math.floor((width + GAP) / (w + GAP)));
    const logos: string[] = [];
    while (i < items.length && items[i].tier === tier && logos.length < cols) logos.push(items[i++].src);
    rows.push({ logos, w, h: w / PLATE_ASPECT });
  }
  return rows;
}
const rowsHeight = (rows: Row[]) =>
  rows.reduce((a, r) => a + r.h, 0) + GAP * Math.max(0, rows.length - 1);

/** Split sponsors into pages that fit the panel, then size each page's logos. */
function paginate(sections: SponsorSection[], width: number, height: number): Row[][] {
  const items: Item[] = sections.flatMap((s) => s.logos.map((src) => ({ src, tier: tierOf(s.name) })));
  // Fill each page with rows until it's full.
  const pages: Item[][] = [];
  let page: Item[] = [];
  let used = 0;
  for (const row of layoutRows(items, width, 1)) {
    const need = (page.length ? GAP : 0) + row.h;
    if (page.length && used + need > height) { pages.push(page); page = []; used = 0; }
    used += (page.length ? GAP : 0) + row.h;
    const tier = items.find((it) => it.src === row.logos[0])?.tier ?? "medium";
    page.push(...row.logos.map((src) => ({ src, tier })));
  }
  if (page.length) pages.push(page);
  // Pick the logo size that fills the most of the panel.
  return pages.map((p) => {
    let best = layoutRows(p, width, 1);
    let bestScore = -1;
    for (let s = 1; s <= MAX_SCALE + 1e-9; s += 0.02) {
      const rows = layoutRows(p, width, s);
      const h = rowsHeight(rows);
      if (h > height) continue;
      const w = Math.max(...rows.map((r) => r.logos.length * r.w + GAP * (r.logos.length - 1)));
      const score = (w * h) / (width * height);
      if (score >= bestScore) { best = rows; bestScore = score; }
    }
    return best;
  });
}

/** Sponsor logos, sized by sponsor level. Pages rotate if they don't all fit. */
export function SponsorPanel({ sections, intervalS = 10 }: {
  sections: SponsorSection[];
  intervalS?: number;
}) {
  const [idx, setIdx] = useState(0);
  const [shown, setShown] = useState(true);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [sections.length > 0]);

  const pages = useMemo(
    () => (box.w && box.h ? paginate(sections, box.w, box.h) : []),
    [sections, box.w, box.h],
  );

  useEffect(() => {
    setIdx(0);
    if (pages.length < 2) return;
    const period = Math.max(3, intervalS) * 1000;
    const id = setInterval(() => {
      setShown(false);
      setTimeout(() => {
        setIdx((i) => (i + 1) % pages.length);
        setShown(true);
      }, FADE_MS);
    }, period);
    return () => clearInterval(id);
  }, [pages.length, intervalS]);

  if (!sections.length) return null;
  const page = pages[Math.min(idx, pages.length - 1)] ?? [];

  return (
    <>
      <div className="sponsor-grid" ref={boxRef} style={{ opacity: shown ? 1 : 0 }}>
        {page.map((row, ri) => (
          <div className="sponsor-row" key={ri}>
            {row.logos.map((src, li) => (
              <div key={`${src}-${li}`} style={{ width: row.w, height: row.h }}>
                <LogoPlate src={src} alt="" />
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* Always rendered so the height stays the same. */}
      <div className="sponsor-dots" aria-hidden style={{ visibility: pages.length > 1 ? "visible" : "hidden" }}>
        {pages.map((_, i) => (
          <span key={i} className={i === idx ? "on" : ""} />
        ))}
      </div>
    </>
  );
}
