import type { ReactNode } from 'react';
import { MapRepositoryProvider } from './providers/MapRepositoryProvider';

export const metadata = {
  title: 'MindSprout',
  description: 'AI 驱动的思维导图生成器',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <MapRepositoryProvider>{children}</MapRepositoryProvider>
      </body>
    </html>
  );
}
