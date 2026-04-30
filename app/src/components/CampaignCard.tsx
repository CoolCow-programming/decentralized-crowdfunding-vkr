import { Link } from 'react-router-dom';
import { PublicKey } from '@solana/web3.js';
import {
  Campaign,
  clampProgress,
  formatSOL,
  formatWalletAddress,
  getCampaignStateLabel,
  getCampaignStatus,
  getTimeRemaining,
} from '../utils/constants';

interface CampaignCardProps {
  pubkey: PublicKey;
  data: Campaign;
}

export default function CampaignCard({ pubkey, data }: CampaignCardProps) {
  const progress = clampProgress(data.totalPledged, data.goalAmount);
  const status = getCampaignStatus(data);
  const hasMilestones = Number(data.milestoneCount) > 0;
  const refunded = Number(data.totalRefunded) > 0;
  const released = Number(data.claimedAmount) > 0;
  const accentColor = status.isCancelled
    ? '#d37a72'
    : status.canEarlySettle || status.canSettle
      ? 'var(--amber)'
      : status.isClaimed
        ? 'var(--lime)'
        : 'var(--cyan)';

  return (
    <div className="card h-full transition-all hover:-translate-y-1">
      <Link to={`/campaign/${pubkey.toBase58()}`}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="section-kicker">Escrow campaign</p>
            <h3 className="terminal-title mt-2 line-clamp-1 text-xl font-bold" style={{ color: 'var(--ink)' }}>
              {data.title}
            </h3>
          </div>
          <span
            className="rounded-sm border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]"
            style={{
              borderColor: accentColor,
              background: 'rgba(255,255,255,0.02)',
              color: accentColor,
            }}
          >
            {status.canEarlySettle ? 'Можно завершить' : status.canSettle ? 'Ждёт расчёта' : getCampaignStateLabel(data.state)}
          </span>
        </div>

        <p className="mb-5 line-clamp-3 text-sm leading-6" style={{ color: 'var(--muted)' }}>
          {data.description}
        </p>

        <div className="mb-5 flex flex-wrap gap-2">
          <span className="status-chip">
            {hasMilestones ? `${data.milestoneCount.toString()} milestone` : 'Single-shot settlement'}
          </span>
          {released && (
            <span className="status-chip" style={{ background: 'rgba(168,255,93,0.1)', color: 'var(--lime)' }}>
              Выплаты были
            </span>
          )}
          {refunded && (
            <span className="status-chip" style={{ background: 'rgba(255,107,107,0.1)', color: '#ff9d9d' }}>
              Есть refund
            </span>
          )}
        </div>

        <div className="mb-4">
          <div className="mb-2 flex justify-between text-sm">
            <span style={{ color: 'var(--muted)' }}>
              {status.isCancelled
                ? 'Остановлена'
                : status.isClaimed
                ? 'Settlement завершён'
                : status.canEarlySettle
                ? 'Цель достигнута заранее'
                : status.canSettle
                ? 'Ожидает расчёта'
                : getTimeRemaining(data.endTime)}
            </span>
            <span className="font-bold" style={{ color: status.goalReached ? 'var(--lime)' : 'var(--cyan)' }}>
              {progress.toFixed(0)}%
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-sm" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--line-soft)' }}>
            <div
              className="h-full rounded-sm transition-all"
              style={{
                width: `${progress}%`,
                background: status.goalReached
                  ? 'linear-gradient(90deg, #8cb9c3 0%, #c5b28a 100%)'
                  : status.isCancelled
                  ? 'linear-gradient(90deg, #c7726a 0%, #c98855 100%)'
                  : 'linear-gradient(90deg, #6c8794 0%, #8cb9c3 100%)',
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-sm p-4" style={{ border: '1px solid var(--line)', background: 'var(--surface-soft)' }}>
            <p className="panel-heading">В escrow</p>
            <p className="mt-2 text-lg font-bold" style={{ color: 'var(--ink)' }}>{formatSOL(data.currentAmount)} SOL</p>
          </div>
          <div className="rounded-sm p-4 text-right" style={{ border: '1px solid var(--line)', background: 'var(--surface-soft)' }}>
            <p className="panel-heading">Собрано всего</p>
            <p className="mt-2 text-lg font-bold" style={{ color: 'var(--ink)' }}>{formatSOL(data.totalPledged)} SOL</p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-sm p-4" style={{ border: '1px solid var(--line-soft)', background: 'rgba(255,255,255,0.02)' }}>
            <p className="panel-heading">Возвраты</p>
            <p className="mt-2 text-base font-bold" style={{ color: refunded ? '#ffb9b9' : 'var(--ink)' }}>
              {formatSOL(data.totalRefunded)} SOL
            </p>
          </div>
          <div className="rounded-sm p-4 text-right" style={{ border: '1px solid var(--line-soft)', background: 'rgba(255,255,255,0.02)' }}>
            <p className="panel-heading">Выдано автору</p>
            <p className="mt-2 text-base font-bold" style={{ color: released ? 'var(--lime)' : 'var(--ink)' }}>
              {formatSOL(data.claimedAmount)} SOL
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between border-t pt-4 text-sm" style={{ borderColor: 'var(--line)' }}>
          <div>
            <p className="panel-heading">Создатель</p>
            <p className="mt-1 font-mono" style={{ color: 'var(--cyan)' }}>{formatWalletAddress(data.creator, 8, 6)}</p>
          </div>
          <div className="text-right">
            <p className="panel-heading">Переход</p>
            <p className="mt-1" style={{ color: 'var(--ink)' }}>
              {hasMilestones ? 'Milestone / Dispute' : 'Claim / Refund'}
            </p>
          </div>
        </div>
      </Link>
    </div>
  );
}
