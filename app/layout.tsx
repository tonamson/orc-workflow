import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { StudioProvider } from '../features/studio/StudioProvider';
import './globals.css';

export const metadata: Metadata = { title: 'ORC Studio', description: 'ORC Studio UI demo' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="vi"><body><StudioProvider>{children}</StudioProvider></body></html>;
}
