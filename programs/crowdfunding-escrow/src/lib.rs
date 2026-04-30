use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_instruction;
use anchor_lang::system_program::{self, CreateAccount};

declare_id!("FWh6EtpM5usrduc89K6YEQZ6GQ5UmycGHfM6VSrPcpUz");

#[program]
pub mod crowdfunding_escrow {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, fee_bps: u16) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, CampaignError::InvalidFeeBps);

        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.arbiter = ctx.accounts.admin.key();
        config.treasury = ctx.accounts.treasury.key();
        config.fee_bps = fee_bps;
        config.bump = ctx.bumps.config;

        emit!(ConfigInitialized {
            admin: config.admin,
            arbiter: config.arbiter,
            treasury: config.treasury,
            fee_bps,
        });

        Ok(())
    }

    /// Initialize a new crowdfunding campaign
    pub fn initialize_campaign(
        ctx: Context<InitializeCampaign>,
        title: String,
        description: String,
        goal_amount: u64,
        end_time: i64,
        nonce: u64,
    ) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;

        require!(goal_amount > 0, CampaignError::InvalidGoalAmount);
        require!(
            end_time > Clock::get()?.unix_timestamp,
            CampaignError::InvalidEndTime
        );
        require!(title.len() <= 100, CampaignError::TitleTooLong);
        require!(description.len() <= 1000, CampaignError::DescriptionTooLong);

        campaign.creator = ctx.accounts.creator.key();
        campaign.title = title;
        campaign.description = description;
        campaign.goal_amount = goal_amount;
        campaign.current_amount = 0;
        campaign.backers_count = 0;
        campaign.total_pledged = 0;
        campaign.total_refunded = 0;
        campaign.claimed_amount = 0;
        campaign.start_time = Clock::get()?.unix_timestamp;
        campaign.end_time = end_time;
        campaign.bump = ctx.bumps.campaign;
        campaign.campaign_vault_bump = ctx.bumps.campaign_vault;
        campaign.nonce = nonce;
        campaign.set_state(CampaignState::Active);

        let campaign_key = campaign.key();
        let campaign_vault_bump = campaign.campaign_vault_bump;
        let vault_bump_seed = [campaign_vault_bump];
        let vault_seeds: &[&[u8]] = &[b"vault", campaign_key.as_ref(), &vault_bump_seed];

        let rent_lamports = Rent::get()?.minimum_balance(0);
        let create_vault_accounts = CreateAccount {
            from: ctx.accounts.creator.to_account_info(),
            to: ctx.accounts.campaign_vault.to_account_info(),
        };
        let signer_seeds: &[&[&[u8]]] = &[vault_seeds];
        let create_vault_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            create_vault_accounts,
            signer_seeds,
        );
        system_program::create_account(
            create_vault_ctx,
            rent_lamports,
            0,
            &ctx.accounts.system_program.key(),
        )?;

        emit!(CampaignCreated {
            campaign: campaign.key(),
            creator: ctx.accounts.creator.key(),
            goal_amount,
            end_time,
        });

        Ok(())
    }

    /// Pledge to a campaign
    pub fn pledge(ctx: Context<Pledge>, amount: u64) -> Result<()> {
        require!(amount > 0, CampaignError::InvalidPledgeAmount);

        let campaign = &mut ctx.accounts.campaign;
        let clock = Clock::get()?;

        require!(
            campaign.state == CampaignState::Active,
            CampaignError::InvalidCampaignState
        );
        require!(
            clock.unix_timestamp < campaign.end_time,
            CampaignError::CampaignEnded
        );

        let transfer_ix = system_instruction::transfer(
            &ctx.accounts.backer.key(),
            &ctx.accounts.campaign_vault.key(),
            amount,
        );
        anchor_lang::solana_program::program::invoke(
            &transfer_ix,
            &[
                ctx.accounts.backer.to_account_info(),
                ctx.accounts.campaign_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        campaign.current_amount = campaign
            .current_amount
            .checked_add(amount)
            .ok_or(CampaignError::AmountOverflow)?;
        campaign.total_pledged = campaign
            .total_pledged
            .checked_add(amount)
            .ok_or(CampaignError::AmountOverflow)?;

        let pledge = &mut ctx.accounts.pledge;
        if pledge.amount == 0 {
            pledge.backer = ctx.accounts.backer.key();
            pledge.campaign = campaign.key();
            pledge.amount = amount;
            pledge.refunded_amount = 0;
            pledge.is_refunded = false;
            pledge.bump = ctx.bumps.pledge;
            campaign.backers_count = campaign
                .backers_count
                .checked_add(1)
                .ok_or(CampaignError::AmountOverflow)?;
        } else {
            require!(!pledge.is_refunded, CampaignError::PledgeAlreadyRefunded);
            pledge.amount = pledge
                .amount
                .checked_add(amount)
                .ok_or(CampaignError::AmountOverflow)?;
        }

        emit!(PledgeMade {
            campaign: campaign.key(),
            backer: ctx.accounts.backer.key(),
            amount,
        });

        Ok(())
    }

    /// Register a milestone for a campaign. Milestones define staged fund release.
    pub fn create_milestone(
        ctx: Context<CreateMilestone>,
        index: u64,
        title: String,
        description: String,
        amount: u64,
        voting_end_time: i64,
    ) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        let milestone = &mut ctx.accounts.milestone;
        let clock = Clock::get()?;

        require!(
            campaign.creator == ctx.accounts.creator.key(),
            CampaignError::Unauthorized
        );
        require!(
            matches!(
                campaign.state,
                CampaignState::Active | CampaignState::Successful
            ),
            CampaignError::InvalidCampaignState
        );
        require!(amount > 0, CampaignError::InvalidMilestoneAmount);
        require!(title.len() <= 100, CampaignError::TitleTooLong);
        require!(
            description.len() <= 300,
            CampaignError::MilestoneDescriptionTooLong
        );
        require!(
            voting_end_time > clock.unix_timestamp,
            CampaignError::InvalidVotingEndTime
        );

        let next_total = campaign
            .milestone_amount_total
            .checked_add(amount)
            .ok_or(CampaignError::AmountOverflow)?;
        require!(
            next_total <= campaign.goal_amount,
            CampaignError::MilestoneTotalExceeded
        );

        milestone.campaign = campaign.key();
        milestone.index = index;
        milestone.title = title;
        milestone.description = description;
        milestone.amount = amount;
        milestone.votes_for = 0;
        milestone.votes_against = 0;
        milestone.submitted_at = 0;
        milestone.voting_end_time = voting_end_time;
        milestone.released_amount = 0;
        milestone.dispute_opened_by = Pubkey::default();
        milestone.bump = ctx.bumps.milestone;
        milestone.set_state(MilestoneState::Pending);

        campaign.milestone_count = campaign
            .milestone_count
            .checked_add(1)
            .ok_or(CampaignError::AmountOverflow)?;
        campaign.milestone_amount_total = next_total;

        emit!(MilestoneCreated {
            campaign: campaign.key(),
            milestone: milestone.key(),
            index,
            amount,
            voting_end_time,
        });

        Ok(())
    }

    /// Submit a milestone for backer review after fundraising succeeds.
    pub fn submit_milestone(ctx: Context<SubmitMilestone>) -> Result<()> {
        let campaign = &ctx.accounts.campaign;
        let milestone = &mut ctx.accounts.milestone;
        let clock = Clock::get()?;

        require!(
            campaign.creator == ctx.accounts.creator.key(),
            CampaignError::Unauthorized
        );
        require!(
            campaign.milestone_count > 0,
            CampaignError::MilestoneFlowNotConfigured
        );
        require!(
            campaign.state == CampaignState::Successful,
            CampaignError::InvalidCampaignState
        );
        require!(
            matches!(
                milestone.state,
                MilestoneState::Pending | MilestoneState::Rejected
            ),
            CampaignError::InvalidMilestoneState
        );
        require!(
            clock.unix_timestamp < milestone.voting_end_time,
            CampaignError::VotingWindowClosed
        );

        milestone.votes_for = 0;
        milestone.votes_against = 0;
        milestone.submitted_at = clock.unix_timestamp;
        milestone.set_state(MilestoneState::ReadyForReview);

        emit!(MilestoneSubmitted {
            campaign: campaign.key(),
            milestone: milestone.key(),
            index: milestone.index,
            submitted_at: milestone.submitted_at,
        });

        Ok(())
    }

    /// Cast a weighted vote for a submitted milestone.
    pub fn vote_milestone(ctx: Context<VoteMilestone>, approve: bool) -> Result<()> {
        let campaign = &ctx.accounts.campaign;
        let milestone = &mut ctx.accounts.milestone;
        let vote = &mut ctx.accounts.milestone_vote;
        let pledge = &ctx.accounts.pledge;
        let clock = Clock::get()?;

        require!(
            campaign.state == CampaignState::Successful,
            CampaignError::InvalidCampaignState
        );
        require!(
            campaign.milestone_count > 0,
            CampaignError::MilestoneFlowNotConfigured
        );
        require!(pledge.amount > 0, CampaignError::NotABacker);
        require!(!pledge.is_refunded, CampaignError::NotABacker);
        require!(
            milestone.state == MilestoneState::ReadyForReview,
            CampaignError::InvalidMilestoneState
        );
        require!(
            clock.unix_timestamp <= milestone.voting_end_time,
            CampaignError::VotingWindowClosed
        );

        vote.milestone = milestone.key();
        vote.backer = ctx.accounts.backer.key();
        vote.approve = approve;
        vote.weight = pledge.amount;
        vote.bump = ctx.bumps.milestone_vote;

        if approve {
            milestone.votes_for = milestone
                .votes_for
                .checked_add(pledge.amount)
                .ok_or(CampaignError::AmountOverflow)?;
        } else {
            milestone.votes_against = milestone
                .votes_against
                .checked_add(pledge.amount)
                .ok_or(CampaignError::AmountOverflow)?;
        }

        emit!(MilestoneVoteCast {
            campaign: campaign.key(),
            milestone: milestone.key(),
            backer: ctx.accounts.backer.key(),
            approve,
            weight: pledge.amount,
        });

        Ok(())
    }

    /// Finalize milestone voting once quorum or timeout conditions are met.
    pub fn finalize_milestone(ctx: Context<FinalizeMilestone>) -> Result<()> {
        let campaign = &ctx.accounts.campaign;
        let milestone = &mut ctx.accounts.milestone;
        let clock = Clock::get()?;

        require!(
            campaign.state == CampaignState::Successful,
            CampaignError::InvalidCampaignState
        );
        require!(
            milestone.state == MilestoneState::ReadyForReview,
            CampaignError::InvalidMilestoneState
        );

        let approvals_reached = (milestone.votes_for as u128) * 2 > campaign.total_pledged as u128;
        let rejections_reached =
            (milestone.votes_against as u128) * 2 >= campaign.total_pledged as u128;
        let voting_ended = clock.unix_timestamp > milestone.voting_end_time;

        require!(
            approvals_reached || rejections_reached || voting_ended,
            CampaignError::VotingStillOpen
        );

        if approvals_reached {
            milestone.set_state(MilestoneState::Approved);
        } else {
            milestone.set_state(MilestoneState::Rejected);
        }

        emit!(MilestoneFinalized {
            campaign: campaign.key(),
            milestone: milestone.key(),
            index: milestone.index,
            final_state: milestone.state,
            votes_for: milestone.votes_for,
            votes_against: milestone.votes_against,
        });

        Ok(())
    }

    /// Open a formal dispute for a rejected milestone so the arbiter can make the final decision.
    pub fn open_dispute(ctx: Context<OpenDispute>) -> Result<()> {
        let campaign = &ctx.accounts.campaign;
        let milestone = &mut ctx.accounts.milestone;

        require!(
            campaign.creator == ctx.accounts.creator.key(),
            CampaignError::Unauthorized
        );
        require!(
            campaign.state == CampaignState::Successful,
            CampaignError::InvalidCampaignState
        );
        require!(
            milestone.state == MilestoneState::Rejected,
            CampaignError::MilestoneNotRejected
        );

        milestone.dispute_opened_by = ctx.accounts.creator.key();
        milestone.set_state(MilestoneState::Disputed);

        emit!(MilestoneDisputed {
            campaign: campaign.key(),
            milestone: milestone.key(),
            index: milestone.index,
            opened_by: ctx.accounts.creator.key(),
        });

        Ok(())
    }

    /// Resolve a disputed milestone via arbiter decision.
    pub fn resolve_dispute(
        ctx: Context<ResolveDispute>,
        decision: ArbitrationDecision,
    ) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        let milestone = &mut ctx.accounts.milestone;

        require!(
            ctx.accounts.config.arbiter == ctx.accounts.arbiter.key(),
            CampaignError::Unauthorized
        );
        require!(
            campaign.state == CampaignState::Successful,
            CampaignError::InvalidCampaignState
        );
        require!(
            milestone.state == MilestoneState::Disputed,
            CampaignError::MilestoneNotDisputed
        );

        match decision {
            ArbitrationDecision::ApproveMilestone => {
                milestone.set_state(MilestoneState::Approved);
            }
            ArbitrationDecision::OpenRefunds => {
                record_refund_snapshot(campaign)?;
                campaign.set_state(CampaignState::Failed);
                milestone.set_state(MilestoneState::Rejected);

                emit!(CampaignEnteredRefundMode {
                    campaign: campaign.key(),
                    refund_pool_amount: campaign.refund_snapshot_amount,
                    refund_pool_total_pledged: campaign.refund_snapshot_total_pledged,
                });
            }
        }

        emit!(DisputeResolved {
            campaign: campaign.key(),
            milestone: milestone.key(),
            index: milestone.index,
            resolved_by: ctx.accounts.arbiter.key(),
            decision,
        });

        Ok(())
    }

    /// Release milestone funds after approval. Gross milestone amount is split into creator payout and treasury fee.
    pub fn release_milestone_funds(ctx: Context<ReleaseMilestoneFunds>) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        let milestone = &mut ctx.accounts.milestone;

        require!(
            campaign.creator == ctx.accounts.creator.key(),
            CampaignError::Unauthorized
        );
        require!(
            campaign.state == CampaignState::Successful,
            CampaignError::InvalidCampaignState
        );
        require!(
            campaign.milestone_count > 0,
            CampaignError::MilestoneFlowNotConfigured
        );
        require!(
            milestone.state == MilestoneState::Approved,
            CampaignError::InvalidMilestoneState
        );
        require!(
            milestone.released_amount == 0,
            CampaignError::MilestoneAlreadyReleased
        );
        require!(
            campaign.current_amount >= milestone.amount,
            CampaignError::InsufficientEscrowBalance
        );

        let fee_amount = milestone
            .amount
            .checked_mul(ctx.accounts.config.fee_bps as u64)
            .ok_or(CampaignError::AmountOverflow)?
            / MAX_FEE_BPS as u64;
        let creator_amount = milestone
            .amount
            .checked_sub(fee_amount)
            .ok_or(CampaignError::AmountUnderflow)?;

        transfer_from_vault(
            &ctx.accounts.campaign_vault,
            &ctx.accounts.creator.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            campaign.key(),
            campaign.campaign_vault_bump,
            creator_amount,
        )?;

        if fee_amount > 0 {
            transfer_from_vault(
                &ctx.accounts.campaign_vault,
                &ctx.accounts.treasury.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                campaign.key(),
                campaign.campaign_vault_bump,
                fee_amount,
            )?;
        }

        milestone.released_amount = milestone.amount;
        milestone.set_state(MilestoneState::Released);

        campaign.current_amount = campaign
            .current_amount
            .checked_sub(milestone.amount)
            .ok_or(CampaignError::AmountUnderflow)?;
        campaign.claimed_amount = campaign
            .claimed_amount
            .checked_add(creator_amount)
            .ok_or(CampaignError::AmountOverflow)?;
        campaign.milestone_amount_released = campaign
            .milestone_amount_released
            .checked_add(milestone.amount)
            .ok_or(CampaignError::AmountOverflow)?;
        campaign.released_milestones = campaign
            .released_milestones
            .checked_add(1)
            .ok_or(CampaignError::AmountOverflow)?;

        if campaign.released_milestones == campaign.milestone_count {
            campaign.set_state(CampaignState::Claimed);
        }

        emit!(MilestoneFundsReleased {
            campaign: campaign.key(),
            milestone: milestone.key(),
            index: milestone.index,
            gross_amount: milestone.amount,
            creator_amount,
            fee_amount,
        });

        Ok(())
    }

    /// Fail a milestone campaign after a rejected review and open proportional refunds for backers.
    pub fn fail_campaign_and_open_refunds(ctx: Context<FailCampaignAndOpenRefunds>) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        let milestone = &ctx.accounts.milestone;

        require!(
            campaign.creator == ctx.accounts.creator.key(),
            CampaignError::Unauthorized
        );
        require!(
            campaign.state == CampaignState::Successful,
            CampaignError::InvalidCampaignState
        );
        require!(
            campaign.milestone_count > 0,
            CampaignError::MilestoneFlowNotConfigured
        );
        require!(
            milestone.state == MilestoneState::Rejected,
            CampaignError::MilestoneNotRejected
        );

        record_refund_snapshot(campaign)?;
        campaign.set_state(CampaignState::Failed);

        emit!(CampaignEnteredRefundMode {
            campaign: campaign.key(),
            refund_pool_amount: campaign.refund_snapshot_amount,
            refund_pool_total_pledged: campaign.refund_snapshot_total_pledged,
        });

        Ok(())
    }

    /// Cancel a pledge and get refund (only if campaign failed)
    pub fn cancel_pledge(ctx: Context<CancelPledge>) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        let pledge = &mut ctx.accounts.pledge;
        let clock = Clock::get()?;

        require!(
            pledge.backer == ctx.accounts.backer.key(),
            CampaignError::Unauthorized
        );
        require!(!pledge.is_refunded, CampaignError::PledgeAlreadyRefunded);

        if let Some(final_state) = refresh_campaign_state_if_needed(campaign, clock.unix_timestamp)?
        {
            emit!(CampaignFinalized {
                campaign: campaign.key(),
                final_state,
                total_amount: campaign.current_amount,
            });
        }

        let can_refund = matches!(
            campaign.state,
            CampaignState::Cancelled | CampaignState::Failed
        );

        require!(can_refund, CampaignError::RefundNotAvailable);

        let refund_amount = calculate_refund_amount(campaign, pledge)?;
        require!(refund_amount > 0, CampaignError::RefundAlreadyClaimed);

        let transfer_ix = system_instruction::transfer(
            &ctx.accounts.campaign_vault.key(),
            &ctx.accounts.backer.key(),
            refund_amount,
        );

        let campaign_key = campaign.key();
        let campaign_vault_bump = campaign.campaign_vault_bump;
        let vault_seeds = &[b"vault", campaign_key.as_ref(), &[campaign_vault_bump]];

        anchor_lang::solana_program::program::invoke_signed(
            &transfer_ix,
            &[
                ctx.accounts.campaign_vault.to_account_info(),
                ctx.accounts.backer.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[vault_seeds],
        )?;

        pledge.refunded_amount = pledge
            .refunded_amount
            .checked_add(refund_amount)
            .ok_or(CampaignError::AmountOverflow)?;
        pledge.is_refunded = true;
        campaign.current_amount = campaign
            .current_amount
            .checked_sub(refund_amount)
            .ok_or(CampaignError::AmountUnderflow)?;
        campaign.total_refunded = campaign
            .total_refunded
            .checked_add(refund_amount)
            .ok_or(CampaignError::AmountOverflow)?;

        emit!(PledgeRefunded {
            campaign: campaign.key(),
            backer: ctx.accounts.backer.key(),
            amount: refund_amount,
        });

        Ok(())
    }

    /// Claim funds if campaign reached its goal
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        let clock = Clock::get()?;

        require!(
            campaign.creator == ctx.accounts.creator.key(),
            CampaignError::Unauthorized
        );

        if let Some(final_state) = refresh_campaign_state_if_needed(campaign, clock.unix_timestamp)?
        {
            emit!(CampaignFinalized {
                campaign: campaign.key(),
                final_state,
                total_amount: campaign.current_amount,
            });
        }

        require!(
            campaign.state == CampaignState::Successful,
            CampaignError::InvalidCampaignState
        );
        require!(
            campaign.milestone_count == 0,
            CampaignError::MilestoneFlowRequired
        );
        let campaign_key = campaign.key();

        let (creator_amount, fee_amount) = settle_successful_campaign(
            campaign,
            campaign_key,
            &ctx.accounts.campaign_vault,
            &ctx.accounts.creator.to_account_info(),
            &ctx.accounts.treasury.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            ctx.accounts.config.fee_bps,
        )?;

        emit!(CampaignClaimed {
            campaign: campaign.key(),
            creator: ctx.accounts.creator.key(),
            amount: creator_amount,
            fee_amount,
        });

        Ok(())
    }

    /// Finalize campaign after deadline and fix its terminal state on-chain
    pub fn finalize_campaign(ctx: Context<FinalizeCampaign>) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        let clock = Clock::get()?;

        require!(
            campaign.state == CampaignState::Active,
            CampaignError::CampaignAlreadyFinalized
        );

        let final_state = refresh_campaign_state_if_needed(campaign, clock.unix_timestamp)?
            .ok_or(CampaignError::CampaignNotEnded)?;

        emit!(CampaignFinalized {
            campaign: campaign.key(),
            final_state,
            total_amount: campaign.current_amount,
        });

        Ok(())
    }

    /// Settle campaign after deadline:
    /// - successful campaigns are automatically funded to creator/treasury
    /// - failed campaigns are finalized into Failed state and open refunds
    pub fn settle_campaign(ctx: Context<SettleCampaign>) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        let clock = Clock::get()?;

        require!(
            campaign.state == CampaignState::Active,
            CampaignError::CampaignAlreadyFinalized
        );

        let final_state = refresh_campaign_state_if_needed(campaign, clock.unix_timestamp)?
            .ok_or(CampaignError::CampaignNotEnded)?;

        if final_state == CampaignState::Successful {
            if campaign.milestone_count > 0 {
                emit!(CampaignSettled {
                    campaign: campaign.key(),
                    final_state: CampaignState::Successful,
                    creator_amount: 0,
                    fee_amount: 0,
                });
                return Ok(());
            }

            let campaign_key = campaign.key();
            let (creator_amount, fee_amount) = settle_successful_campaign(
                campaign,
                campaign_key,
                &ctx.accounts.campaign_vault,
                &ctx.accounts.creator.to_account_info(),
                &ctx.accounts.treasury.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                ctx.accounts.config.fee_bps,
            )?;

            emit!(CampaignSettled {
                campaign: campaign.key(),
                final_state: CampaignState::Claimed,
                creator_amount,
                fee_amount,
            });
        } else {
            campaign.set_state(CampaignState::Failed);

            emit!(CampaignSettled {
                campaign: campaign.key(),
                final_state: CampaignState::Failed,
                creator_amount: 0,
                fee_amount: 0,
            });
        }

        Ok(())
    }

    /// Cancel campaign (only by creator, before end time)
    pub fn cancel_campaign(ctx: Context<CancelCampaign>) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        let clock = Clock::get()?;

        require!(
            campaign.creator == ctx.accounts.creator.key(),
            CampaignError::Unauthorized
        );
        require!(
            campaign.state == CampaignState::Active,
            CampaignError::InvalidCampaignState
        );
        require!(
            clock.unix_timestamp < campaign.end_time,
            CampaignError::CampaignEnded
        );

        record_refund_snapshot(campaign)?;
        campaign.set_state(CampaignState::Cancelled);

        emit!(CampaignCancelled {
            campaign: campaign.key(),
            creator: ctx.accounts.creator.key(),
        });

        Ok(())
    }

    /// Extend campaign end time (only by creator, before current end time)
    pub fn extend_campaign(ctx: Context<ExtendCampaign>, new_end_time: i64) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        let clock = Clock::get()?;

        require!(
            campaign.creator == ctx.accounts.creator.key(),
            CampaignError::Unauthorized
        );
        require!(
            campaign.state == CampaignState::Active,
            CampaignError::InvalidCampaignState
        );
        require!(
            clock.unix_timestamp < campaign.end_time,
            CampaignError::CampaignEnded
        );
        require!(
            new_end_time > campaign.end_time,
            CampaignError::InvalidEndTime
        );

        let old_end_time = campaign.end_time;
        campaign.end_time = new_end_time;

        emit!(CampaignExtended {
            campaign: campaign.key(),
            old_end_time,
            new_end_time,
        });

        Ok(())
    }
}

const MAX_FEE_BPS: u16 = 10_000;

fn refresh_campaign_state_if_needed(
    campaign: &mut Campaign,
    current_unix_timestamp: i64,
) -> Result<Option<CampaignState>> {
    if campaign.state != CampaignState::Active {
        return Ok(None);
    }

    let goal_reached = campaign.current_amount >= campaign.goal_amount;
    let deadline_reached = current_unix_timestamp >= campaign.end_time;

    if !goal_reached && !deadline_reached {
        return Ok(None);
    }

    let final_state = if goal_reached {
        CampaignState::Successful
    } else {
        record_refund_snapshot(campaign)?;
        CampaignState::Failed
    };
    campaign.set_state(final_state);

    Ok(Some(final_state))
}

fn record_refund_snapshot(campaign: &mut Campaign) -> Result<()> {
    if campaign.refund_snapshot_total_pledged == 0 {
        campaign.refund_snapshot_amount = campaign.current_amount;
        campaign.refund_snapshot_total_pledged = campaign.total_pledged;
    }

    Ok(())
}

fn calculate_refund_amount(campaign: &Campaign, pledge: &PledgeAccount) -> Result<u64> {
    if campaign.refund_snapshot_total_pledged == 0 || campaign.refund_snapshot_amount == 0 {
        return Ok(0);
    }

    let refundable_total = ((pledge.amount as u128) * (campaign.refund_snapshot_amount as u128)
        / (campaign.refund_snapshot_total_pledged as u128)) as u64;

    refundable_total
        .checked_sub(pledge.refunded_amount)
        .ok_or(CampaignError::AmountUnderflow.into())
}

fn settle_successful_campaign<'info>(
    campaign: &mut Campaign,
    campaign_key: Pubkey,
    campaign_vault: &SystemAccount<'info>,
    creator: &AccountInfo<'info>,
    treasury: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    fee_bps: u16,
) -> Result<(u64, u64)> {
    let claim_amount = campaign.current_amount;
    let fee_amount = claim_amount
        .checked_mul(fee_bps as u64)
        .ok_or(CampaignError::AmountOverflow)?
        / MAX_FEE_BPS as u64;
    let creator_amount = claim_amount
        .checked_sub(fee_amount)
        .ok_or(CampaignError::AmountUnderflow)?;

    campaign.claimed_amount = campaign
        .claimed_amount
        .checked_add(creator_amount)
        .ok_or(CampaignError::AmountOverflow)?;
    campaign.current_amount = 0;
    campaign.set_state(CampaignState::Claimed);

    transfer_from_vault(
        campaign_vault,
        creator,
        system_program,
        campaign_key,
        campaign.campaign_vault_bump,
        creator_amount,
    )?;

    if fee_amount > 0 {
        transfer_from_vault(
            campaign_vault,
            treasury,
            system_program,
            campaign_key,
            campaign.campaign_vault_bump,
            fee_amount,
        )?;
    }

    Ok((creator_amount, fee_amount))
}

fn transfer_from_vault<'info>(
    campaign_vault: &SystemAccount<'info>,
    recipient: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    campaign_key: Pubkey,
    campaign_vault_bump: u8,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }

    let transfer_ix = system_instruction::transfer(&campaign_vault.key(), &recipient.key(), amount);
    let vault_seeds = &[b"vault", campaign_key.as_ref(), &[campaign_vault_bump]];

    anchor_lang::solana_program::program::invoke_signed(
        &transfer_ix,
        &[
            campaign_vault.to_account_info(),
            recipient.clone(),
            system_program.clone(),
        ],
        &[vault_seeds],
    )?;

    Ok(())
}

// ==================== Account Structures ====================

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    pub treasury: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(title: String, description: String, goal_amount: u64, end_time: i64, nonce: u64)]
pub struct InitializeCampaign<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Campaign::INIT_SPACE,
        seeds = [b"campaign", creator.key().as_ref(), nonce.to_le_bytes().as_ref()],
        bump
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump
    )]
    /// CHECK: This PDA is created in initialize_campaign as a system-owned vault account.
    pub campaign_vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct Pledge<'info> {
    #[account(mut)]
    pub backer: Signer<'info>,

    #[account(
        mut,
        has_one = creator
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump = campaign.campaign_vault_bump
    )]
    pub campaign_vault: SystemAccount<'info>,

    #[account(
        init_if_needed,
        payer = backer,
        space = 8 + PledgeAccount::INIT_SPACE,
        seeds = [b"pledge", backer.key().as_ref(), campaign.key().as_ref()],
        bump
    )]
    pub pledge: Account<'info, PledgeAccount>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,

    /// CHECK: Campaign creator, validated by has_one
    #[account(
        address = campaign.creator
    )]
    pub creator: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct CancelPledge<'info> {
    #[account(mut)]
    pub backer: Signer<'info>,

    #[account(
        mut,
        has_one = creator
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump = campaign.campaign_vault_bump
    )]
    pub campaign_vault: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [b"pledge", backer.key().as_ref(), campaign.key().as_ref()],
        bump = pledge.bump,
        has_one = backer,
        has_one = campaign
    )]
    pub pledge: Account<'info, PledgeAccount>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,

    /// CHECK: Campaign creator, validated by has_one
    #[account(
        address = campaign.creator
    )]
    pub creator: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"campaign", creator.key().as_ref(), campaign.nonce.to_le_bytes().as_ref()],
        bump = campaign.bump,
        has_one = creator
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump = campaign.campaign_vault_bump
    )]
    pub campaign_vault: SystemAccount<'info>,

    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        address = config.treasury
    )]
    pub treasury: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
#[instruction(index: u64, title: String, description: String, amount: u64, voting_end_time: i64)]
pub struct CreateMilestone<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"campaign", creator.key().as_ref(), campaign.nonce.to_le_bytes().as_ref()],
        bump = campaign.bump,
        has_one = creator
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        init,
        payer = creator,
        space = 8 + Milestone::INIT_SPACE,
        seeds = [b"milestone", campaign.key().as_ref(), index.to_le_bytes().as_ref()],
        bump
    )]
    pub milestone: Account<'info, Milestone>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitMilestone<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        seeds = [b"campaign", creator.key().as_ref(), campaign.nonce.to_le_bytes().as_ref()],
        bump = campaign.bump,
        has_one = creator
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [b"milestone", campaign.key().as_ref(), milestone.index.to_le_bytes().as_ref()],
        bump = milestone.bump,
        has_one = campaign
    )]
    pub milestone: Account<'info, Milestone>,

    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct VoteMilestone<'info> {
    #[account(mut)]
    pub backer: Signer<'info>,

    #[account(
        seeds = [b"campaign", campaign.creator.as_ref(), campaign.nonce.to_le_bytes().as_ref()],
        bump = campaign.bump
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [b"milestone", campaign.key().as_ref(), milestone.index.to_le_bytes().as_ref()],
        bump = milestone.bump,
        has_one = campaign
    )]
    pub milestone: Account<'info, Milestone>,

    #[account(
        seeds = [b"pledge", backer.key().as_ref(), campaign.key().as_ref()],
        bump = pledge.bump,
        has_one = backer,
        has_one = campaign
    )]
    pub pledge: Account<'info, PledgeAccount>,

    #[account(
        init,
        payer = backer,
        space = 8 + MilestoneVote::INIT_SPACE,
        seeds = [b"milestone_vote", milestone.key().as_ref(), backer.key().as_ref()],
        bump
    )]
    pub milestone_vote: Account<'info, MilestoneVote>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct FinalizeMilestone<'info> {
    #[account(
        seeds = [b"campaign", campaign.creator.as_ref(), campaign.nonce.to_le_bytes().as_ref()],
        bump = campaign.bump
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [b"milestone", campaign.key().as_ref(), milestone.index.to_le_bytes().as_ref()],
        bump = milestone.bump,
        has_one = campaign
    )]
    pub milestone: Account<'info, Milestone>,

    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct OpenDispute<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        seeds = [b"campaign", creator.key().as_ref(), campaign.nonce.to_le_bytes().as_ref()],
        bump = campaign.bump,
        has_one = creator
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [b"milestone", campaign.key().as_ref(), milestone.index.to_le_bytes().as_ref()],
        bump = milestone.bump,
        has_one = campaign
    )]
    pub milestone: Account<'info, Milestone>,
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(mut)]
    pub arbiter: Signer<'info>,

    #[account(
        mut,
        seeds = [b"campaign", campaign.creator.as_ref(), campaign.nonce.to_le_bytes().as_ref()],
        bump = campaign.bump
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [b"milestone", campaign.key().as_ref(), milestone.index.to_le_bytes().as_ref()],
        bump = milestone.bump,
        has_one = campaign
    )]
    pub milestone: Account<'info, Milestone>,

    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct ReleaseMilestoneFunds<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"campaign", creator.key().as_ref(), campaign.nonce.to_le_bytes().as_ref()],
        bump = campaign.bump,
        has_one = creator
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [b"milestone", campaign.key().as_ref(), milestone.index.to_le_bytes().as_ref()],
        bump = milestone.bump,
        has_one = campaign
    )]
    pub milestone: Account<'info, Milestone>,

    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump = campaign.campaign_vault_bump
    )]
    pub campaign_vault: SystemAccount<'info>,

    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        address = config.treasury
    )]
    pub treasury: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FailCampaignAndOpenRefunds<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"campaign", creator.key().as_ref(), campaign.nonce.to_le_bytes().as_ref()],
        bump = campaign.bump,
        has_one = creator
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        seeds = [b"milestone", campaign.key().as_ref(), milestone.index.to_le_bytes().as_ref()],
        bump = milestone.bump,
        has_one = campaign
    )]
    pub milestone: Account<'info, Milestone>,
}

#[derive(Accounts)]
pub struct FinalizeCampaign<'info> {
    #[account(
        mut,
        seeds = [b"campaign", campaign.creator.as_ref(), campaign.nonce.to_le_bytes().as_ref()],
        bump = campaign.bump
    )]
    pub campaign: Account<'info, Campaign>,

    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct SettleCampaign<'info> {
    #[account(mut)]
    pub settler: Signer<'info>,

    #[account(
        mut,
        seeds = [b"campaign", campaign.creator.as_ref(), campaign.nonce.to_le_bytes().as_ref()],
        bump = campaign.bump
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump = campaign.campaign_vault_bump
    )]
    pub campaign_vault: SystemAccount<'info>,

    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        address = config.treasury
    )]
    pub treasury: SystemAccount<'info>,

    #[account(
        mut,
        address = campaign.creator
    )]
    pub creator: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct CancelCampaign<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"campaign", creator.key().as_ref(), campaign.nonce.to_le_bytes().as_ref()],
        bump = campaign.bump,
        has_one = creator
    )]
    pub campaign: Account<'info, Campaign>,

    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct ExtendCampaign<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"campaign", creator.key().as_ref(), campaign.nonce.to_le_bytes().as_ref()],
        bump = campaign.bump,
        has_one = creator
    )]
    pub campaign: Account<'info, Campaign>,

    pub clock: Sysvar<'info, Clock>,
}

// ==================== Account Definitions ====================

#[account]
#[derive(InitSpace)]
pub struct Campaign {
    pub creator: Pubkey,
    #[max_len(100)]
    pub title: String,
    #[max_len(1000)]
    pub description: String,
    pub goal_amount: u64,
    pub current_amount: u64,
    pub backers_count: u64,
    pub total_pledged: u64,
    pub total_refunded: u64,
    pub claimed_amount: u64,
    pub milestone_count: u64,
    pub released_milestones: u64,
    pub milestone_amount_total: u64,
    pub milestone_amount_released: u64,
    pub refund_snapshot_amount: u64,
    pub refund_snapshot_total_pledged: u64,
    pub start_time: i64,
    pub end_time: i64,
    pub state: CampaignState,
    pub is_claimed: bool,
    pub is_cancelled: bool,
    pub bump: u8,
    pub campaign_vault_bump: u8,
    pub nonce: u64,
}

impl Campaign {
    pub fn set_state(&mut self, state: CampaignState) {
        self.state = state;
        self.is_cancelled = matches!(state, CampaignState::Cancelled);
        self.is_claimed = matches!(state, CampaignState::Claimed);
    }
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub arbiter: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Milestone {
    pub campaign: Pubkey,
    pub index: u64,
    #[max_len(100)]
    pub title: String,
    #[max_len(300)]
    pub description: String,
    pub amount: u64,
    pub votes_for: u64,
    pub votes_against: u64,
    pub submitted_at: i64,
    pub voting_end_time: i64,
    pub released_amount: u64,
    pub dispute_opened_by: Pubkey,
    pub state: MilestoneState,
    pub bump: u8,
}

impl Milestone {
    pub fn set_state(&mut self, state: MilestoneState) {
        self.state = state;
    }
}

#[account]
#[derive(InitSpace)]
pub struct MilestoneVote {
    pub milestone: Pubkey,
    pub backer: Pubkey,
    pub approve: bool,
    pub weight: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum CampaignState {
    Active,
    Successful,
    Failed,
    Cancelled,
    Claimed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum MilestoneState {
    Pending,
    ReadyForReview,
    Approved,
    Rejected,
    Disputed,
    Released,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArbitrationDecision {
    ApproveMilestone,
    OpenRefunds,
}

#[account]
#[derive(InitSpace)]
pub struct PledgeAccount {
    pub backer: Pubkey,
    pub campaign: Pubkey,
    pub amount: u64,
    pub refunded_amount: u64,
    pub is_refunded: bool,
    pub bump: u8,
}

// ==================== Error Definitions ====================

#[error_code]
pub enum CampaignError {
    #[msg("Invalid goal amount")]
    InvalidGoalAmount,
    #[msg("Invalid end time")]
    InvalidEndTime,
    #[msg("Title too long (max 100 characters)")]
    TitleTooLong,
    #[msg("Description too long (max 1000 characters)")]
    DescriptionTooLong,
    #[msg("Invalid pledge amount")]
    InvalidPledgeAmount,
    #[msg("Campaign already claimed")]
    CampaignAlreadyClaimed,
    #[msg("Campaign cancelled")]
    CampaignCancelled,
    #[msg("Campaign ended")]
    CampaignEnded,
    #[msg("Campaign not ended")]
    CampaignNotEnded,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Pledge already refunded")]
    PledgeAlreadyRefunded,
    #[msg("Refund not available")]
    RefundNotAvailable,
    #[msg("Goal not reached")]
    GoalNotReached,
    #[msg("Campaign already cancelled")]
    CampaignAlreadyCancelled,
    #[msg("Amount overflow")]
    AmountOverflow,
    #[msg("Amount underflow")]
    AmountUnderflow,
    #[msg("Invalid campaign state for this operation")]
    InvalidCampaignState,
    #[msg("Campaign already finalized")]
    CampaignAlreadyFinalized,
    #[msg("Invalid fee bps")]
    InvalidFeeBps,
    #[msg("Invalid milestone amount")]
    InvalidMilestoneAmount,
    #[msg("Milestone total exceeds campaign goal amount")]
    MilestoneTotalExceeded,
    #[msg("Milestone description too long (max 300 characters)")]
    MilestoneDescriptionTooLong,
    #[msg("Milestone flow is required for this campaign")]
    MilestoneFlowRequired,
    #[msg("Milestone flow is not configured for this campaign")]
    MilestoneFlowNotConfigured,
    #[msg("Invalid milestone state for this operation")]
    InvalidMilestoneState,
    #[msg("Voting is still open")]
    VotingStillOpen,
    #[msg("Voting window is already closed")]
    VotingWindowClosed,
    #[msg("Invalid voting end time")]
    InvalidVotingEndTime,
    #[msg("Milestone has already been released")]
    MilestoneAlreadyReleased,
    #[msg("Not a valid backer for milestone voting")]
    NotABacker,
    #[msg("Milestone must be rejected before opening refunds")]
    MilestoneNotRejected,
    #[msg("Milestone must be disputed before arbitration")]
    MilestoneNotDisputed,
    #[msg("Insufficient escrow balance for milestone release")]
    InsufficientEscrowBalance,
    #[msg("Refund already claimed")]
    RefundAlreadyClaimed,
}

// ==================== Events ====================

#[event]
pub struct CampaignCreated {
    pub campaign: Pubkey,
    pub creator: Pubkey,
    pub goal_amount: u64,
    pub end_time: i64,
}

#[event]
pub struct PledgeMade {
    pub campaign: Pubkey,
    pub backer: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PledgeRefunded {
    pub campaign: Pubkey,
    pub backer: Pubkey,
    pub amount: u64,
}

#[event]
pub struct CampaignClaimed {
    pub campaign: Pubkey,
    pub creator: Pubkey,
    pub amount: u64,
    pub fee_amount: u64,
}

#[event]
pub struct CampaignCancelled {
    pub campaign: Pubkey,
    pub creator: Pubkey,
}

#[event]
pub struct CampaignExtended {
    pub campaign: Pubkey,
    pub old_end_time: i64,
    pub new_end_time: i64,
}

#[event]
pub struct CampaignFinalized {
    pub campaign: Pubkey,
    pub final_state: CampaignState,
    pub total_amount: u64,
}

#[event]
pub struct CampaignSettled {
    pub campaign: Pubkey,
    pub final_state: CampaignState,
    pub creator_amount: u64,
    pub fee_amount: u64,
}

#[event]
pub struct MilestoneCreated {
    pub campaign: Pubkey,
    pub milestone: Pubkey,
    pub index: u64,
    pub amount: u64,
    pub voting_end_time: i64,
}

#[event]
pub struct MilestoneSubmitted {
    pub campaign: Pubkey,
    pub milestone: Pubkey,
    pub index: u64,
    pub submitted_at: i64,
}

#[event]
pub struct MilestoneVoteCast {
    pub campaign: Pubkey,
    pub milestone: Pubkey,
    pub backer: Pubkey,
    pub approve: bool,
    pub weight: u64,
}

#[event]
pub struct MilestoneFinalized {
    pub campaign: Pubkey,
    pub milestone: Pubkey,
    pub index: u64,
    pub final_state: MilestoneState,
    pub votes_for: u64,
    pub votes_against: u64,
}

#[event]
pub struct MilestoneFundsReleased {
    pub campaign: Pubkey,
    pub milestone: Pubkey,
    pub index: u64,
    pub gross_amount: u64,
    pub creator_amount: u64,
    pub fee_amount: u64,
}

#[event]
pub struct CampaignEnteredRefundMode {
    pub campaign: Pubkey,
    pub refund_pool_amount: u64,
    pub refund_pool_total_pledged: u64,
}

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub arbiter: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
}

#[event]
pub struct MilestoneDisputed {
    pub campaign: Pubkey,
    pub milestone: Pubkey,
    pub index: u64,
    pub opened_by: Pubkey,
}

#[event]
pub struct DisputeResolved {
    pub campaign: Pubkey,
    pub milestone: Pubkey,
    pub index: u64,
    pub resolved_by: Pubkey,
    pub decision: ArbitrationDecision,
}
