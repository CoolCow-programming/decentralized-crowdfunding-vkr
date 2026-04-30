import { Link } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { useCampaignProgram } from '../hooks/useCampaignProgram';
import CampaignCard from '../components/CampaignCard';
import { formatSOL } from '../utils/constants';

export default function HomePage() {
  const { publicKey } = useWallet();
  const { campaigns, loading, error, fetchCampaigns } = useCampaignProgram();
  const totalRaised = campaigns.reduce(
    (sum, campaign) => sum + Number(campaign.data.totalPledged),
    0
  );
  const escrowBalance = campaigns.reduce(
    (sum, campaign) => sum + Number(campaign.data.currentAmount),
    0
  );
  const activeCampaigns = campaigns.filter((c) => c.data.state === 'active').length;
  const successfulCampaigns = campaigns.filter((c) => c.data.state === 'claimed' || c.data.state === 'successful').length;
  const awaitingSettlement = campaigns.filter((c) => c.data.state === 'active' && Number(c.data.endTime) * 1000 <= Date.now()).length;
  const milestoneCampaigns = campaigns.filter((c) => Number(c.data.milestoneCount) > 0).length;
  const refundedVolume = campaigns.reduce(
    (sum, campaign) => sum + Number(campaign.data.totalRefunded),
    0
  );

  return (
    <div>
      <div
        className="relative overflow-hidden rounded-md px-6 py-10 sm:px-10"
        style={{
          border: '1px solid var(--line)',
          background: 'var(--hero-bg)',
          boxShadow: 'var(--shadow)',
        }}
      >
        <div className="absolute inset-0 opacity-20" style={{ background: 'var(--hero-grid)', backgroundSize: '32px 32px' }} />
        <div className="absolute left-6 right-6 top-6 h-px" style={{ background: 'linear-gradient(90deg, rgba(201,136,85,0.42), rgba(201,136,85,0.04))' }} />
        <div className="absolute bottom-6 left-6 right-6 h-px" style={{ background: 'linear-gradient(90deg, rgba(140,185,195,0.16), transparent)' }} />
        <div className="relative grid gap-10 lg:grid-cols-[1.45fr_0.95fr] lg:items-end">
          <div>
            <p className="section-kicker">Crowdfunding Escrow</p>
            <h1 className="terminal-title mt-4 max-w-3xl text-4xl font-black leading-tight sm:text-5xl" style={{ color: 'var(--ink)' }}>
              Децентрализованная витрина
              <span className="block" style={{ color: 'var(--cyan)' }}>
                escrow-кампаний и on-chain расчётов
              </span>
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8" style={{ color: 'var(--muted)' }}>
              Интерфейс показывает не просто список проектов, а жизненный цикл средств: сбор, удержание в escrow, settlement, milestone release, dispute и возвраты.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="status-chip">Escrow Vault</span>
              <span className="status-chip">Milestone Release</span>
              <span className="status-chip">Lazy Refund</span>
              <span className="status-chip">Arbiter Dispute</span>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="info-strip">
                <p className="panel-heading">Статусы</p>
                <p className="mt-2 font-semibold" style={{ color: 'var(--ink)' }}>On-chain состояния</p>
              </div>
              <div className="info-strip">
                <p className="panel-heading">Средства</p>
                <p className="mt-2 font-semibold" style={{ color: 'var(--ink)' }}>Escrow balances</p>
              </div>
              <div className="info-strip">
                <p className="panel-heading">Действия</p>
                <p className="mt-2 font-semibold" style={{ color: 'var(--ink)' }}>Settlement и возвраты</p>
              </div>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              {publicKey ? (
                <Link to="/create" className="btn-primary inline-flex items-center">
                  Создать кампанию
                </Link>
              ) : (
                <div
                  className="rounded-md px-4 py-3 text-sm"
                  style={{ border: '1px solid var(--warn-border)', background: 'var(--warn-bg)', color: 'var(--warn-text)' }}
                >
                  Подключите кошелек, чтобы открыть доступ к созданию кампаний и pledge-операциям.
                </div>
              )}
              <button
                onClick={fetchCampaigns}
                className="btn-secondary inline-flex items-center text-sm"
              >
                Обновить данные
              </button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <div className="metric-tile">
              <p className="panel-heading">В escrow сейчас</p>
              <p className="mt-2 text-4xl font-black" style={{ color: 'var(--ink)' }}>{formatSOL(escrowBalance)} SOL</p>
            </div>
            <div className="metric-tile">
              <p className="panel-heading">Milestone кампаний</p>
              <p className="mt-2 text-4xl font-black" style={{ color: 'var(--cyan)' }}>{milestoneCampaigns}</p>
            </div>
            <div className="metric-tile">
              <p className="panel-heading">Собрано протоколом</p>
              <p className="mt-2 text-2xl font-black" style={{ color: 'var(--lime)' }}>{formatSOL(totalRaised)} SOL</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="glass-panel">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="section-kicker">Протокол</p>
              <h2 className="terminal-title mt-2 text-2xl font-bold" style={{ color: 'var(--ink)' }}>
                Что демонстрирует интерфейс
              </h2>
            </div>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Состояния и суммы читаются из on-chain аккаунтов программы
            </p>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="info-strip">
              <p className="panel-heading">Шаг 1</p>
              <p className="mt-2 font-semibold" style={{ color: 'var(--ink)' }}>Сбор средств</p>
              <p className="mt-2">Пожертвования отправляются не автору, а в `campaign vault` под управление смарт-контракта.</p>
            </div>
            <div className="info-strip">
              <p className="panel-heading">Шаг 2</p>
              <p className="mt-2 font-semibold" style={{ color: 'var(--ink)' }}>Условная выдача</p>
              <p className="mt-2">После успеха кампании деньги либо выдаются целиком, либо открывается milestone-flow с частичными release.</p>
            </div>
            <div className="info-strip">
              <p className="panel-heading">Шаг 3</p>
              <p className="mt-2 font-semibold" style={{ color: 'var(--ink)' }}>Возврат и спор</p>
              <p className="mt-2">При провале или отмене включается lazy refund, а спорные milestone могут перейти к арбитру.</p>
            </div>
          </div>
        </div>

        <div className="glass-panel">
          <p className="section-kicker">Сводка сети</p>
          <div className="mt-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="data-label">Кампаний в реестре</span>
              <span className="text-2xl font-black" style={{ color: 'var(--cyan)' }}>{campaigns.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="data-label">Активных</span>
              <span className="text-2xl font-black" style={{ color: 'var(--lime)' }}>{activeCampaigns}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="data-label">Успешных</span>
              <span className="text-2xl font-black" style={{ color: 'var(--lime)' }}>{successfulCampaigns}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="data-label">Ждут settlement</span>
              <span className="text-2xl font-black" style={{ color: 'var(--amber)' }}>{awaitingSettlement}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="data-label">Уже возвращено</span>
              <span className="text-2xl font-black" style={{ color: 'var(--danger)' }}>{formatSOL(refundedVolume)} SOL</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-4">
        <div className="card text-center">
          <p className="panel-heading">Реестр</p>
          <p className="mt-3 text-4xl font-bold" style={{ color: 'var(--cyan)' }}>{campaigns.length}</p>
          <p style={{ color: 'var(--muted)' }}>Всего кампаний</p>
        </div>
        <div className="card text-center">
          <p className="panel-heading">Escrow</p>
          <p className="mt-3 text-4xl font-bold" style={{ color: 'var(--lime)' }}>{formatSOL(escrowBalance)} SOL</p>
          <p style={{ color: 'var(--muted)' }}>Заблокировано в vault</p>
        </div>
        <div className="card text-center">
          <p className="panel-heading">Milestones</p>
          <p className="mt-3 text-4xl font-bold" style={{ color: 'var(--lime)' }}>{milestoneCampaigns}</p>
          <p style={{ color: 'var(--muted)' }}>Поэтапный release</p>
        </div>
        <div className="card text-center">
          <p className="panel-heading">Очередь</p>
          <p className="mt-3 text-4xl font-bold" style={{ color: 'var(--amber)' }}>{awaitingSettlement}</p>
          <p style={{ color: 'var(--muted)' }}>Ждут settlement</p>
        </div>
      </div>

      <div className="mt-12">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="section-kicker">Реестр кампаний</p>
            <h2 className="terminal-title mt-2 text-2xl font-bold" style={{ color: 'var(--ink)' }}>Все кампании</h2>
          </div>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Каждая карточка показывает on-chain статус, escrow-остаток, прогресс цели и режим расчётов
          </p>
        </div>

        {loading && (
          <div className="card py-12 text-center">
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2" style={{ borderColor: 'var(--cyan)' }} />
            <p className="mt-4" style={{ color: 'var(--muted)' }}>Загрузка кампаний...</p>
          </div>
        )}

        {error && (
          <div
            className="rounded-xl p-4"
            style={{ border: '1px solid var(--danger-border)', background: 'var(--danger-bg)', color: 'var(--danger-text)' }}
          >
            Ошибка: {error}
          </div>
        )}

        {!loading && !error && campaigns.length === 0 && (
          <div className="card py-12 text-center">
            <p className="text-lg" style={{ color: 'var(--ink)' }}>Пока нет кампаний</p>
            <p className="mt-2" style={{ color: 'var(--muted)' }}>
              Реестр пуст. Создайте первую кампанию и протестируйте escrow-поток.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((campaign) => (
            <CampaignCard
              key={campaign.pubkey.toBase58()}
              pubkey={campaign.pubkey}
              data={campaign.data}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
