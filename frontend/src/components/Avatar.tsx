import React from "react";

// Presentation-only initials chip (design pass): a coloured circle with the
// person's initials, used wherever a name appears in a dense table or the
// sidebar. No data or behaviour - the name is the only input.

const TINTS = [
  "avatar-tint-1",
  "avatar-tint-2",
  "avatar-tint-3",
  "avatar-tint-4",
  "avatar-tint-5",
];

export function initialsFor(name: string): string {
  const parts = (name || "")
    .trim()
    .split(/\s+/)
    .filter((part) => /^[A-Za-z]/.test(part));
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Deterministic: the same person always gets the same tint, so the chip is a
// stable visual identity rather than a random colour per render.
function tintFor(name: string): string {
  const text = name || "";
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 997;
  }
  return TINTS[hash % TINTS.length];
}

export default function Avatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClass = size === "sm" ? " avatar-sm" : size === "lg" ? " avatar-lg" : "";
  return (
    <span className={`avatar ${tintFor(name)}${sizeClass}`} title={name} aria-hidden="true">
      {initialsFor(name)}
    </span>
  );
}
