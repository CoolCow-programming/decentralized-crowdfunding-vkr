import { FC, useEffect, useMemo, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import '@solana/wallet-adapter-react-ui/styles.css';

import HomePage from './pages/HomePage';
import CreateCampaignPage from './pages/CreateCampaignPage';
import CampaignDetailsPage from './pages/CampaignDetailsPage';

const App: FC = () => {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') {
      return 'dark';
    }
    const saved = window.localStorage.getItem('ce-theme');
    return saved === 'light' ? 'light' : 'dark';
  });
  const appEnv = (import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  }).env;

  const endpoint = useMemo(
    () => appEnv?.VITE_SOLANA_RPC_URL || 'http://127.0.0.1:8899',
    []
  );

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('ce-theme', theme);
  }, [theme]);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <div className="min-h-screen" style={{ background: 'var(--app-bg)' }}>
              <header
                className="sticky top-0 z-50 border-b backdrop-blur-xl"
                style={{
                  borderColor: 'var(--line)',
                  background: 'var(--header-bg)',
                  boxShadow: '0 8px 28px rgba(0,0,0,0.18)',
                }}
              >
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                  <div className="flex h-16 items-center justify-between">
                    <Link to="/" className="flex items-center space-x-3">
                      <span
                        className="flex h-11 w-11 items-center justify-center rounded-sm border text-sm font-bold"
                        style={{
                          color: 'var(--ink)',
                          borderColor: 'var(--line-strong)',
                          background: 'var(--panel-soft-bg)',
                        }}
                      >
                        CE
                      </span>
                      <div>
                        <p className="panel-heading">Crowdfunding Escrow</p>
                        <span className="terminal-title text-xl font-bold" style={{ color: 'var(--ink)' }}>
                          Пульт кампаний
                        </span>
                      </div>
                    </Link>

                    <nav className="flex items-center space-x-4">
                      <Link to="/" className="transition-colors hover:opacity-80" style={{ color: 'var(--muted)' }}>
                        Кампании
                      </Link>
                      <Link to="/create" className="transition-colors hover:opacity-80" style={{ color: 'var(--muted)' }}>
                        Создать
                      </Link>
                      <button
                        type="button"
                        onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
                        className="btn-secondary px-4 py-2 text-xs"
                        aria-label={theme === 'dark' ? 'Переключить на светлую тему' : 'Переключить на тёмную тему'}
                      >
                        {theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
                      </button>
                      <WalletMultiButton />
                    </nav>
                  </div>
                </div>
              </header>

              <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/create" element={<CreateCampaignPage />} />
                  <Route path="/campaign/:id" element={<CampaignDetailsPage />} />
                </Routes>
              </main>

              <footer
                className="mt-12 border-t"
                style={{
                  borderColor: 'var(--line)',
                  background: 'var(--footer-bg)',
                }}
              >
                <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
                  <div className="flex flex-col items-center gap-2 text-center">
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>
                      Сеть приложения • {endpoint.includes('127.0.0.1') || endpoint.includes('localhost') ? 'Localnet' : endpoint}
                    </p>
                  </div>
                </div>
              </footer>
            </div>
          </Router>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default App;
