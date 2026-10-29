import React from "react";

// One outline icon set for the whole shell, drawn on a 24px grid so every
// glyph shares the same stroke weight and optical size.
const PATHS = {
  dashboard: "M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z",
  assistant:
    "M5 5.5h14A1.5 1.5 0 0 1 20.5 7v8.5A1.5 1.5 0 0 1 19 17h-8.5l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5zM8.5 11.25h.01M12 11.25h.01M15.5 11.25h.01",
  scorecard:
    "M8.5 5H6.5A1.5 1.5 0 0 0 5 6.5v12A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 17.5 5h-2M9 3.5h6v3H9zM9 16.5v-3M12 16.5v-6M15 16.5v-4",
  team:
    "M9 11a3.25 3.25 0 1 0 0-6.5A3.25 3.25 0 0 0 9 11zM3.5 19.5c.6-3 2.8-4.75 5.5-4.75s4.9 1.75 5.5 4.75M15.5 4.75a3 3 0 0 1 0 6M17.25 14.9c1.7.5 2.9 2.05 3.25 4.6",
  analytics: "M3.5 20h17M6.5 17v-4M10.5 17V8M14.5 17v-6M18.5 17V5",
  live: "M3.5 5h17v11h-17zM9 20h6M12 16v4",
  settings: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.75-3.75",
  bell: "M18 15.5V11a6 6 0 1 0-12 0v4.5l-1.5 2h15zM10 20a2 2 0 0 0 4 0",
  power: "M12 3.5v8M7.05 6.55a7 7 0 1 0 9.9 0",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6 6 18",
  collapse: "M4 5h16v14H4zM9.5 5v14M15.5 10l-2 2 2 2",
  expand: "M4 5h16v14H4zM9.5 5v14M13.5 10l2 2-2 2",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4",
  moon: "M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z",
  chevronLeft: "M14.5 6l-6 6 6 6",
  chevronRight: "M9.5 6l6 6-6 6",
  clock: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 7.5V12l3 2",
  alert: "M12 4.5 20.5 19h-17zM12 10v4M12 16.75h.01",
  check: "M5 12.5l4.5 4.5L19 7.5",
  shield: "M12 3.5l7 2.5v5.5c0 4.5-3 7.75-7 9-4-1.25-7-4.5-7-9V6zM9.5 12h5",
  calendar: "M5 6h14v14H5zM5 10h14M9 4v4M15 4v4",
  flag: "M6 21V4M6 4h11l-2 4 2 4H6",
  plus: "M12 5v14M5 12h14",
  mail: "M4 6h16v12H4zM4.5 7l7.5 6 7.5-6",
  play: "M8 5.5v13l10-6.5z",
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={PATHS[name]}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
