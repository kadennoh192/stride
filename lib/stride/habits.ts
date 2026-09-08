/** Preserve existing habit-log identities while bounding imported maximum IDs. */
export async function habitLogId(habit: string, date: string) {
  const legacy = `habitlog-${habit}-${date}`;
  if (legacy.length <= 150) return legacy;
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${habit}\n${date}`),
  );
  const hash = [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `habitlog-${hash.slice(0, 40)}`;
}
