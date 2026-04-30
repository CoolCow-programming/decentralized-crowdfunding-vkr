import { useState, useEffect, useCallback } from 'react';
import { useConnection, useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import {
  PROGRAM_ID,
  CONFIG_SEED,
  Campaign,
  CampaignState,
  ConfigAccount,
  MILESTONE_SEED,
  MILESTONE_VOTE_SEED,
  Milestone,
  MilestoneState,
  CAMPAIGN_DISCRIMINATOR,
  CONFIG_DISCRIMINATOR,
  MILESTONE_DISCRIMINATOR,
  PLEDGE_DISCRIMINATOR,
  PLEDGE_SEED,
  Pledge,
  matchesDiscriminator,
} from '../utils/constants';
import idl from '../crowdfunding_escrow.json';

const CLOCK_PUBKEY = new PublicKey('SysvarC1ock11111111111111111111111111111111');

function decodeCampaignState(value: number): CampaignState {
  switch (value) {
    case 0:
      return 'active';
    case 1:
      return 'successful';
    case 2:
      return 'failed';
    case 3:
      return 'cancelled';
    case 4:
      return 'claimed';
    default:
      return 'active';
  }
}

function decodeMilestoneState(value: number): MilestoneState {
  switch (value) {
    case 0:
      return 'pending';
    case 1:
      return 'readyForReview';
    case 2:
      return 'approved';
    case 3:
      return 'rejected';
    case 4:
      return 'disputed';
    case 5:
      return 'released';
    default:
      return 'pending';
  }
}

export function decodeCampaign(data: Buffer): Campaign {
  let offset = 8;

  const creator = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const titleLen = data.readUInt32LE(offset);
  offset += 4;
  const title = data.slice(offset, offset + titleLen).toString('utf-8');
  offset += titleLen;

  const descLen = data.readUInt32LE(offset);
  offset += 4;
  const description = data.slice(offset, offset + descLen).toString('utf-8');
  offset += descLen;

  const goalAmount = data.readBigUInt64LE(offset);
  offset += 8;

  const currentAmount = data.readBigUInt64LE(offset);
  offset += 8;

  const backersCount = data.readBigUInt64LE(offset);
  offset += 8;

  const totalPledged = data.readBigUInt64LE(offset);
  offset += 8;

  const totalRefunded = data.readBigUInt64LE(offset);
  offset += 8;

  const claimedAmount = data.readBigUInt64LE(offset);
  offset += 8;

  const milestoneCount = data.readBigUInt64LE(offset);
  offset += 8;

  const releasedMilestones = data.readBigUInt64LE(offset);
  offset += 8;

  const milestoneAmountTotal = data.readBigUInt64LE(offset);
  offset += 8;

  const milestoneAmountReleased = data.readBigUInt64LE(offset);
  offset += 8;

  const refundSnapshotAmount = data.readBigUInt64LE(offset);
  offset += 8;

  const refundSnapshotTotalPledged = data.readBigUInt64LE(offset);
  offset += 8;

  const startTime = BigInt(data.readBigInt64LE(offset));
  offset += 8;

  const endTime = BigInt(data.readBigInt64LE(offset));
  offset += 8;

  const state = decodeCampaignState(data[offset]);
  offset += 1;

  const isClaimed = data[offset] === 1;
  offset += 1;

  const isCancelled = data[offset] === 1;
  offset += 1;

  const bump = data[offset];
  offset += 1;

  const campaignVaultBump = data[offset];
  offset += 1;

  const nonce = data.readBigUInt64LE(offset);

  return {
    creator,
    title,
    description,
    goalAmount,
    currentAmount,
    backersCount,
    totalPledged,
    totalRefunded,
    claimedAmount,
    milestoneCount,
    releasedMilestones,
    milestoneAmountTotal,
    milestoneAmountReleased,
    refundSnapshotAmount,
    refundSnapshotTotalPledged,
    startTime,
    endTime,
    state,
    isClaimed,
    isCancelled,
    bump,
    campaignVaultBump,
    nonce,
  };
}

export function decodeMilestone(pubkey: PublicKey, data: Buffer): Milestone {
  let offset = 8;

  const campaign = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const index = data.readBigUInt64LE(offset);
  offset += 8;

  const titleLen = data.readUInt32LE(offset);
  offset += 4;
  const title = data.slice(offset, offset + titleLen).toString('utf-8');
  offset += titleLen;

  const descriptionLen = data.readUInt32LE(offset);
  offset += 4;
  const description = data.slice(offset, offset + descriptionLen).toString('utf-8');
  offset += descriptionLen;

  const amount = data.readBigUInt64LE(offset);
  offset += 8;

  const votesFor = data.readBigUInt64LE(offset);
  offset += 8;

  const votesAgainst = data.readBigUInt64LE(offset);
  offset += 8;

  const submittedAt = BigInt(data.readBigInt64LE(offset));
  offset += 8;

  const votingEndTime = BigInt(data.readBigInt64LE(offset));
  offset += 8;

  const releasedAmount = data.readBigUInt64LE(offset);
  offset += 8;

  const disputeOpenedBy = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const state = decodeMilestoneState(data[offset]);
  offset += 1;

  const bump = data[offset];

  return {
    pubkey,
    campaign,
    index,
    title,
    description,
    amount,
    votesFor,
    votesAgainst,
    submittedAt,
    votingEndTime,
    releasedAmount,
    disputeOpenedBy,
    state,
    bump,
  };
}

function decodeConfig(data: Buffer): ConfigAccount {
  let offset = 8;

  const admin = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const arbiter = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const treasury = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const feeBps = data.readUInt16LE(offset);
  offset += 2;

  const bump = data[offset];

  return {
    admin,
    arbiter,
    treasury,
    feeBps,
    bump,
  };
}

export function decodePledge(data: Buffer): Pledge {
  let offset = 8;

  const backer = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const campaign = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const amount = data.readBigUInt64LE(offset);
  offset += 8;

  const refundedAmount = data.readBigUInt64LE(offset);
  offset += 8;

  const isRefunded = data[offset] === 1;
  offset += 1;

  const bump = data[offset];

  return {
    backer,
    campaign,
    amount,
    refundedAmount,
    isRefunded,
    bump,
  };
}

export function useCampaignProgram() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const anchorWallet = useAnchorWallet();

  const [campaigns, setCampaigns] = useState<Array<{ pubkey: PublicKey; data: Campaign }>>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextNonce, setNextNonce] = useState(0);
  const [configAccount, setConfigAccount] = useState<ConfigAccount | null>(null);

  const fetchCampaignAccounts = useCallback(async () => {
    const accounts = await connection.getProgramAccounts(PROGRAM_ID);

    return accounts
      .filter((account) => matchesDiscriminator(Buffer.from(account.account.data), CAMPAIGN_DISCRIMINATOR))
      .map((account) => ({
        pubkey: account.pubkey,
        data: decodeCampaign(Buffer.from(account.account.data)),
      }));
  }, [connection]);

  const fetchCampaignAccount = useCallback(async (campaignPubkey: PublicKey): Promise<Campaign> => {
    const accountInfo = await connection.getAccountInfo(campaignPubkey);
    if (!accountInfo) {
      throw new Error('Campaign not found');
    }

    return decodeCampaign(Buffer.from(accountInfo.data));
  }, [connection]);

  const fetchConfig = useCallback(async (): Promise<ConfigAccount | null> => {
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(CONFIG_SEED)],
      PROGRAM_ID
    );
    const accountInfo = await connection.getAccountInfo(configPda);
    if (!accountInfo) {
      setConfigAccount(null);
      return null;
    }

    if (!matchesDiscriminator(Buffer.from(accountInfo.data), CONFIG_DISCRIMINATOR)) {
      throw new Error('Invalid config account discriminator');
    }

    const decoded = decodeConfig(Buffer.from(accountInfo.data));
    setConfigAccount(decoded);
    return decoded;
  }, [connection]);

  const fetchMilestones = useCallback(async (campaignPubkey: PublicKey): Promise<Milestone[]> => {
    const accounts = await connection.getProgramAccounts(PROGRAM_ID);

    const decodedMilestones = accounts
      .filter((account) => matchesDiscriminator(Buffer.from(account.account.data), MILESTONE_DISCRIMINATOR))
      .map((account) => decodeMilestone(account.pubkey, Buffer.from(account.account.data)))
      .filter((milestone) => milestone.campaign.equals(campaignPubkey))
      .sort((a, b) => Number(a.index - b.index));

    setMilestones(decodedMilestones);
    return decodedMilestones;
  }, [connection]);

  const fetchPledgeAccount = useCallback(async (
    campaignPubkey: PublicKey,
    backerPubkey: PublicKey
  ): Promise<Pledge | null> => {
    const [pledgePda] = PublicKey.findProgramAddressSync(
      [Buffer.from(PLEDGE_SEED), backerPubkey.toBuffer(), campaignPubkey.toBuffer()],
      PROGRAM_ID
    );
    const accountInfo = await connection.getAccountInfo(pledgePda);

    if (!accountInfo) {
      return null;
    }

    if (!matchesDiscriminator(Buffer.from(accountInfo.data), PLEDGE_DISCRIMINATOR)) {
      throw new Error('Invalid pledge account discriminator');
    }

    return decodePledge(Buffer.from(accountInfo.data));
  }, [connection]);

  const program = useCallback(() => {
    if (!anchorWallet) return null;

    const provider = new AnchorProvider(connection, anchorWallet, {
      commitment: 'confirmed',
    });

    return new Program(idl as any, provider);
  }, [anchorWallet, connection]);

  useEffect(() => {
    fetchConfig().catch((err: unknown) => {
      console.warn('Config not initialized yet:', err);
    });
  }, [fetchConfig]);

  useEffect(() => {
    if (!publicKey) {
      setNextNonce(0);
      return;
    }

    const fetchHighestNonce = async () => {
      try {
        const accounts = await fetchCampaignAccounts();
        let maxNonce = -1;

        for (const account of accounts) {
          if (account.data.creator.equals(publicKey)) {
            const nonceNum = Number(account.data.nonce);
            if (nonceNum > maxNonce) {
              maxNonce = nonceNum;
            }
          }
        }

        setNextNonce(maxNonce + 1);
      } catch (err) {
        console.error('Error fetching nonce:', err);
        setNextNonce(0);
      }
    };

    fetchHighestNonce();
  }, [publicKey, fetchCampaignAccounts]);

  const fetchCampaigns = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const accounts = await fetchCampaignAccounts();
      setCampaigns(accounts);
    } catch (err: any) {
      console.error('Error fetching campaigns:', err);
      setError(err.message ?? 'Failed to fetch campaigns');
    } finally {
      setLoading(false);
    }
  }, [fetchCampaignAccounts]);

  const createMilestone = useCallback(async (
    campaignPubkey: PublicKey,
    index: number,
    title: string,
    description: string,
    amountSol: number,
    votingEndUnix: number
  ): Promise<boolean> => {
    if (!publicKey) throw new Error('Wallet not connected');

    try {
      setError(null);

      const pgm = program();
      if (!pgm) throw new Error('Program not initialized');

      const indexBN = new BN(index);
      const amountLamports = new BN(Math.floor(amountSol * 1e9));
      const votingEndBN = new BN(votingEndUnix);
      const [milestonePda] = PublicKey.findProgramAddressSync(
        [Buffer.from(MILESTONE_SEED), campaignPubkey.toBuffer(), indexBN.toArrayLike(Buffer, 'le', 8)],
        PROGRAM_ID
      );

      const tx = await pgm.methods
        .createMilestone(indexBN, title, description, amountLamports, votingEndBN)
        .accounts({
          creator: publicKey,
          campaign: campaignPubkey,
          milestone: milestonePda,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      const signature = await sendTransaction(tx, connection, { skipPreflight: false });
      await connection.confirmTransaction(signature, 'confirmed');

      return true;
    } catch (err: any) {
      console.error('Error creating milestone:', err);
      setError(err.message ?? 'Failed to create milestone');
      return false;
    }
  }, [publicKey, program, sendTransaction, connection]);

  const submitMilestone = useCallback(async (campaignPubkey: PublicKey, index: number): Promise<boolean> => {
    if (!publicKey) throw new Error('Wallet not connected');

    try {
      setError(null);
      const pgm = program();
      if (!pgm) throw new Error('Program not initialized');

      const indexBN = new BN(index);
      const [milestonePda] = PublicKey.findProgramAddressSync(
        [Buffer.from(MILESTONE_SEED), campaignPubkey.toBuffer(), indexBN.toArrayLike(Buffer, 'le', 8)],
        PROGRAM_ID
      );

      const tx = await pgm.methods
        .submitMilestone()
        .accounts({
          creator: publicKey,
          campaign: campaignPubkey,
          milestone: milestonePda,
          clock: CLOCK_PUBKEY,
        })
        .transaction();

      const signature = await sendTransaction(tx, connection, { skipPreflight: false });
      await connection.confirmTransaction(signature, 'confirmed');

      return true;
    } catch (err: any) {
      console.error('Error submitting milestone:', err);
      setError(err.message ?? 'Failed to submit milestone');
      return false;
    }
  }, [publicKey, program, sendTransaction, connection]);

  const voteMilestone = useCallback(async (
    campaignPubkey: PublicKey,
    index: number,
    approve: boolean
  ): Promise<boolean> => {
    if (!publicKey) throw new Error('Wallet not connected');

    try {
      setError(null);
      const pgm = program();
      if (!pgm) throw new Error('Program not initialized');

      const indexBN = new BN(index);
      const [milestonePda] = PublicKey.findProgramAddressSync(
        [Buffer.from(MILESTONE_SEED), campaignPubkey.toBuffer(), indexBN.toArrayLike(Buffer, 'le', 8)],
        PROGRAM_ID
      );
      const [pledgePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('pledge'), publicKey.toBuffer(), campaignPubkey.toBuffer()],
        PROGRAM_ID
      );
      const [milestoneVotePda] = PublicKey.findProgramAddressSync(
        [Buffer.from(MILESTONE_VOTE_SEED), milestonePda.toBuffer(), publicKey.toBuffer()],
        PROGRAM_ID
      );

      const tx = await pgm.methods
        .voteMilestone(approve)
        .accounts({
          backer: publicKey,
          campaign: campaignPubkey,
          milestone: milestonePda,
          pledge: pledgePda,
          milestoneVote: milestoneVotePda,
          systemProgram: SystemProgram.programId,
          clock: CLOCK_PUBKEY,
        })
        .transaction();

      const signature = await sendTransaction(tx, connection, { skipPreflight: false });
      await connection.confirmTransaction(signature, 'confirmed');

      return true;
    } catch (err: any) {
      console.error('Error voting milestone:', err);
      setError(err.message ?? 'Failed to vote milestone');
      return false;
    }
  }, [publicKey, program, sendTransaction, connection]);

  const finalizeMilestone = useCallback(async (campaignPubkey: PublicKey, index: number): Promise<boolean> => {
    try {
      setError(null);
      const pgm = program();
      if (!pgm) throw new Error('Program not initialized');

      const indexBN = new BN(index);
      const [milestonePda] = PublicKey.findProgramAddressSync(
        [Buffer.from(MILESTONE_SEED), campaignPubkey.toBuffer(), indexBN.toArrayLike(Buffer, 'le', 8)],
        PROGRAM_ID
      );

      const tx = await pgm.methods
        .finalizeMilestone()
        .accounts({
          campaign: campaignPubkey,
          milestone: milestonePda,
          clock: CLOCK_PUBKEY,
        })
        .transaction();

      const signature = await sendTransaction(tx, connection, { skipPreflight: false });
      await connection.confirmTransaction(signature, 'confirmed');

      return true;
    } catch (err: any) {
      console.error('Error finalizing milestone:', err);
      setError(err.message ?? 'Failed to finalize milestone');
      return false;
    }
  }, [program, sendTransaction, connection]);

  const releaseMilestoneFunds = useCallback(async (campaignPubkey: PublicKey, index: number): Promise<boolean> => {
    if (!publicKey) throw new Error('Wallet not connected');

    try {
      setError(null);
      const pgm = program();
      if (!pgm) throw new Error('Program not initialized');

      const configInfo = configAccount ?? await fetchConfig();
      if (!configInfo) {
        throw new Error('Config account not initialized. Run `yarn init:localnet-config` in the project root.');
      }

      const [configPda] = PublicKey.findProgramAddressSync([Buffer.from(CONFIG_SEED)], PROGRAM_ID);
      const [campaignVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), campaignPubkey.toBuffer()],
        PROGRAM_ID
      );
      const [milestonePda] = PublicKey.findProgramAddressSync(
        [Buffer.from(MILESTONE_SEED), campaignPubkey.toBuffer(), new BN(index).toArrayLike(Buffer, 'le', 8)],
        PROGRAM_ID
      );

      const tx = await pgm.methods
        .releaseMilestoneFunds()
        .accounts({
          creator: publicKey,
          campaign: campaignPubkey,
          milestone: milestonePda,
          campaignVault: campaignVaultPda,
          config: configPda,
          treasury: configInfo.treasury,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      const signature = await sendTransaction(tx, connection, { skipPreflight: false });
      await connection.confirmTransaction(signature, 'confirmed');

      return true;
    } catch (err: any) {
      console.error('Error releasing milestone funds:', err);
      setError(err.message ?? 'Failed to release milestone funds');
      return false;
    }
  }, [publicKey, program, configAccount, fetchConfig, sendTransaction, connection]);

  const failCampaignAndOpenRefunds = useCallback(async (campaignPubkey: PublicKey, index: number): Promise<boolean> => {
    if (!publicKey) throw new Error('Wallet not connected');

    try {
      setError(null);
      const pgm = program();
      if (!pgm) throw new Error('Program not initialized');

      const [milestonePda] = PublicKey.findProgramAddressSync(
        [Buffer.from(MILESTONE_SEED), campaignPubkey.toBuffer(), new BN(index).toArrayLike(Buffer, 'le', 8)],
        PROGRAM_ID
      );

      const tx = await pgm.methods
        .failCampaignAndOpenRefunds()
        .accounts({
          creator: publicKey,
          campaign: campaignPubkey,
          milestone: milestonePda,
        })
        .transaction();

      const signature = await sendTransaction(tx, connection, { skipPreflight: false });
      await connection.confirmTransaction(signature, 'confirmed');

      return true;
    } catch (err: any) {
      console.error('Error opening refunds after milestone failure:', err);
      setError(err.message ?? 'Failed to open milestone refunds');
      return false;
    }
  }, [publicKey, program, sendTransaction, connection]);

  const openDispute = useCallback(async (campaignPubkey: PublicKey, index: number): Promise<boolean> => {
    if (!publicKey) throw new Error('Wallet not connected');

    try {
      setError(null);
      const pgm = program();
      if (!pgm) throw new Error('Program not initialized');

      const [milestonePda] = PublicKey.findProgramAddressSync(
        [Buffer.from(MILESTONE_SEED), campaignPubkey.toBuffer(), new BN(index).toArrayLike(Buffer, 'le', 8)],
        PROGRAM_ID
      );

      const tx = await pgm.methods
        .openDispute()
        .accounts({
          creator: publicKey,
          campaign: campaignPubkey,
          milestone: milestonePda,
        })
        .transaction();

      const signature = await sendTransaction(tx, connection, { skipPreflight: false });
      await connection.confirmTransaction(signature, 'confirmed');

      return true;
    } catch (err: any) {
      console.error('Error opening dispute:', err);
      setError(err.message ?? 'Failed to open dispute');
      return false;
    }
  }, [publicKey, program, sendTransaction, connection]);

  const resolveDispute = useCallback(async (
    campaignPubkey: PublicKey,
    index: number,
    decision: 'approveMilestone' | 'openRefunds'
  ): Promise<boolean> => {
    if (!publicKey) throw new Error('Wallet not connected');

    try {
      setError(null);
      const pgm = program();
      if (!pgm) throw new Error('Program not initialized');

      const [configPda] = PublicKey.findProgramAddressSync([Buffer.from(CONFIG_SEED)], PROGRAM_ID);
      const [milestonePda] = PublicKey.findProgramAddressSync(
        [Buffer.from(MILESTONE_SEED), campaignPubkey.toBuffer(), new BN(index).toArrayLike(Buffer, 'le', 8)],
        PROGRAM_ID
      );

      const tx = await pgm.methods
        .resolveDispute({ [decision]: {} })
        .accounts({
          arbiter: publicKey,
          campaign: campaignPubkey,
          milestone: milestonePda,
          config: configPda,
        })
        .transaction();

      const signature = await sendTransaction(tx, connection, { skipPreflight: false });
      await connection.confirmTransaction(signature, 'confirmed');

      return true;
    } catch (err: any) {
      console.error('Error resolving dispute:', err);
      setError(err.message ?? 'Failed to resolve dispute');
      return false;
    }
  }, [publicKey, program, sendTransaction, connection]);

  const createCampaign = useCallback(async (
    title: string,
    description: string,
    goalAmountSol: number,
    endTimeUnix: number
  ): Promise<PublicKey | null> => {
    if (!publicKey) throw new Error('Wallet not connected');

    try {
      setError(null);

      const nonce = nextNonce;
      const nonceBN = new BN(nonce);
      setNextNonce((value) => value + 1);

      const pgm = program();
      if (!pgm) throw new Error('Program not initialized');

      const goalAmountLamports = new BN(Math.floor(goalAmountSol * 1e9));
      const endTimeBN = new BN(endTimeUnix);

      const [campaignPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('campaign'), publicKey.toBuffer(), nonceBN.toArrayLike(Buffer, 'le', 8)],
        PROGRAM_ID
      );
      const [campaignVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), campaignPda.toBuffer()],
        PROGRAM_ID
      );

      const tx = await pgm.methods
        .initializeCampaign(title, description, goalAmountLamports, endTimeBN, nonceBN)
        .accounts({
          creator: publicKey,
          campaign: campaignPda,
          campaignVault: campaignVaultPda,
          systemProgram: SystemProgram.programId,
          clock: CLOCK_PUBKEY,
        })
        .transaction();

      const signature = await sendTransaction(tx, connection, { skipPreflight: false });
      await connection.confirmTransaction(signature, 'confirmed');

      return campaignPda;
    } catch (err: any) {
      console.error('Error creating campaign:', err);
      let errorMessage = err.message ?? 'Failed to create campaign';

      if (errorMessage.includes('WalletSendTransactionError') || errorMessage.includes('Unexpected error')) {
        errorMessage =
          'Кошелёк не смог отправить транзакцию. Проверьте, что:\n' +
          '• wallet переключён на localnet/localhost\n' +
          '• на localnet-адресе есть SOL для комиссии и rent\n' +
          '• local validator запущен на http://127.0.0.1:8899';
      }

      setError(errorMessage);
      return null;
    }
  }, [publicKey, nextNonce, program, sendTransaction, connection]);

  const pledge = useCallback(async (campaignPubkey: PublicKey, amountSol: number): Promise<boolean> => {
    if (!publicKey) throw new Error('Wallet not connected');

    try {
      setError(null);

      const pgm = program();
      if (!pgm) throw new Error('Program not initialized');

      const campaignInfo = await fetchCampaignAccount(campaignPubkey);
      const amountLamports = new BN(Math.floor(amountSol * 1e9));

      const [pledgePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('pledge'), publicKey.toBuffer(), campaignPubkey.toBuffer()],
        PROGRAM_ID
      );
      const [campaignVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), campaignPubkey.toBuffer()],
        PROGRAM_ID
      );

      const tx = await pgm.methods
        .pledge(amountLamports)
        .accounts({
          backer: publicKey,
          campaign: campaignPubkey,
          campaignVault: campaignVaultPda,
          pledge: pledgePda,
          systemProgram: SystemProgram.programId,
          clock: CLOCK_PUBKEY,
          creator: campaignInfo.creator,
        })
        .transaction();

      const signature = await sendTransaction(tx, connection, { skipPreflight: false });
      await connection.confirmTransaction(signature, 'confirmed');

      return true;
    } catch (err: any) {
      console.error('Error making pledge:', err);
      setError(err.message ?? 'Failed to pledge');
      return false;
    }
  }, [publicKey, program, fetchCampaignAccount, sendTransaction, connection]);

  const cancelPledge = useCallback(async (campaignPubkey: PublicKey): Promise<boolean> => {
    if (!publicKey) throw new Error('Wallet not connected');

    try {
      setError(null);

      const pgm = program();
      if (!pgm) throw new Error('Program not initialized');

      const campaignInfo = await fetchCampaignAccount(campaignPubkey);
      const [pledgePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('pledge'), publicKey.toBuffer(), campaignPubkey.toBuffer()],
        PROGRAM_ID
      );
      const [campaignVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), campaignPubkey.toBuffer()],
        PROGRAM_ID
      );

      const tx = await pgm.methods
        .cancelPledge()
        .accounts({
          backer: publicKey,
          campaign: campaignPubkey,
          campaignVault: campaignVaultPda,
          pledge: pledgePda,
          systemProgram: SystemProgram.programId,
          clock: CLOCK_PUBKEY,
          creator: campaignInfo.creator,
        })
        .transaction();

      const signature = await sendTransaction(tx, connection, { skipPreflight: false });
      await connection.confirmTransaction(signature, 'confirmed');

      return true;
    } catch (err: any) {
      console.error('Error cancelling pledge:', err);
      setError(err.message ?? 'Failed to cancel pledge');
      return false;
    }
  }, [publicKey, program, fetchCampaignAccount, sendTransaction, connection]);

  const cancelCampaign = useCallback(async (campaignPubkey: PublicKey): Promise<boolean> => {
    if (!publicKey) throw new Error('Wallet not connected');

    try {
      setError(null);

      const pgm = program();
      if (!pgm) throw new Error('Program not initialized');

      const tx = await pgm.methods
        .cancelCampaign()
        .accounts({
          creator: publicKey,
          campaign: campaignPubkey,
          clock: CLOCK_PUBKEY,
        })
        .transaction();

      const signature = await sendTransaction(tx, connection, { skipPreflight: false });
      await connection.confirmTransaction(signature, 'confirmed');

      return true;
    } catch (err: any) {
      console.error('Error cancelling campaign:', err);
      setError(err.message ?? 'Failed to cancel campaign');
      return false;
    }
  }, [publicKey, program, sendTransaction, connection]);

  const claim = useCallback(async (campaignPubkey: PublicKey): Promise<boolean> => {
    if (!publicKey) throw new Error('Wallet not connected');

    try {
      setError(null);

      const pgm = program();
      if (!pgm) throw new Error('Program not initialized');

      const configInfo = configAccount ?? await fetchConfig();
      if (!configInfo) {
        throw new Error('Config account not initialized. Run `yarn init:localnet-config` in the project root.');
      }
      const [campaignVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), campaignPubkey.toBuffer()],
        PROGRAM_ID
      );
      const tx = await pgm.methods
        .claim()
        .accounts({
          creator: publicKey,
          campaign: campaignPubkey,
          campaignVault: campaignVaultPda,
          config: PublicKey.findProgramAddressSync([Buffer.from(CONFIG_SEED)], PROGRAM_ID)[0],
          treasury: configInfo.treasury,
          systemProgram: SystemProgram.programId,
          clock: CLOCK_PUBKEY,
        })
        .transaction();

      const signature = await sendTransaction(tx, connection, { skipPreflight: false });
      await connection.confirmTransaction(signature, 'confirmed');

      return true;
    } catch (err: any) {
      console.error('Error claiming:', err);
      setError(err.message ?? 'Failed to claim');
      return false;
    }
  }, [publicKey, program, configAccount, fetchConfig, sendTransaction, connection]);

  const settleCampaign = useCallback(async (campaignPubkey: PublicKey, creatorPubkey: PublicKey): Promise<boolean> => {
    if (!publicKey) throw new Error('Wallet not connected');

    try {
      setError(null);

      const pgm = program();
      if (!pgm) throw new Error('Program not initialized');

      const configInfo = configAccount ?? await fetchConfig();
      if (!configInfo) {
        throw new Error('Config account not initialized. Run `yarn init:localnet-config` in the project root.');
      }
      const [configPda] = PublicKey.findProgramAddressSync([Buffer.from(CONFIG_SEED)], PROGRAM_ID);
      const [campaignVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), campaignPubkey.toBuffer()],
        PROGRAM_ID
      );

      const tx = await pgm.methods
        .settleCampaign()
        .accounts({
          settler: publicKey,
          campaign: campaignPubkey,
          campaignVault: campaignVaultPda,
          config: configPda,
          treasury: configInfo.treasury,
          creator: creatorPubkey,
          systemProgram: SystemProgram.programId,
          clock: CLOCK_PUBKEY,
        })
        .transaction();

      const signature = await sendTransaction(tx, connection, { skipPreflight: false });
      await connection.confirmTransaction(signature, 'confirmed');

      return true;
    } catch (err: any) {
      console.error('Error settling campaign:', err);
      setError(err.message ?? 'Failed to settle campaign');
      return false;
    }
  }, [publicKey, program, configAccount, fetchConfig, sendTransaction, connection]);

  const extendCampaign = useCallback(async (campaignPubkey: PublicKey, newEndTime: number): Promise<boolean> => {
    if (!publicKey) throw new Error('Wallet not connected');

    try {
      setError(null);

      const pgm = program();
      if (!pgm) throw new Error('Program not initialized');

      const tx = await pgm.methods
        .extendCampaign(new BN(newEndTime))
        .accounts({
          creator: publicKey,
          campaign: campaignPubkey,
          clock: CLOCK_PUBKEY,
        })
        .transaction();

      const signature = await sendTransaction(tx, connection, { skipPreflight: false });
      await connection.confirmTransaction(signature, 'confirmed');

      return true;
    } catch (err: any) {
      console.error('Error extending campaign:', err);
      setError(err.message ?? 'Failed to extend campaign');
      return false;
    }
  }, [publicKey, program, sendTransaction, connection]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  return {
    campaigns,
    milestones,
    loading,
    error,
    configAccount,
    fetchCampaigns,
    fetchCampaignAccount,
    fetchMilestones,
    fetchPledgeAccount,
    createCampaign,
    createMilestone,
    pledge,
    cancelPledge,
    cancelCampaign,
    claim,
    settleCampaign,
    extendCampaign,
    submitMilestone,
    voteMilestone,
    finalizeMilestone,
    releaseMilestoneFunds,
    failCampaignAndOpenRefunds,
    openDispute,
    resolveDispute,
  };
}
