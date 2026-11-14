import type { loadAppearance } from '#client/lib/study-client/appearance.ts';

export type AppearanceData = Awaited<ReturnType<typeof loadAppearance>>;
