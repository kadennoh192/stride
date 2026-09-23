export interface DeployedRelease {
  version: string;
  build: string;
  assetBuild?: string;
  date: string;
  summary: string;
  changes: Readonly<Record<string, readonly string[]>>;
}

export type UpdateStatus =
  | 'checking'
  | 'current'
  | 'available'
  | 'waiting'
  | 'offline'
  | 'error';

export function validReleaseManifest(value: unknown): value is DeployedRelease {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const release = value as Partial<DeployedRelease>;
  return (
    typeof release.version === 'string' &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release.version) &&
    typeof release.build === 'string' &&
    release.build.length > 0 &&
    typeof release.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(release.date) &&
    typeof release.summary === 'string' &&
    release.summary.length > 0 &&
    !!release.changes &&
    typeof release.changes === 'object' &&
    !Array.isArray(release.changes) &&
    Object.values(release.changes).every(
      (items) =>
        Array.isArray(items) &&
        items.every((item) => typeof item === 'string' && item.length > 0),
    )
  );
}

export function updateStatus(
  manifest: DeployedRelease,
  currentBuild: string,
  waiting: boolean,
): UpdateStatus {
  if (waiting) return 'waiting';
  return manifest.build === currentBuild ? 'current' : 'available';
}

export function activationBlockMessage(
  localDraft: boolean,
  otherTabDraft: boolean,
) {
  if (localDraft) return 'Save or close your open editor before updating.';
  if (otherTabDraft)
    return 'Another Stride tab has an open draft. Save it before updating.';
  return '';
}
