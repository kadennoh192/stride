import { useSyncExternalStore } from 'react';
const query = '(max-width: 767px)';
function subscribe(notify: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
}
function getSnapshot() {
  return window.matchMedia(query).matches;
}
export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
