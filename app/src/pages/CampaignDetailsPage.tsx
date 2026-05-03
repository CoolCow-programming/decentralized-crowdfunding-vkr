import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useCampaignProgram, decodeCampaign } from '../hooks/useCampaignProgram';
import {
  Campaign,
  Milestone,
  Pledge,
  clampProgress,
  formatSOL,
  formatTime,
  formatWalletAddress,
  getCampaignStateLabel,
  getCampaignStatus,
  getTimeRemaining,
  getMilestoneStateLabel,
} from '../utils/constants';

type NoticeTone = 'success' | 'error';

interface PageNotice {
  tone: NoticeTone;
  message: string;
}

interface ActionAvailability {
  visible: boolean;
  enabled: boolean;
  reason?: string;
}

function getMilestoneNextStep(
  milestone: Milestone,
  campaign: Campaign,
  isOwner: boolean,
  hasWallet: boolean,
  isArbiter: boolean
): { tone: NoticeTone; message: string } {
  if (milestone.state === 'pending') {
    if (campaign.state !== 'successful') {
      return {
        tone: 'error',
        message: 'Этап создан, но ещё не запущен. Сначала доведите кампанию до Successful через settlement после достижения цели или дедлайна, затем станет доступна кнопка Submit milestone.',
      };
    }

    if (!isOwner) {
      return {
        tone: 'error',
        message: 'Этап ждёт запуска создателем кампании. Под кошельком создателя появится кнопка Submit milestone.',
      };
    }

    if (!hasWallet) {
      return {
        tone: 'error',
        message: 'Подключите кошелёк создателя кампании, чтобы запустить этап кнопкой Submit milestone.',
      };
    }

    return {
      tone: 'success',
      message: 'Этап готов к запуску. Нажмите Submit milestone, чтобы открыть голосование бэкеров.',
    };
  }

  if (milestone.state === 'readyForReview') {
    if (!hasWallet) {
      return {
        tone: 'error',
        message: 'Review уже открыт. Подключите кошелёк, чтобы проголосовать или завершить review.',
      };
    }

    if (isOwner) {
      return {
        tone: 'success',
        message: 'Этап находится на review. Дождитесь голосов бэкеров и затем нажмите Finalize review.',
      };
    }

    return {
      tone: 'success',
      message: 'Этап находится на review. Вы можете проголосовать за или против, затем любой подключённый участник может вызвать Finalize review.',
    };
  }

  if (milestone.state === 'approved') {
    if (isOwner) {
      return {
        tone: 'success',
        message: 'Этап одобрен. Теперь можно вывести эту часть средств кнопкой Release funds.',
      };
    }

    return {
      tone: 'success',
      message: 'Этап одобрен. Следующий шаг за создателем кампании: Release funds.',
    };
  }

  if (milestone.state === 'released') {
    return {
      tone: 'success',
      message: 'Средства по этапу уже выведены из escrow-vault.',
    };
  }

  if (milestone.state === 'rejected') {
    if (isOwner) {
      return {
        tone: 'error',
        message: 'Этап отклонён. Можно повторно отправить его на review, открыть dispute или перевести кампанию в refunds.',
      };
    }

    return {
      tone: 'error',
      message: 'Этап отклонён. Дальнейшее действие принимает создатель кампании: повторная отправка, dispute или refunds.',
    };
  }

  if (milestone.state === 'disputed') {
    if (isArbiter) {
      return {
        tone: 'success',
        message: 'Открыт спор. Под кошельком арбитра доступны Arbiter approve и Arbiter refunds.',
      };
    }

    return {
      tone: 'error',
      message: 'Открыт спор. Финальное решение должен принять арбитр.',
    };
  }

  return {
    tone: 'error',
    message: 'Состояние этапа требует ручной проверки.',
  };
}

export default function CampaignDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const {
    pledge,
    cancelPledge,
    cancelCampaign,
    claim,
    settleCampaign,
    configAccount,
    error,
    milestones,
    fetchMilestones,
    fetchPledgeAccount,
    createMilestone,
    submitMilestone,
    voteMilestone,
    finalizeMilestone,
    releaseMilestoneFunds,
    failCampaignAndOpenRefunds,
    openDispute,
    resolveDispute,
  } = useCampaignProgram();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [campaignPubkey, setCampaignPubkey] = useState<PublicKey | null>(null);
  const [viewerPledge, setViewerPledge] = useState<Pledge | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<PageNotice | null>(null);
  const [pledgeAmount, setPledgeAmount] = useState('');
  const [milestoneTitle, setMilestoneTitle] = useState('');
  const [milestoneDescription, setMilestoneDescription] = useState('');
  const [milestoneAmount, setMilestoneAmount] = useState('');
  const [milestoneVotingEnd, setMilestoneVotingEnd] = useState('');

  useEffect(() => {
    if (id) {
      fetchCampaign(new PublicKey(id));
    }
  }, [id]);

  const fetchCampaign = async (pubkey: PublicKey) => {
    try {
      setLoading(true);
      setSubmitError(null);
      const accountInfo = await connection.getAccountInfo(pubkey);
      if (!accountInfo) {
        setSubmitError('Кампания не найдена');
        return;
      }
      const data = decodeCampaign(accountInfo.data);
      setCampaign(data);
      setCampaignPubkey(pubkey);
      await fetchMilestones(pubkey);
      if (publicKey) {
        const pledgeAccount = await fetchPledgeAccount(pubkey, publicKey);
        setViewerPledge(pledgeAccount);
      } else {
        setViewerPledge(null);
      }
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Не удалось загрузить кампанию');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (campaignPubkey) {
      fetchCampaign(campaignPubkey);
    } else {
      setViewerPledge(null);
    }
  }, [publicKey]);

  const status = useMemo(
    () => (campaign ? getCampaignStatus(campaign, publicKey) : null),
    [campaign, publicKey]
  );

  const showBlockedAction = (message: string) => {
    setSubmitError(null);
    setNotice({ tone: 'error', message });
  };

  const handlePledge = async () => {
    if (!publicKey || !campaignPubkey) {
      setSubmitError('Необходимо подключить кошелек');
      return;
    }
    const amount = parseFloat(pledgeAmount);
    if (isNaN(amount) || amount <= 0) {
      setSubmitError('Введите корректную сумму');
      return;
    }
    if (amount < 0.01) {
      setSubmitError('Для удобства интерфейса минимальный взнос установлен на уровне 0.01 SOL');
      return;
    }
    setProcessing(true);
    setSubmitError(null);
    setNotice(null);
    try {
      const success = await pledge(campaignPubkey, amount);
      if (success) {
        await fetchCampaign(campaignPubkey);
        setPledgeAmount('');
        setNotice({ tone: 'success', message: 'Взнос успешно отправлен в escrow-vault.' });
      }
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Ошибка при внесении взноса');
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelCampaign = async () => {
    if (!publicKey || !campaignPubkey || !campaign) {
      showBlockedAction('Подключите кошелёк и дождитесь загрузки кампании.');
      return;
    }
    if (!(campaign.state === 'active' && Number(campaign.endTime) * 1000 > Date.now() && publicKey.equals(campaign.creator))) {
      showBlockedAction('Отмена доступна только создателю, пока кампания ещё активна и не дошла до дедлайна.');
      return;
    }
    setProcessing(true);
    setSubmitError(null);
    setNotice(null);
    try {
      const success = await cancelCampaign(campaignPubkey);
      if (success) {
        await fetchCampaign(campaignPubkey);
        setNotice({ tone: 'success', message: 'Кампания отменена. Спонсоры теперь могут вернуть средства.' });
      }
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Ошибка при отмене кампании');
    } finally {
      setProcessing(false);
    }
  };

  const handleClaim = async () => {
    if (!publicKey || !campaignPubkey || !campaign) {
      showBlockedAction('Подключите кошелёк и дождитесь загрузки кампании.');
      return;
    }
    if (!publicKey.equals(campaign.creator)) {
      showBlockedAction('Получение средств доступно только создателю кампании.');
      return;
    }
    if (Number(campaign.milestoneCount) > 0) {
      showBlockedAction('Для кампаний с milestones используется поэтапная выдача через release milestone funds, а не общий claim.');
      return;
    }
    if (!(campaign.state === 'successful' || (campaign.state === 'active' && Number(campaign.totalPledged) >= Number(campaign.goalAmount)))) {
      showBlockedAction('Получение средств станет доступно после успешного завершения кампании или досрочного достижения цели.');
      return;
    }
    if (!configAccount) {
      showBlockedAction('Конфигурация протокола не инициализирована. Выполните `yarn init:localnet-config`.');
      return;
    }
    setProcessing(true);
    setSubmitError(null);
    setNotice(null);
    try {
      const success = await claim(campaignPubkey);
      if (success) {
        await fetchCampaign(campaignPubkey);
        setNotice({ tone: 'success', message: 'Средства переведены создателю кампании.' });
      }
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Ошибка при получении средств');
    } finally {
      setProcessing(false);
    }
  };

  const handleSettle = async () => {
    if (!publicKey || !campaignPubkey || !campaign) {
      showBlockedAction('Подключите кошелёк и дождитесь загрузки кампании.');
      return;
    }
    if (campaign.state !== 'active') {
      showBlockedAction('Settlement нужен только для активной кампании. Эта кампания уже находится в терминальном состоянии.');
      return;
    }
    if (!(Number(campaign.totalPledged) >= Number(campaign.goalAmount) || Number(campaign.endTime) * 1000 <= Date.now())) {
      showBlockedAction('Settlement станет доступен после достижения цели или после наступления дедлайна кампании.');
      return;
    }
    if (!configAccount) {
      showBlockedAction('Конфигурация протокола не инициализирована. Выполните `yarn init:localnet-config`.');
      return;
    }
    setProcessing(true);
    setSubmitError(null);
    setNotice(null);
    try {
      const success = await settleCampaign(campaignPubkey, campaign.creator);
      if (success) {
        await fetchCampaign(campaignPubkey);
        setNotice({ tone: 'success', message: 'Settlement выполнен. Состояние кампании обновлено on-chain.' });
      }
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Ошибка при settlement');
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelPledge = async () => {
    if (!publicKey || !campaignPubkey || !campaign) {
      showBlockedAction('Подключите кошелёк и дождитесь загрузки кампании.');
      return;
    }
    if (!viewerPledge || viewerPledge.amount === 0n || viewerPledge.isRefunded) {
      showBlockedAction('У текущего кошелька нет активного взноса для возврата в этой кампании.');
      return;
    }
    if (!(campaign.state === 'failed' || campaign.state === 'cancelled')) {
      showBlockedAction(
        Number(campaign.endTime) * 1000 <= Date.now() && Number(campaign.totalPledged) < Number(campaign.goalAmount)
          ? 'Сбор уже закончился без достижения цели, но сначала нужен settlement, чтобы перевести кампанию в Failed и открыть возвраты.'
          : 'Возврат доступен только после перевода кампании в Failed или Cancelled.'
      );
      return;
    }
    setProcessing(true);
    setSubmitError(null);
    setNotice(null);
    try {
      const success = await cancelPledge(campaignPubkey);
      if (success) {
        await fetchCampaign(campaignPubkey);
        setNotice({ tone: 'success', message: 'Взнос успешно возвращён на ваш кошелёк.' });
      }
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Ошибка при возврате взноса');
    } finally {
      setProcessing(false);
    }
  };

  const handleCreateMilestone = async () => {
    if (!publicKey || !campaignPubkey || !campaign) {
      showBlockedAction('Подключите кошелёк и дождитесь загрузки кампании.');
      return;
    }
    if (!publicKey.equals(campaign.creator)) {
      showBlockedAction('Milestone может добавлять только создатель кампании.');
      return;
    }
    if (!(campaign.state === 'active' || campaign.state === 'successful')) {
      showBlockedAction('Новые milestones можно добавлять только пока кампания активна или уже успешно собрана, но ещё не закрыта этапами.');
      return;
    }

    const amount = parseFloat(milestoneAmount);
    const votingEndUnix = Math.floor(new Date(milestoneVotingEnd).getTime() / 1000);

    if (!milestoneTitle.trim() || !milestoneDescription.trim()) {
      setSubmitError('Заполните название и описание этапа');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setSubmitError('Введите корректную сумму этапа');
      return;
    }
    if (!Number.isFinite(votingEndUnix)) {
      setSubmitError('Введите корректный дедлайн голосования');
      return;
    }

    setProcessing(true);
    setSubmitError(null);
    setNotice(null);

    try {
      const success = await createMilestone(
        campaignPubkey,
        milestones.length,
        milestoneTitle.trim(),
        milestoneDescription.trim(),
        amount,
        votingEndUnix
      );

      if (success) {
        await fetchCampaign(campaignPubkey);
        setMilestoneTitle('');
        setMilestoneDescription('');
        setMilestoneAmount('');
        setMilestoneVotingEnd('');
        setNotice({ tone: 'success', message: 'Milestone добавлен в on-chain конфигурацию кампании.' });
      }
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Ошибка при создании milestone');
    } finally {
      setProcessing(false);
    }
  };

  const runMilestoneAction = async (
    action: () => Promise<boolean>,
    successMessage: string
  ) => {
    if (!campaignPubkey) return;

    setProcessing(true);
    setSubmitError(null);
    setNotice(null);

    try {
      const success = await action();
      if (success) {
        await fetchCampaign(campaignPubkey);
        setNotice({ tone: 'success', message: successMessage });
      }
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Ошибка при выполнении milestone-действия');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2" style={{ borderColor: 'var(--cyan)' }} />
        <p className="mt-4" style={{ color: 'var(--muted)' }}>Загрузка...</p>
      </div>
    );
  }

  if (!campaign || !campaignPubkey) {
    return (
      <div className="py-12 text-center">
        <p className="text-lg" style={{ color: 'var(--muted)' }}>{submitError || 'Кампания не найдена'}</p>
        <button onClick={() => navigate('/')} className="btn-primary mt-4">
          В реестр кампаний
        </button>
      </div>
    );
  }

  const progress = clampProgress(campaign.totalPledged, campaign.goalAmount);
  const statusValue = status ?? getCampaignStatus(campaign, publicKey);
  const viewerHasRefundablePledge = !!viewerPledge && viewerPledge.amount > 0n && !viewerPledge.isRefunded;
  const feePercent = configAccount ? configAccount.feeBps / 100 : null;
  const isArbiter = publicKey && configAccount ? publicKey.equals(configAccount.arbiter) : false;
  const milestoneCoverage = clampProgress(campaign.milestoneAmountTotal, campaign.goalAmount);
  const nextMilestoneIndex = milestones.length;
  const remainingMilestoneBudget = Math.max(0, Number(campaign.goalAmount - campaign.milestoneAmountTotal) / 1_000_000_000);
  const minVotingEnd = new Date(Date.now() + 60000).toISOString().slice(0, 16);
  const milestoneFlowStage = campaign.state === 'successful'
    ? 'Сбор завершён успешно. Теперь этапы можно запускать на review и выпускать по ним средства.'
    : campaign.state === 'active'
      ? 'Пока идёт сбор, milestones только настраиваются. Запуск review станет доступен после перехода кампании в Successful.'
      : 'Milestone-flow использует этапную выдачу после Successful. В текущем состоянии новые действия зависят от статуса этапов ниже.';
  const claimAction: ActionAvailability = statusValue.isOwner || !publicKey
    ? {
        visible: !statusValue.hasMilestones && (statusValue.isOwner || campaign.state === 'successful' || statusValue.goalReached),
        enabled:
          !!publicKey &&
          statusValue.isOwner &&
          !statusValue.hasMilestones &&
          !!configAccount &&
          (campaign.state === 'successful' || statusValue.canEarlySettle),
        reason:
          !publicKey
            ? 'Подключите кошелёк создателя.'
            : !statusValue.isOwner
              ? 'Получение средств доступно только создателю.'
              : statusValue.hasMilestones
                ? 'Для этой кампании действует milestone-flow с поэтапной выдачей.'
                : !configAccount
                  ? 'Нужно инициализировать protocol config.'
                  : !(campaign.state === 'successful' || statusValue.canEarlySettle)
                    ? 'Средства можно получить только после успеха кампании.'
                    : undefined,
      }
    : { visible: false, enabled: false };
  const settleAction: ActionAvailability = {
    visible: !!publicKey && statusValue.canSettle,
    enabled: !!publicKey && statusValue.canSettle && !!configAccount && campaign.state === 'active',
    reason: !publicKey
      ? 'Подключите кошелёк.'
      : !configAccount
        ? 'Нужно инициализировать protocol config.'
        : campaign.state !== 'active'
          ? 'Settlement уже не требуется: кампания не активна.'
          : undefined,
  };
  const refundAction: ActionAvailability = {
    visible: !!publicKey && (viewerHasRefundablePledge || statusValue.canRefund || statusValue.refundPendingSettlement),
    enabled: !!publicKey && viewerHasRefundablePledge && statusValue.canRefund,
    reason: !publicKey
      ? 'Подключите кошелёк спонсора.'
      : !viewerHasRefundablePledge
        ? 'У текущего кошелька нет активного pledge в этой кампании.'
        : statusValue.refundPendingSettlement
          ? 'Сначала кто-то должен выполнить settlement, чтобы кампания перешла в Failed и открыла возвраты.'
          : !statusValue.canRefund
            ? 'Возврат доступен только в состояниях Failed или Cancelled.'
            : undefined,
  };
  const cancelCampaignAction: ActionAvailability = {
    visible: !!publicKey && statusValue.isOwner,
    enabled: !!publicKey && statusValue.canCancelCampaign,
    reason: !publicKey
      ? 'Подключите кошелёк создателя.'
      : !statusValue.isOwner
        ? 'Отмена доступна только создателю.'
        : !statusValue.canCancelCampaign
          ? 'Отменить можно только активную кампанию до дедлайна.'
          : undefined,
  };

  return (
    <div className="mx-auto max-w-5xl">
      <button onClick={() => navigate('/')} className="mb-6 text-sm uppercase tracking-[0.16em]" style={{ color: 'var(--muted)' }}>
        ← назад в реестр
      </button>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="card">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
            <p className="section-kicker">Карточка кампании</p>
              <h1 className="terminal-title mt-3 text-3xl font-bold" style={{ color: 'var(--ink)' }}>{campaign.title}</h1>
              <p className="mt-3 max-w-2xl leading-7" style={{ color: 'var(--muted)' }}>{campaign.description}</p>
            </div>

            <div className="rounded-xl px-4 py-3" style={{ border: '1px solid var(--line)', background: 'var(--panel-soft-bg)' }}>
              <p className="panel-heading">Статус</p>
              <p className="mt-2 text-sm font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--cyan)' }}>
                {getCampaignStateLabel(campaign.state)}
              </p>
            </div>
          </div>

          <div className="mb-8 rounded-xl p-5" style={{ border: '1px solid var(--line)', background: 'var(--panel-bg)' }}>
            <div className="mb-3 flex justify-between text-sm">
              <span style={{ color: 'var(--muted)' }}>{getTimeRemaining(campaign.endTime)}</span>
              <span className="font-bold" style={{ color: statusValue.goalReached ? 'var(--lime)' : 'var(--cyan)' }}>
                {progress.toFixed(1)}%
              </span>
            </div>
            <div className="h-4 w-full overflow-hidden rounded-full" style={{ background: 'var(--progress-track)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${progress}%`,
                  background: statusValue.goalReached
                    ? 'linear-gradient(90deg, #49d6ff 0%, #a8ff5d 100%)'
                    : 'linear-gradient(90deg, #00e0ff 0%, #49d6ff 100%)',
                  boxShadow: '0 0 24px rgba(73,214,255,0.18)',
                }}
              />
            </div>
          </div>

          <div className="mb-8 flex flex-wrap gap-2">
            <span className="rounded-md px-3 py-1 text-sm uppercase tracking-[0.14em]" style={{ background: 'var(--chip-bg)', color: 'var(--cyan)' }}>
              {getCampaignStateLabel(campaign.state)}
            </span>
            {statusValue.canEarlySettle && (
              <span className="rounded-md px-3 py-1 text-sm uppercase tracking-[0.14em]" style={{ background: 'var(--success-bg)', color: 'var(--success-text)' }}>
                Можно завершить досрочно
              </span>
            )}
            {statusValue.canSettle && (
              <span className="rounded-md px-3 py-1 text-sm uppercase tracking-[0.14em]" style={{ background: 'var(--warn-bg)', color: 'var(--warn-text)' }}>
                Ожидает settlement
              </span>
            )}
            {statusValue.goalReached && (
              <span className="rounded-md px-3 py-1 text-sm uppercase tracking-[0.14em]" style={{ background: 'var(--success-bg)', color: 'var(--success-text)' }}>
                Цель достигнута
              </span>
            )}
          </div>

          <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-xl p-4" style={{ border: '1px solid var(--line)', background: 'var(--panel-bg)' }}>
              <p className="panel-heading">В escrow</p>
              <p className="mt-2 text-xl font-bold" style={{ color: 'var(--ink)' }}>{formatSOL(campaign.currentAmount)} SOL</p>
            </div>
            <div className="rounded-xl p-4" style={{ border: '1px solid var(--line)', background: 'var(--panel-bg)' }}>
              <p className="panel-heading">Собрано всего</p>
              <p className="mt-2 text-xl font-bold" style={{ color: 'var(--ink)' }}>{formatSOL(campaign.totalPledged)} SOL</p>
            </div>
            <div className="rounded-xl p-4" style={{ border: '1px solid var(--line)', background: 'var(--panel-bg)' }}>
              <p className="panel-heading">Цель</p>
              <p className="mt-2 text-xl font-bold" style={{ color: 'var(--ink)' }}>{formatSOL(campaign.goalAmount)} SOL</p>
            </div>
            <div className="rounded-xl p-4" style={{ border: '1px solid var(--line)', background: 'var(--panel-bg)' }}>
              <p className="panel-heading">Дата окончания</p>
              <p className="mt-2 text-sm font-bold" style={{ color: 'var(--ink)' }}>{formatTime(campaign.endTime)}</p>
            </div>
          </div>

          <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-xl p-4" style={{ border: '1px solid var(--line)', background: 'var(--panel-soft-bg)' }}>
              <p className="panel-heading">Спонсоров</p>
              <p className="mt-2 text-xl font-bold" style={{ color: 'var(--cyan)' }}>{campaign.backersCount.toString()}</p>
            </div>
            <div className="rounded-xl p-4" style={{ border: '1px solid var(--line)', background: 'var(--panel-soft-bg)' }}>
              <p className="panel-heading">Возвращено</p>
              <p className="mt-2 text-xl font-bold" style={{ color: 'var(--ink)' }}>{formatSOL(campaign.totalRefunded)} SOL</p>
            </div>
            <div className="rounded-xl p-4" style={{ border: '1px solid var(--line)', background: 'var(--panel-soft-bg)' }}>
              <p className="panel-heading">Выплачено автору</p>
              <p className="mt-2 text-xl font-bold" style={{ color: 'var(--ink)' }}>{formatSOL(campaign.claimedAmount)} SOL</p>
            </div>
            <div className="rounded-xl p-4" style={{ border: '1px solid var(--line)', background: 'var(--panel-soft-bg)' }}>
              <p className="panel-heading">Комиссия платформы</p>
              <p className="mt-2 text-xl font-bold" style={{ color: 'var(--ink)' }}>{feePercent === null ? '...' : `${feePercent.toFixed(2)}%`}</p>
            </div>
          </div>

          {configAccount && (
            <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-xl p-4" style={{ border: '1px solid var(--line)', background: 'var(--panel-soft-bg)' }}>
                <p className="panel-heading">Arbiter</p>
                <p className="mt-2 break-all font-mono text-sm" style={{ color: 'var(--cyan)' }}>
                  {formatWalletAddress(configAccount.arbiter, 12, 10)}
                </p>
              </div>
              <div className="rounded-xl p-4" style={{ border: '1px solid var(--line)', background: 'var(--panel-soft-bg)' }}>
                <p className="panel-heading">Dispute mode</p>
                <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
                  Отклонённый milestone можно перевести в спор и передать финальное решение арбитру.
                </p>
              </div>
            </div>
          )}

          <div className="mb-8 rounded-xl p-5" style={{ border: '1px solid var(--line)', background: 'var(--panel-bg)' }}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="panel-heading">Milestone flow</p>
                <p className="mt-2 text-lg font-bold" style={{ color: 'var(--ink)' }}>
                  {Number(campaign.milestoneCount) > 0 ? `${campaign.milestoneCount.toString()} этап(ов)` : 'Не настроен'}
                </p>
                <p className="mt-2 text-sm leading-6" style={{ color: 'var(--muted)' }}>
                  {milestoneFlowStage}
                </p>
              </div>
              <div className="text-right">
                <p className="panel-heading">Покрытие этапами</p>
                <p className="mt-2 text-lg font-bold" style={{ color: 'var(--cyan)' }}>{milestoneCoverage.toFixed(1)}%</p>
              </div>
            </div>
            <div className="mt-4 h-3 w-full overflow-hidden rounded-full" style={{ background: 'var(--progress-track)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${milestoneCoverage}%`,
                  background: 'linear-gradient(90deg, #00e0ff 0%, #49d6ff 100%)',
                }}
              />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-xl p-4" style={{ border: '1px solid var(--line)', background: 'var(--panel-soft-bg)' }}>
                <p className="panel-heading">Сумма этапов</p>
                <p className="mt-2 font-bold" style={{ color: 'var(--ink)' }}>{formatSOL(campaign.milestoneAmountTotal)} SOL</p>
              </div>
              <div className="rounded-xl p-4" style={{ border: '1px solid var(--line)', background: 'var(--panel-soft-bg)' }}>
                <p className="panel-heading">Выдано по этапам</p>
                <p className="mt-2 font-bold" style={{ color: 'var(--ink)' }}>{formatSOL(campaign.milestoneAmountReleased)} SOL</p>
              </div>
              <div className="rounded-xl p-4" style={{ border: '1px solid var(--line)', background: 'var(--panel-soft-bg)' }}>
                <p className="panel-heading">Остаток бюджета этапов</p>
                <p className="mt-2 font-bold" style={{ color: 'var(--ink)' }}>{remainingMilestoneBudget.toFixed(4)} SOL</p>
              </div>
            </div>
            <div className="mt-4 rounded-xl p-4" style={{ border: '1px dashed var(--line)', color: 'var(--muted)' }}>
              Цикл этапа: 1) Add milestone, 2) Submit milestone, 3) Backers vote, 4) Finalize review, 5) Release funds. Этапы не позволяют выводить деньги во время сбора средств.
            </div>
          </div>

          {statusValue.isOwner && (campaign.state === 'active' || campaign.state === 'successful') && (
            <div className="mb-8 rounded-xl p-5" style={{ border: '1px solid var(--line)', background: 'var(--panel-bg)' }}>
              <p className="panel-heading">Новый milestone</p>
                <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
                Следующий индекс этапа: {nextMilestoneIndex}. Сумма всех этапов не должна превышать цель кампании. Создание этапа только регистрирует его on-chain, но не запускает review автоматически.
              </p>
              <div className="mt-4 grid gap-4">
                <input
                  value={milestoneTitle}
                  onChange={(e) => setMilestoneTitle(e.target.value)}
                  className="input-field"
                  placeholder="Название этапа"
                />
                <textarea
                  value={milestoneDescription}
                  onChange={(e) => setMilestoneDescription(e.target.value)}
                  className="input-field min-h-[110px]"
                  placeholder="Что должно быть сделано на этом этапе"
                />
                <div className="grid gap-4 md:grid-cols-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={milestoneAmount}
                    onChange={(e) => setMilestoneAmount(e.target.value)}
                    className="input-field"
                    placeholder="Сумма этапа в SOL"
                  />
                  <input
                    type="datetime-local"
                    min={minVotingEnd}
                    value={milestoneVotingEnd}
                    onChange={(e) => setMilestoneVotingEnd(e.target.value)}
                    className="input-field"
                  />
                </div>
                <button
                  onClick={handleCreateMilestone}
                  disabled={processing}
                  className="btn-secondary"
                >
                  Добавить milestone
                </button>
              </div>
            </div>
          )}

          <div className="mb-8 rounded-xl p-5" style={{ border: '1px solid var(--line)', background: 'var(--panel-bg)' }}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="panel-heading">Этапы кампании</p>
                <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
                  По этим этапам производится staged release и открытие возвратов при провале.
                </p>
              </div>
            </div>

            {milestones.length === 0 ? (
              <div className="mt-4 rounded-xl p-4" style={{ border: '1px dashed var(--line)', color: 'var(--muted)' }}>
                Для этой кампании milestones ещё не настроены. В таком случае действует старый single-shot flow: settlement/claim по всей сумме.
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                {milestones.map((milestone: Milestone) => {
                  const voteShare = Number(campaign.totalPledged) > 0
                    ? (Number(milestone.votesFor + milestone.votesAgainst) / Number(campaign.totalPledged)) * 100
                    : 0;
                  const nextStep = getMilestoneNextStep(
                    milestone,
                    campaign,
                    !!statusValue.isOwner,
                    !!publicKey,
                    !!isArbiter
                  );

                  return (
                    <div
                      key={milestone.pubkey.toBase58()}
                      className="rounded-xl p-4"
                      style={{ border: '1px solid var(--line)', background: 'var(--panel-soft-bg)' }}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="section-kicker">Milestone #{milestone.index.toString()}</p>
                          <h3 className="mt-2 text-lg font-bold" style={{ color: 'var(--ink)' }}>{milestone.title}</h3>
                          <p className="mt-2 text-sm leading-6" style={{ color: 'var(--muted)' }}>{milestone.description}</p>
                        </div>
                        <span
                          className="rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]"
                          style={{ background: 'var(--chip-bg)', color: 'var(--cyan)' }}
                        >
                          {getMilestoneStateLabel(milestone.state)}
                        </span>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-4">
                        <div>
                          <p className="panel-heading">Сумма</p>
                          <p className="mt-1 font-bold" style={{ color: 'var(--ink)' }}>{formatSOL(milestone.amount)} SOL</p>
                        </div>
                        <div>
                          <p className="panel-heading">За</p>
                          <p className="mt-1 font-bold" style={{ color: 'var(--lime)' }}>{formatSOL(milestone.votesFor)} SOL</p>
                        </div>
                        <div>
                          <p className="panel-heading">Против</p>
                          <p className="mt-1 font-bold" style={{ color: '#ff9d9d' }}>{formatSOL(milestone.votesAgainst)} SOL</p>
                        </div>
                        <div>
                          <p className="panel-heading">Дедлайн review</p>
                          <p className="mt-1 font-bold" style={{ color: 'var(--ink)' }}>{formatTime(milestone.votingEndTime)}</p>
                        </div>
                      </div>

                      {milestone.state === 'disputed' && (
                        <div
                          className="mt-4 rounded-xl p-4"
                          style={{ border: '1px solid var(--warn-border)', background: 'var(--warn-bg)', color: 'var(--warn-text)' }}
                        >
                          Спор открыт. Финальное решение должен принять арбитр: подтвердить milestone или открыть возвраты.
                        </div>
                      )}

                      <div
                        className="mt-4 rounded-xl p-4"
                        style={
                          nextStep.tone === 'success'
                            ? { border: '1px solid var(--success-border)', background: 'var(--success-bg)', color: 'var(--success-text)' }
                            : { border: '1px solid var(--info-border)', background: 'var(--info-bg)', color: 'var(--info-text)' }
                        }
                      >
                        {nextStep.message}
                      </div>

                      <div className="mt-4">
                        <div className="mb-2 flex justify-between text-xs" style={{ color: 'var(--muted)' }}>
                          <span>Участие голосов</span>
                          <span>{voteShare.toFixed(1)}%</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--progress-track)' }}>
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(0, Math.min(voteShare, 100))}%`,
                              background: 'linear-gradient(90deg, #00e0ff 0%, #49d6ff 100%)',
                            }}
                          />
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-3">
                        {statusValue.isOwner && (milestone.state === 'pending' || milestone.state === 'rejected') && campaign.state === 'successful' && (
                          <button
                            onClick={() => runMilestoneAction(
                              () => submitMilestone(campaignPubkey, Number(milestone.index)),
                              `Milestone #${milestone.index.toString()} отправлен на review.`
                            )}
                            disabled={processing}
                            className="btn-secondary"
                          >
                            Submit milestone
                          </button>
                        )}

                        {!statusValue.isOwner && milestone.state === 'readyForReview' && publicKey && (
                          <>
                            <button
                              onClick={() => runMilestoneAction(
                                () => voteMilestone(campaignPubkey, Number(milestone.index), true),
                                `Голос "за" по milestone #${milestone.index.toString()} отправлен.`
                              )}
                              disabled={processing}
                              className="btn-primary"
                            >
                              Голосовать за
                            </button>
                            <button
                              onClick={() => runMilestoneAction(
                                () => voteMilestone(campaignPubkey, Number(milestone.index), false),
                                `Голос "против" по milestone #${milestone.index.toString()} отправлен.`
                              )}
                              disabled={processing}
                              className="btn-secondary"
                            >
                              Голосовать против
                            </button>
                          </>
                        )}

                        {milestone.state === 'readyForReview' && publicKey && (
                          <button
                            onClick={() => runMilestoneAction(
                              () => finalizeMilestone(campaignPubkey, Number(milestone.index)),
                              `Milestone #${milestone.index.toString()} финализирован.`
                            )}
                            disabled={processing}
                            className="btn-secondary"
                          >
                            Finalize review
                          </button>
                        )}

                        {statusValue.isOwner && milestone.state === 'approved' && (
                          <button
                            onClick={() => runMilestoneAction(
                              () => releaseMilestoneFunds(campaignPubkey, Number(milestone.index)),
                              `Средства по milestone #${milestone.index.toString()} переведены.`
                            )}
                            disabled={processing}
                            className="btn-primary"
                          >
                            Release funds
                          </button>
                        )}

                        {statusValue.isOwner && milestone.state === 'rejected' && campaign.state === 'successful' && (
                          <>
                            <button
                              onClick={() => runMilestoneAction(
                                () => openDispute(campaignPubkey, Number(milestone.index)),
                                `По milestone #${milestone.index.toString()} открыт dispute.`
                              )}
                              disabled={processing}
                              className="btn-secondary"
                            >
                              Open dispute
                            </button>
                            <button
                              onClick={() => runMilestoneAction(
                                () => failCampaignAndOpenRefunds(campaignPubkey, Number(milestone.index)),
                                `Кампания переведена в refund mode после reject milestone #${milestone.index.toString()}.`
                              )}
                              disabled={processing}
                              className="btn-secondary"
                            >
                              Open refunds
                            </button>
                          </>
                        )}

                        {isArbiter && milestone.state === 'disputed' && (
                          <>
                            <button
                              onClick={() => runMilestoneAction(
                                () => resolveDispute(campaignPubkey, Number(milestone.index), 'approveMilestone'),
                                `Арбитр подтвердил milestone #${milestone.index.toString()}.`
                              )}
                              disabled={processing}
                              className="btn-primary"
                            >
                              Arbiter approve
                            </button>
                            <button
                              onClick={() => runMilestoneAction(
                                () => resolveDispute(campaignPubkey, Number(milestone.index), 'openRefunds'),
                                `Арбитр открыл возвраты по milestone #${milestone.index.toString()}.`
                              )}
                              disabled={processing}
                              className="btn-secondary"
                            >
                              Arbiter refunds
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {!configAccount && (
            <div className="mb-6 rounded-xl p-4" style={{ border: '1px solid var(--warn-border)', background: 'var(--warn-bg)', color: 'var(--warn-text)' }}>
              Конфигурация протокола ещё не инициализирована. Для localnet выполни `yarn init:localnet-config` в корне проекта.
            </div>
          )}

          {statusValue.isOwner && statusValue.canEarlySettle && (
            <div className="mb-6 rounded-xl p-4" style={{ border: '1px solid var(--success-border)', background: 'var(--success-bg)', color: 'var(--success-text)' }}>
              Цель уже достигнута. Кампанию можно завершить досрочно: выполнить settlement или сразу получить средства через lazy claim.
            </div>
          )}

          {!statusValue.isOwner && statusValue.canEarlySettle && (
            <div className="mb-6 rounded-xl p-4" style={{ border: '1px solid var(--info-border)', background: 'var(--info-bg)', color: 'var(--info-text)' }}>
              Цель уже достигнута, и кампания может быть завершена раньше дедлайна.
            </div>
          )}

          {(notice || error || submitError) && (
            <div
              className="mb-6 rounded-xl p-4"
              style={
                notice
                  ? notice.tone === 'success'
                    ? { border: '1px solid var(--success-border)', background: 'var(--success-bg)', color: 'var(--success-text)' }
                    : { border: '1px solid var(--danger-border)', background: 'var(--danger-bg)', color: 'var(--danger-text)' }
                  : { border: '1px solid var(--danger-border)', background: 'var(--danger-bg)', color: 'var(--danger-text)' }
              }
            >
              {notice?.message || error || submitError}
            </div>
          )}

          <div className="border-t pt-6" style={{ borderColor: 'var(--line)' }}>
            <p className="panel-heading">Creator wallet</p>
            <p className="mt-2 break-all font-mono" style={{ color: 'var(--cyan)' }}>
              {formatWalletAddress(campaign.creator, 12, 10)}
            </p>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card">
            <p className="section-kicker">Действия</p>
            <h2 className="terminal-title mt-3 text-2xl font-bold" style={{ color: 'var(--ink)' }}>
              Управление кампанией
            </h2>

            {statusValue.isActive && publicKey && (
              <div className="mt-6 rounded-xl p-5" style={{ border: '1px solid var(--line)', background: 'var(--panel-bg)' }}>
                <p className="panel-heading">Новый взнос</p>
                <div className="mt-4 flex flex-col gap-3">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={pledgeAmount}
                    onChange={(e) => setPledgeAmount(e.target.value)}
                    className="input-field"
                    placeholder="Сумма в SOL"
                  />
                  <button
                    onClick={handlePledge}
                    disabled={processing || !pledgeAmount}
                    className="btn-primary whitespace-nowrap"
                  >
                    {processing ? 'Обработка...' : 'Внести'}
                  </button>
                </div>
                <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>
                  Взнос уйдёт в escrow-vault кампании и будет выдан только по условиям кампании или возвращён при неуспехе.
                </p>
              </div>
            )}

            <div className="mt-6 space-y-3">
              {cancelCampaignAction.visible && (
                <div>
                  <button
                    onClick={handleCancelCampaign}
                    disabled={processing || !cancelCampaignAction.enabled}
                    title={cancelCampaignAction.reason}
                    className="btn-secondary w-full disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Отменить кампанию
                  </button>
                  {!cancelCampaignAction.enabled && cancelCampaignAction.reason && (
                    <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                      {cancelCampaignAction.reason}
                    </p>
                  )}
                </div>
              )}

              {claimAction.visible && (
                <div>
                  <button
                    onClick={handleClaim}
                    disabled={processing || !claimAction.enabled}
                    title={claimAction.reason}
                    className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Получить средства
                  </button>
                  {!claimAction.enabled && claimAction.reason && (
                    <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                      {claimAction.reason}
                    </p>
                  )}
                </div>
              )}

              {settleAction.visible && (
                <div>
                  <button
                    onClick={handleSettle}
                    disabled={processing || !settleAction.enabled}
                    title={settleAction.reason}
                    className="btn-secondary w-full disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Выполнить settlement кампании
                  </button>
                  {!settleAction.enabled && settleAction.reason && (
                    <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                      {settleAction.reason}
                    </p>
                  )}
                </div>
              )}

              {refundAction.visible && (
                <div>
                  <button
                    onClick={handleCancelPledge}
                    disabled={processing || !refundAction.enabled}
                    title={refundAction.reason}
                    className="btn-secondary w-full disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Вернуть взнос / lazy refund
                  </button>
                  {!refundAction.enabled && refundAction.reason && (
                    <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                      {refundAction.reason}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <p className="section-kicker">Подсказки</p>
            <div className="mt-4 space-y-4 text-sm" style={{ color: 'var(--muted)' }}>
              <p>
                `settlement` завершает финансовый сценарий кампании по правилам контракта.
              </p>
              <p>
                `claim` используется создателем для получения средств в успешном сценарии.
              </p>
              <p>
                `refund` доступен спонсорам при состоянии `Failed` или `Cancelled`.
              </p>
              <p>
                `dispute` используется, когда отклонённый milestone передаётся на финальное решение арбитру.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
