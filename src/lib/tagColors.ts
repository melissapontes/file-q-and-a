// Tag color palette based on color wheel - 24 distinct hues for better variety
const TAG_COLORS = [
  { bg: "hsl(0 70% 50%)", fg: "hsl(0 0% 100%)" },      // Red
  { bg: "hsl(15 70% 50%)", fg: "hsl(0 0% 100%)" },     // Red-Orange
  { bg: "hsl(30 70% 50%)", fg: "hsl(0 0% 100%)" },     // Orange
  { bg: "hsl(45 70% 45%)", fg: "hsl(0 0% 100%)" },     // Yellow-Orange
  { bg: "hsl(60 65% 40%)", fg: "hsl(0 0% 100%)" },     // Yellow
  { bg: "hsl(75 55% 40%)", fg: "hsl(0 0% 100%)" },     // Yellow-Green light
  { bg: "hsl(90 50% 40%)", fg: "hsl(0 0% 100%)" },     // Yellow-Green
  { bg: "hsl(120 45% 40%)", fg: "hsl(0 0% 100%)" },    // Green
  { bg: "hsl(150 55% 40%)", fg: "hsl(0 0% 100%)" },    // Green-Teal
  { bg: "hsl(170 60% 40%)", fg: "hsl(0 0% 100%)" },    // Teal
  { bg: "hsl(185 65% 40%)", fg: "hsl(0 0% 100%)" },    // Cyan
  { bg: "hsl(200 70% 45%)", fg: "hsl(0 0% 100%)" },    // Blue-Cyan
  { bg: "hsl(215 65% 50%)", fg: "hsl(0 0% 100%)" },    // Blue
  { bg: "hsl(230 60% 50%)", fg: "hsl(0 0% 100%)" },    // Blue-Indigo
  { bg: "hsl(250 55% 55%)", fg: "hsl(0 0% 100%)" },    // Indigo
  { bg: "hsl(270 50% 50%)", fg: "hsl(0 0% 100%)" },    // Purple
  { bg: "hsl(285 50% 50%)", fg: "hsl(0 0% 100%)" },    // Purple-Magenta
  { bg: "hsl(300 50% 45%)", fg: "hsl(0 0% 100%)" },    // Magenta
  { bg: "hsl(315 55% 50%)", fg: "hsl(0 0% 100%)" },    // Magenta-Pink
  { bg: "hsl(330 60% 50%)", fg: "hsl(0 0% 100%)" },    // Pink
  { bg: "hsl(345 65% 50%)", fg: "hsl(0 0% 100%)" },    // Pink-Red
  { bg: "hsl(10 60% 45%)", fg: "hsl(0 0% 100%)" },     // Rust
  { bg: "hsl(180 50% 35%)", fg: "hsl(0 0% 100%)" },    // Dark Teal
  { bg: "hsl(260 45% 45%)", fg: "hsl(0 0% 100%)" },    // Violet
];

// Better hash function using djb2 algorithm for more uniform distribution
function hashString(str: string): number {
  const normalizedStr = str.toLowerCase().trim();
  let hash = 5381;
  for (let i = 0; i < normalizedStr.length; i++) {
    hash = ((hash << 5) + hash) ^ normalizedStr.charCodeAt(i);
  }
  return Math.abs(hash);
}

export function getTagColor(tagName: string): { bg: string; fg: string } {
  const index = hashString(tagName) % TAG_COLORS.length;
  return TAG_COLORS[index];
}
