export const currentRelease = {
  version: '0.3.0',
  build: '3ee7db6d566ade65',
  date: '2026-09-23',
  summary:
    'Local day planning, dashboard, weekly review, project health, and updated Gemini model selection.',
  changes: {
    Added: [
      'Smart day planning and 14-day rescheduling previews with capacity and dependency checks',
      'Configurable Today dashboard, weekly review, project health, and focus-based estimate suggestions',
      'Optional Open-Meteo weather with device-local location cache',
    ],
    Improved: [
      'Gemini model listing, selection, and clearer failure handling',
      'Planned starts separate from deadlines, including School assignments',
    ],
  },
} as const;
