// Bundled artwork: class crests (src/assets/classes/*.svg), generated race badges and UI glyphs.
// All artwork here is original; no Blizzard game assets are bundled.

import { classInfo, raceInfo } from "./wow";

const classSvgs = import.meta.glob("./assets/classes/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** Optional user-supplied race art: src/assets/races/<RaceToken>_<male|female>.(png|svg|webp|jpg) */
const raceArt = import.meta.glob("./assets/races/*.{png,svg,webp,jpg,jpeg}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export function classIconSvg(classToken: string): string {
  const info = classInfo(classToken);
  return classSvgs[`./assets/classes/${info.icon}.svg`] ?? classSvgs["./assets/classes/warrior.svg"] ?? "";
}

function findRaceArt(race: string, gender: number): string | undefined {
  const g = gender === 3 ? "female" : "male";
  const wanted = [`${race}_${g}`, race].map((s) => s.toLowerCase());
  for (const [path, url] of Object.entries(raceArt)) {
    const base = path.split("/").pop()!.replace(/\.[^.]+$/, "").toLowerCase();
    if (wanted.includes(base)) return url;
  }
  return undefined;
}

const FACTION_COLORS = {
  Alliance: { top: "#2f5fb8", bottom: "#142a5c", rim: "#c9a54a" },
  Horde: { top: "#a3262a", bottom: "#4a0f12", rim: "#b8b8b8" },
  Neutral: { top: "#4b5563", bottom: "#1f2937", rim: "#c9a54a" },
} as const;

/** A heraldic shield with the race monogram, tinted by faction, with a gender pip. */
export function raceBadgeHtml(race: string, gender: number, faction?: string): string {
  const art = findRaceArt(race, gender);
  if (art) return `<img class="race-art" src="${art}" alt="" draggable="false" />`;
  const info = raceInfo(race, faction);
  const c = FACTION_COLORS[info.faction];
  const gid = `rg-${info.faction}`;
  const pip = gender === 3 ? "♀" : gender === 2 ? "♂" : "";
  return `<svg class="race-badge" viewBox="0 0 40 40" aria-hidden="true">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${c.top}"/><stop offset="1" stop-color="${c.bottom}"/>
    </linearGradient></defs>
    <path d="M20 2.5 35 7v11c0 9.6-6.3 16.4-15 19.5C11.3 34.4 5 27.6 5 18V7z" fill="url(#${gid})" stroke="${c.rim}" stroke-width="1.6"/>
    <text x="20" y="23.5" text-anchor="middle" font-size="12.5" font-weight="700" fill="#f5f0e1" font-family="Georgia, 'Times New Roman', serif">${info.short}</text>
    ${pip ? `<text x="20" y="32.5" text-anchor="middle" font-size="7.5" fill="${c.rim}">${pip}</text>` : ""}
  </svg>`;
}

const ICONS = {
  zzz: `<path d="M13.6 3.2A8.8 8.8 0 1 0 20.8 14 7 7 0 0 1 13.6 3.2z" fill="currentColor"/><path d="M15 4h4.2L15 8.6h4.2M19.6 9.6h2.6l-2.6 3h2.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  tree: `<path d="M12 2 6.5 9.5h2.6L5 15h5v6.5h4V15h5l-4.1-5.5h2.6z" fill="currentColor"/>`,
  pin: `<path d="M9 3h6l-1 6 3.5 3.5v1.5H13v6l-1 1-1-1v-6H6.5v-1.5L10 9z" fill="currentColor"/>`,
  pinOff: `<path d="M9 3h6l-1 6 3.5 3.5v1.5H13v6l-1 1-1-1v-6H6.5v-1.5L10 9z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`,
  compact: `<path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  expanded: `<rect x="3.5" y="4" width="17" height="6.5" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="3.5" y="13.5" width="17" height="6.5" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.8"/>`,
  gear: `<path fill="currentColor" fill-rule="evenodd" d="M10.3 2h3.4l.5 2.6c.6.2 1.2.5 1.7.9l2.5-.9 1.7 2.9-2 1.8a7 7 0 0 1 0 1.9l2 1.7-1.7 3-2.5-.9c-.5.4-1.1.7-1.7.9l-.5 2.6h-3.4l-.5-2.6c-.6-.2-1.2-.5-1.7-.9l-2.5.9-1.7-3 2-1.7a7 7 0 0 1 0-1.9l-2-1.8 1.7-2.9 2.5.9c.5-.4 1.1-.7 1.7-.9zM12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z" transform="translate(0 1)"/>`,
  minimize: `<path d="M6 12h12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
  close: `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  back: `<path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  refresh: `<path d="M19 8.5A7.5 7.5 0 1 0 19.5 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 3.5V9h-5.5z" fill="currentColor"/>`,
  heart: `<path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.9c0 5.6-7.5 10.2-7.5 10.2z" fill="currentColor"/>`,
  folder: `<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2h8.4A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`,
  file: `<path d="M6.5 3h7l4 4v13.5h-11z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13.5 3v4h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`,
  search: `<circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="m15 15 5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
  trash: `<path d="M5 7h14M10 4h4M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  more: `<circle cx="6" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="18" cy="12" r="1.7" fill="currentColor"/>`,
  check: `<path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  warn: `<path d="M12 3.5 21.5 20h-19z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10v4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.1" fill="currentColor"/>`,
  crown: `<path d="M3.5 8 8 11.5 12 5l4 6.5L20.5 8 19 18H5z" fill="currentColor"/>`,
  lock: `<rect x="5" y="10.5" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2"/>`,
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, cls = ""): string {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}
