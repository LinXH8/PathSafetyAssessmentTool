// Generate a consistent, bright, varied color for each unique tag.
// Shared by both the v1 and v2 Projects layout shells.
export function getTagColor(tag: string): string {
  // Simple hash function to convert string to number
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Use multiple hash variations to increase color variety
  const hash2 = Math.abs(hash >> 16);
  const hash3 = Math.abs(hash << 3);

  // Create wider hue distribution with warm and cool colors
  // Avoid muddy middle ranges (40-60 yellow-green, 160-180 cyan)
  let hue = Math.abs(hash % 360);
  if (hue >= 40 && hue <= 60) hue = (hue + 30) % 360;  // Skip muddy yellow-green
  if (hue >= 160 && hue <= 180) hue = (hue + 30) % 360; // Skip muddy cyan

  // Higher saturation (75-95%) for more vibrant colors
  const saturation = 75 + (hash2 % 21); // 75-95%

  // Lightness 38-52%: dark enough for white text to pass contrast, not pastel
  const lightness = 38 + (hash3 % 15); // 38-52%

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

// Pre/Post-aware FILL color, used by the treatment analysis pages. "Pre"/"Post"
// get fixed subtle orange/green; every other tag falls back to the hash color.
export function getTagFillColor(tag: string): string {
  if (tag === "Pre") return "#fed7aa"; // orange.subtle
  if (tag === "Post") return "#bbf7d0"; // green.subtle
  return getTagColor(tag);
}

// Pre/Post-aware BORDER color, paired with getTagFillColor on the treatment
// analysis pages. Non-Pre/Post tags get a neutral translucent border.
export function getTagBorderColor(tag: string): string {
  if (tag === "Pre") return "#fb923c"; // orange.emphasized
  if (tag === "Post") return "#22c55e"; // green.emphasized
  return "rgba(0, 0, 0, 0.1)";
}
