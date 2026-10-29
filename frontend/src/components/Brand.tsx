import React from "react";

// LED City brand pieces: the workforce glyph, the serif wordmark, and the
// skyline motif used along the bottom of highlight cards. All decorative SVG
// is aria-hidden; the wordmark text carries the name.

export function BrandGlyph({ size = 44 }: { size?: number }) {
  return (
    <svg
      className="brand-glyph"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="11" cy="17.5" r="4.5" className="brand-glyph-side" />
      <path d="M2.5 35.5c0-5.4 3.6-8.9 8.5-8.9 1.9 0 3.7.6 5.1 1.6-2 2.2-3.2 5-3.4 7.3z" className="brand-glyph-side" />
      <circle cx="37" cy="17.5" r="4.5" className="brand-glyph-side" />
      <path d="M45.5 35.5c0-5.4-3.6-8.9-8.5-8.9-1.9 0-3.7.6-5.1 1.6 2 2.2 3.2 5 3.4 7.3z" className="brand-glyph-side" />
      <circle cx="24" cy="12.5" r="6" className="brand-glyph-main" />
      <path d="M13.5 35.5c0-6.9 4.7-11.4 10.5-11.4s10.5 4.5 10.5 11.4z" className="brand-glyph-main" />
      <circle cx="17" cy="41.5" r="1.6" className="brand-glyph-led" />
      <circle cx="24" cy="41.5" r="1.6" className="brand-glyph-led" />
      <circle cx="31" cy="41.5" r="1.6" className="brand-glyph-led" />
    </svg>
  );
}

export function BrandWordmark() {
  return (
    <span className="brand-wordmark">
      <span>LED City</span>
      <span>Workforce</span>
    </span>
  );
}

export function CitySkyline() {
  return (
    <svg
      className="skyline"
      viewBox="0 0 320 60"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="skyline-far"
        d="M0 60V46h10v-8h12v10h10V34h8v-6h6v6h8v12h12v-8h14v10h8V26h6v-6h6v6h8v18h12v-8h14v12h8V32h14v10h10v-14h8v-6h10v6h6v14h12v-8h12V24h6v-4h6v4h6v18h10V36h16v10h8v-8h14v-6h12v12h10v-6h18V60z"
      />
      <path
        className="skyline-near"
        d="M0 60V50h18V40h12v14h12V36h10v-6h6v6h8v18h16V44h14v12h10V30h6v-6h4v6h6v24h14V46h16v8h10V38h12v18h14V42h10v-8h6v8h8v14h16V48h14v8h12V40h10v16h16v-8h12V52h28V60z"
      />
      <g className="skyline-lights">
        <rect x="45" y="40" width="2" height="2" />
        <rect x="45" y="46" width="2" height="2" />
        <rect x="104" y="34" width="2" height="2" />
        <rect x="104" y="42" width="2" height="2" />
        <rect x="171" y="44" width="2" height="2" />
        <rect x="231" y="40" width="2" height="2" />
        <rect x="231" y="47" width="2" height="2" />
        <rect x="282" y="46" width="2" height="2" />
      </g>
    </svg>
  );
}

// Three soft LED points: the LED City stand-in for the reference's balloons.
export function LedCluster() {
  return (
    <svg className="led-cluster" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="40" cy="18" r="9" className="led-glow" />
      <circle cx="40" cy="18" r="5" className="led-dot led-dot-1" />
      <circle cx="22" cy="32" r="6.5" className="led-glow" />
      <circle cx="22" cy="32" r="3.5" className="led-dot led-dot-2" />
      <circle cx="48" cy="42" r="5" className="led-glow" />
      <circle cx="48" cy="42" r="2.5" className="led-dot led-dot-3" />
    </svg>
  );
}
