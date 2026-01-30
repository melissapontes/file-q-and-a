// Tag color palette based on color wheel - 12 distinct hues
const TAG_COLORS = [
  { bg: "hsl(0 70% 50%)", fg: "hsl(0 0% 100%)" },      // Red
  { bg: "hsl(30 70% 50%)", fg: "hsl(0 0% 100%)" },     // Orange
  { bg: "hsl(45 70% 45%)", fg: "hsl(0 0% 100%)" },     // Yellow-Orange
  { bg: "hsl(60 70% 40%)", fg: "hsl(0 0% 100%)" },     // Yellow
  { bg: "hsl(90 50% 40%)", fg: "hsl(0 0% 100%)" },     // Yellow-Green
  { bg: "hsl(120 50% 40%)", fg: "hsl(0 0% 100%)" },    // Green
  { bg: "hsl(160 60% 40%)", fg: "hsl(0 0% 100%)" },    // Teal
  { bg: "hsl(200 70% 45%)", fg: "hsl(0 0% 100%)" },    // Blue
  { bg: "hsl(230 60% 50%)", fg: "hsl(0 0% 100%)" },    // Blue-Purple
  { bg: "hsl(270 50% 50%)", fg: "hsl(0 0% 100%)" },    // Purple
  { bg: "hsl(300 50% 45%)", fg: "hsl(0 0% 100%)" },    // Magenta
  { bg: "hsl(330 60% 50%)", fg: "hsl(0 0% 100%)" },    // Pink
];

// Simple hash function for consistent color assignment
function hashString(str: string): number {
  let hash = 0;
  const normalizedStr = str.toLowerCase().trim();
  for (let i = 0; i < normalizedStr.length; i++) {
    const char = normalizedStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

export function getTagColor(tagName: string): { bg: string; fg: string } {
  const index = hashString(tagName) % TAG_COLORS.length;
  return TAG_COLORS[index];
}
