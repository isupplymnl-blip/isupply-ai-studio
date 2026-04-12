import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'iSupply AI Studio',
  description: 'Node-based AI orchestration engine for automated product photography carousel ads.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" style={{ height: '100%' }}>
      <body style={{ height: '100%', margin: 0 }}>{children}</body>
    </html>
  );
}
