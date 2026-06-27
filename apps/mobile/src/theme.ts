export const colors = {
  background: "#FFFEFA",
  surface: "#FFFFFF",
  surfaceMuted: "#F4F7F3",
  accent: "#2C5745",
  accentPressed: "#214635",
  accentSoft: "#E8F0EB",
  text: "#161B18",
  textMuted: "#687168",
  border: "#D5DDD3",
  borderStrong: "#B8C5B9",
  danger: "#B42318",
  dangerSoft: "#FCEAE8",
  white: "#FFFFFF",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 999,
} as const;

export const typography = {
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "700" as const,
  },
  section: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700" as const,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400" as const,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600" as const,
  },
  caption: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "400" as const,
  },
} as const;
