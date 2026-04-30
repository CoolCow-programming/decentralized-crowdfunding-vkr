import { PublicKey } from '@solana/web3.js';

export const PROGRAM_ID = new PublicKey('FWh6EtpM5usrduc89K6YEQZ6GQ5UmycGHfM6VSrPcpUz');

export const CAMPAIGN_SEED = 'campaign';
export const VAULT_SEED = 'vault';
export const PLEDGE_SEED = 'pledge';
export const CONFIG_SEED = 'config';
export const MILESTONE_SEED = 'milestone';
export const MILESTONE_VOTE_SEED = 'milestone_vote';

export const CAMPAIGN_DISCRIMINATOR = new Uint8Array([50, 40, 49, 11, 157, 220, 229, 192]);
export const CONFIG_DISCRIMINATOR = new Uint8Array([155, 12, 170, 224, 30, 250, 204, 130]);
export const MILESTONE_DISCRIMINATOR = new Uint8Array([38, 210, 239, 177, 85, 184, 10, 44]);
export const PLEDGE_DISCRIMINATOR = new Uint8Array([247, 217, 127, 216, 219, 207, 43, 79]);

// maximum serialized sizes, useful for account filtering in UI/debugging
export const CAMPAIGN_SIZE = 8 + 32 + 4 + 100 + 4 + 1000 + (8 * 12) + 8 + 8 + 1 + 1 + 1 + 1 + 1 + 8;
export const PLEDGE_SIZE = 8 + 32 + 32 + 8 + 8 + 1 + 1;
export const CONFIG_SIZE = 8 + 32 + 32 + 32 + 2 + 1;

export type CampaignState = 'active' | 'successful' | 'failed' | 'cancelled' | 'claimed';
export type MilestoneState = 'pending' | 'readyForReview' | 'approved' | 'rejected' | 'disputed' | 'released';

export interface Campaign {
  creator: PublicKey;
  title: string;
  description: string;
  goalAmount: bigint;
  currentAmount: bigint;
  backersCount: bigint;
  totalPledged: bigint;
  totalRefunded: bigint;
  claimedAmount: bigint;
  milestoneCount: bigint;
  releasedMilestones: bigint;
  milestoneAmountTotal: bigint;
  milestoneAmountReleased: bigint;
  refundSnapshotAmount: bigint;
  refundSnapshotTotalPledged: bigint;
  startTime: bigint;
  endTime: bigint;
  state: CampaignState;
  isClaimed: boolean;
  isCancelled: boolean;
  bump: number;
  campaignVaultBump: number;
  nonce: bigint;
}

export interface Pledge {
  backer: PublicKey;
  campaign: PublicKey;
  amount: bigint;
  refundedAmount: bigint;
  isRefunded: boolean;
  bump: number;
}

export interface ConfigAccount {
  admin: PublicKey;
  arbiter: PublicKey;
  treasury: PublicKey;
  feeBps: number;
  bump: number;
}

export interface Milestone {
  pubkey: PublicKey;
  campaign: PublicKey;
  index: bigint;
  title: string;
  description: string;
  amount: bigint;
  votesFor: bigint;
  votesAgainst: bigint;
  submittedAt: bigint;
  votingEndTime: bigint;
  releasedAmount: bigint;
  disputeOpenedBy: PublicKey;
  state: MilestoneState;
  bump: number;
}

export interface CampaignStatus {
  isOwner: boolean;
  isActive: boolean;
  isEnded: boolean;
  goalReached: boolean;
  canEarlySettle: boolean;
  isSuccessful: boolean;
  isFailed: boolean;
  isCancelled: boolean;
  isClaimed: boolean;
  needsSettlement: boolean;
  canClaim: boolean;
  canCancelCampaign: boolean;
  canRefund: boolean;
  refundPendingSettlement: boolean;
  canSettle: boolean;
  hasMilestones: boolean;
  canUseMilestoneFlow: boolean;
}

export function formatSOL(lamports: bigint | number): string {
  const sol = Number(lamports) / 1_000_000_000;
  return sol.toFixed(4);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatTime(timestamp: bigint | number): string {
  const date = new Date(Number(timestamp) * 1000);
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getTimeRemaining(endTime: bigint | number): string {
  const end = Number(endTime) * 1000;
  const now = Date.now();
  const diff = end - now;

  if (diff <= 0) return 'Завершено';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days} дн. ${hours} ч.`;
  if (hours > 0) return `${hours} ч. ${minutes} мин.`;
  return `${Math.max(minutes, 1)} мин.`;
}

export function clampProgress(current: bigint | number, goal: bigint | number): number {
  const goalValue = Number(goal);
  if (goalValue <= 0) return 0;
  const progress = (Number(current) / goalValue) * 100;
  return Math.max(0, Math.min(progress, 100));
}

export function formatWalletAddress(publicKey: PublicKey | string, start = 6, end = 4): string {
  const value = typeof publicKey === 'string' ? publicKey : publicKey.toBase58();
  if (value.length <= start + end) return value;
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

export function getCampaignStateLabel(state: CampaignState): string {
  switch (state) {
    case 'active':
      return 'Активно';
    case 'successful':
      return 'Успешно';
    case 'failed':
      return 'Неуспешно';
    case 'cancelled':
      return 'Отменено';
    case 'claimed':
      return 'Выплачено';
    default:
      return 'Неизвестно';
  }
}

export function getMilestoneStateLabel(state: MilestoneState): string {
  switch (state) {
    case 'pending':
      return 'Ожидает запуска';
    case 'readyForReview':
      return 'На голосовании';
    case 'approved':
      return 'Подтверждён';
    case 'rejected':
      return 'Отклонён';
    case 'disputed':
      return 'На арбитраже';
    case 'released':
      return 'Оплачен';
    default:
      return 'Неизвестно';
  }
}

export function matchesDiscriminator(data: Buffer, discriminator: Uint8Array): boolean {
  if (data.length < discriminator.length) return false;
  for (let i = 0; i < discriminator.length; i += 1) {
    if (data[i] !== discriminator[i]) return false;
  }
  return true;
}

export function getCampaignStatus(campaign: Campaign, viewer?: PublicKey | null): CampaignStatus {
  const now = Date.now();
  const endTimeMs = Number(campaign.endTime) * 1000;
  const isOwner = viewer ? viewer.equals(campaign.creator) : false;
  const isEnded = endTimeMs <= now;
  const goalReached = Number(campaign.totalPledged) >= Number(campaign.goalAmount);
  const isSuccessful = campaign.state === 'successful';
  const isFailed = campaign.state === 'failed';
  const isCancelled = campaign.state === 'cancelled';
  const isClaimed = campaign.state === 'claimed';
  const hasMilestones = Number(campaign.milestoneCount) > 0;
  const canEarlySettle = campaign.state === 'active' && goalReached;
  const needsSettlement = campaign.state === 'active' && isEnded;
  const refundPendingSettlement = !isOwner && needsSettlement && !goalReached;

  return {
    isOwner,
    isActive: campaign.state === 'active' && !isEnded,
    isEnded,
    goalReached,
    canEarlySettle,
    isSuccessful,
    isFailed,
    isCancelled,
    isClaimed,
    needsSettlement,
    canClaim: isOwner && (isSuccessful || canEarlySettle),
    canCancelCampaign: isOwner && campaign.state === 'active' && !isEnded,
    canRefund: !isOwner && (isFailed || isCancelled),
    refundPendingSettlement,
    canSettle: campaign.state === 'active' && (isEnded || goalReached),
    hasMilestones,
    canUseMilestoneFlow: hasMilestones && (isSuccessful || isClaimed || isFailed || canEarlySettle),
  };
}
