import type { Metadata, Viewport } from 'next';
import WatchLink from '@/components/stride/watch-link';

export const metadata: Metadata = {
  title: 'Stride Watch Link',
  description: 'A compact online companion for your private Stride workspace.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function WatchPage() {
  return <WatchLink />;
}
