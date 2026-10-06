/** This boundary is fixed for this release. Never derive it from a build or settings. */
export const RESET_GENERATION = 'stride-notes-2026-10-05';
export const SYNC_PROTOCOL = 4;
export const RESET_HEADER = 'X-Stride-Generation';
export const generationHeaders = { [RESET_HEADER]: RESET_GENERATION };
export const PRE_RESET_BACKUP_MESSAGE =
  'This backup predates the permanent workspace reset and is incompatible with this version of Stride.';
