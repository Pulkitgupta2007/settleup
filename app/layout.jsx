import './globals.css';
import SessionProvider from '../src/components/SessionProvider';

export const metadata = {
  title: 'SettleUp — Algorithmic Debt Simplification',
  description: 'Mathematical debt netting, append-only immutable financial ledger, and multi-currency settlement graph.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="light">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="bg-ledger-canvas text-bone font-sans antialiased selection:bg-credit/20 selection:text-credit min-h-screen">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
