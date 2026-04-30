import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { CrowdfundingEscrow } from "../target/types/crowdfunding_escrow";
import { assert } from "chai";

describe("crowdfunding-escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.CrowdfundingEscrow as Program<CrowdfundingEscrow> & {
    methods: any;
    account: any;
  };
  const creator = provider.wallet.publicKey;
  const treasury = anchor.web3.Keypair.generate();
  const feeBps = 500;

  let config: anchor.web3.PublicKey;

  let campaign: anchor.web3.PublicKey;
  let campaignVault: anchor.web3.PublicKey;
  let campaignBump: number;
  let campaignVaultBump: number;

  const title = "Test Campaign";
  const description = "This is a test crowdfunding campaign on Solana";
  const goalAmount = new BN(1_000_000_000);
  const endTime = new BN(Math.floor(Date.now() / 1000) + 86400);
  const nonce0 = new BN(0);

  async function expectProgramError(promise: Promise<any>, expectedSubstring: string) {
    try {
      await promise;
      assert.fail(`Expected error containing "${expectedSubstring}"`);
    } catch (err: any) {
      const errorMessage = err.message || err.toString();
      const logs = err.logs ? err.logs.join('\n') : '';
      const fullOutput = errorMessage + '\n' + logs;
      assert.include(fullOutput, expectedSubstring, `Expected "${expectedSubstring}" but got: ${fullOutput}`);
    }
  }

  async function finalizeCampaign(campaignPubkey: anchor.web3.PublicKey) {
    await (program.methods as any)
      .finalizeCampaign()
      .accounts({
        campaign: campaignPubkey,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      })
      .rpc();
  }

  async function settleCampaign(
    campaignPubkey: anchor.web3.PublicKey,
    campaignVaultPubkey: anchor.web3.PublicKey,
    creatorPubkey: anchor.web3.PublicKey,
    settler?: anchor.web3.Keypair,
  ) {
    const settlerPubkey = settler ? settler.publicKey : provider.wallet.publicKey;

    if (settler) {
      const signature = await provider.connection.requestAirdrop(
        settler.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(signature);
    }

    return (program.methods as any)
      .settleCampaign()
      .accounts({
        settler: settlerPubkey,
        campaign: campaignPubkey,
        campaignVault: campaignVaultPubkey,
        config,
        treasury: treasury.publicKey,
        creator: creatorPubkey,
        systemProgram: anchor.web3.SystemProgram.programId,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      })
      .signers(settler ? [settler] : [])
      .rpc();
  }

  function isLocalnet() {
    return provider.connection.rpcEndpoint.includes("127.0.0.1")
      || provider.connection.rpcEndpoint.includes("localhost");
  }

  async function getClusterUnixTimestamp() {
    const currentSlot = await provider.connection.getSlot();
    const blockTime = await provider.connection.getBlockTime(currentSlot);
    return blockTime ?? Math.floor(Date.now() / 1000);
  }

  async function tryWarpToSlot(targetSlot: number) {
    const connection = provider.connection as anchor.web3.Connection & {
      _rpcRequest?: (method: string, args: unknown[]) => Promise<any>;
    };

    if (!connection._rpcRequest) {
      return false;
    }

    for (const method of ["warp_slot", "warpSlot", "warp"]) {
      try {
        const response = await connection._rpcRequest(method, [targetSlot]);
        if (!response?.error) {
          await provider.connection.getLatestBlockhash();
          return true;
        }
      } catch (_err) {
        // Try the next validator-specific RPC method name.
      }
    }

    return false;
  }

  async function advancePastUnixTimestamp(targetUnixTimestamp: BN) {
    const targetTs = targetUnixTimestamp.toNumber() + 1;
    const currentTs = await getClusterUnixTimestamp();

    if (currentTs >= targetTs) {
      return;
    }

    if (!isLocalnet()) {
      await new Promise((resolve) => setTimeout(resolve, (targetTs - currentTs) * 1000));
      return;
    }

    const currentSlot = await provider.connection.getSlot();
    const secondsToAdvance = targetTs - currentTs;
    const estimatedSlots = Math.max(1, Math.ceil(secondsToAdvance / 0.4) + 5);
    const warped = await tryWarpToSlot(currentSlot + estimatedSlots);

    if (!warped) {
      await new Promise((resolve) => setTimeout(resolve, secondsToAdvance * 1000));
    }
  }

  before(async () => {
    [config] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    const signature = await provider.connection.requestAirdrop(
      treasury.publicKey,
      anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature);

    await program.methods
      .initializeConfig(feeBps)
      .accounts({
        admin: creator,
        config,
        treasury: treasury.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
  });

  // ---------------------------------------------------------------------------
  // 1. Core setup and basic campaign operations
  // ---------------------------------------------------------------------------

  describe("[Core] Initialize Campaign", () => {
    it("Should initialize a new campaign", async () => {
      [campaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("campaign"),
          creator.toBuffer(),
          nonce0.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      [campaignVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), campaign.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeCampaign(title, description, goalAmount, endTime, nonce0)
        .accounts({
          creator,
          campaign,
          campaignVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      const campaignAccount = await program.account.campaign.fetch(campaign);

      assert.equal(campaignAccount.creator.toString(), creator.toString());
      assert.equal(campaignAccount.title, title);
      assert.equal(campaignAccount.description, description);
      assert.equal(campaignAccount.goalAmount.toNumber(), goalAmount.toNumber());
      assert.equal(campaignAccount.currentAmount.toNumber(), 0);
      assert.equal(campaignAccount.backersCount.toNumber(), 0);
      assert.equal(campaignAccount.totalPledged.toNumber(), 0);
      assert.equal(campaignAccount.totalRefunded.toNumber(), 0);
      assert.equal(campaignAccount.claimedAmount.toNumber(), 0);
      assert.deepEqual(campaignAccount.state, { active: {} });
      assert.isFalse(campaignAccount.isClaimed);
      assert.isFalse(campaignAccount.isCancelled);

      campaignBump = campaignAccount.bump;
      campaignVaultBump = campaignAccount.campaignVaultBump;
    });

    it("Should fail with invalid goal amount (0)", async () => {
      const goalZero = new BN(0);
      const nonce1 = new BN(1);
      const [badCampaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("campaign"),
          creator.toBuffer(),
          nonce1.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      const [badVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), badCampaign.toBuffer()],
        program.programId
      );

      await expectProgramError(
        program.methods
          .initializeCampaign(title, description, goalZero, endTime, nonce1)
          .accounts({
            creator,
            campaign: badCampaign,
            campaignVault: badVault,
            systemProgram: anchor.web3.SystemProgram.programId,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .rpc(),
        "Invalid goal amount"
      );
    });

    it("Should fail with invalid end time (past)", async () => {
      const pastTime = new BN(Math.floor(Date.now() / 1000) - 3600);
      const nonce2 = new BN(2);
      const [badCampaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("campaign"),
          creator.toBuffer(),
          nonce2.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      const [badVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), badCampaign.toBuffer()],
        program.programId
      );

      await expectProgramError(
        program.methods
          .initializeCampaign(title, description, goalAmount, pastTime, nonce2)
          .accounts({
            creator,
            campaign: badCampaign,
            campaignVault: badVault,
            systemProgram: anchor.web3.SystemProgram.programId,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .rpc(),
        "Invalid end time"
      );
    });
  });

  describe("[Core] Config And Fee", () => {
    it("Should initialize config with expected admin, treasury and fee", async () => {
      const configAccount = await program.account.config.fetch(config);
      assert.equal(configAccount.admin.toString(), creator.toString());
      assert.equal(configAccount.arbiter.toString(), creator.toString());
      assert.equal(configAccount.treasury.toString(), treasury.publicKey.toString());
      assert.equal(configAccount.feeBps, feeBps);
    });

    it("Should reject claim when treasury account does not match config", async () => {
      const wrongTreasury = anchor.web3.Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        wrongTreasury.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      const shortNonce = new BN(11);
      const shortGoal = new BN(100_000_000);
      const shortEndTime = new BN(Math.floor(Date.now() / 1000) + 3);
      const [shortCampaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("campaign"),
          creator.toBuffer(),
          shortNonce.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const [shortVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), shortCampaign.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeCampaign("Fee Guard Campaign", "Treasury mismatch should fail", shortGoal, shortEndTime, shortNonce)
        .accounts({
          creator,
          campaign: shortCampaign,
          campaignVault: shortVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      const backer = anchor.web3.Keypair.generate();
      const backerSig = await provider.connection.requestAirdrop(
        backer.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(backerSig);

      const [shortPledge] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), backer.publicKey.toBuffer(), shortCampaign.toBuffer()],
        program.programId
      );

      await program.methods
        .pledge(shortGoal)
        .accounts({
          backer: backer.publicKey,
          campaign: shortCampaign,
          campaignVault: shortVault,
          pledge: shortPledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backer])
        .rpc();

      await advancePastUnixTimestamp(shortEndTime);
      await finalizeCampaign(shortCampaign);

      await expectProgramError(
        program.methods
          .claim()
          .accounts({
            creator,
            campaign: shortCampaign,
            campaignVault: shortVault,
            config,
            treasury: wrongTreasury.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .rpc(),
        "ConstraintAddress"
      );
    });
  });

  describe("[Core] Pledge to Campaign", () => {
    let backer: anchor.web3.Keypair;
    let pledge: anchor.web3.PublicKey;
    let pledgeBump: number;

    before(async () => {
      backer = anchor.web3.Keypair.generate();

      const signature = await provider.connection.requestAirdrop(
        backer.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(signature);

      [pledge] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("pledge"),
          backer.publicKey.toBuffer(),
          campaign.toBuffer(),
        ],
        program.programId
      );
    });

    it("Should pledge to a campaign", async () => {
      const pledgeAmount = new BN(500_000_000);

      await program.methods
        .pledge(pledgeAmount)
        .accounts({
          backer: backer.publicKey,
          campaign,
          campaignVault,
          pledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backer])
        .rpc();

      const pledgeAccount = await program.account.pledgeAccount.fetch(pledge);
      const campaignAccount = await program.account.campaign.fetch(campaign);

      assert.equal(pledgeAccount.backer.toString(), backer.publicKey.toString());
      assert.equal(pledgeAccount.campaign.toString(), campaign.toString());
      assert.equal(pledgeAccount.amount.toNumber(), pledgeAmount.toNumber());
      assert.isFalse(pledgeAccount.isRefunded);

      assert.equal(campaignAccount.currentAmount.toNumber(), pledgeAmount.toNumber());
      assert.equal(campaignAccount.backersCount.toNumber(), 1);
      assert.equal(campaignAccount.totalPledged.toNumber(), pledgeAmount.toNumber());
      assert.equal(campaignAccount.totalRefunded.toNumber(), 0);
      assert.equal(campaignAccount.claimedAmount.toNumber(), 0);

      pledgeBump = pledgeAccount.bump;
    });

    it("Should fail with invalid pledge amount (0)", async () => {
      const badBacker = anchor.web3.Keypair.generate();

      const signature = await provider.connection.requestAirdrop(
        badBacker.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(signature);

      const [badPledge] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("pledge"),
          badBacker.publicKey.toBuffer(),
          campaign.toBuffer(),
        ],
        program.programId
      );

      await expectProgramError(
        program.methods
          .pledge(new BN(0))
          .accounts({
            backer: badBacker.publicKey,
            campaign,
            campaignVault,
            pledge: badPledge,
            systemProgram: anchor.web3.SystemProgram.programId,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
            creator,
          })
          .signers([badBacker])
          .rpc(),
        "Invalid pledge amount"
      );
    });
  });

  describe("[Core] Campaign Stats", () => {
    let campaignStats: anchor.web3.PublicKey;
    let campaignStatsVault: anchor.web3.PublicKey;
    let statsBacker: anchor.web3.Keypair;
    let statsPledge: anchor.web3.PublicKey;
    const nonce12 = new BN(12);

    before(async () => {
      statsBacker = anchor.web3.Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        statsBacker.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      const statsEndTime = new BN(Math.floor(Date.now() / 1000) + 3600);
      [campaignStats] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("campaign"),
          creator.toBuffer(),
          nonce12.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      [campaignStatsVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), campaignStats.toBuffer()],
        program.programId
      );
      [statsPledge] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), statsBacker.publicKey.toBuffer(), campaignStats.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeCampaign("Stats Campaign", "Campaign stats coverage", new BN(1_000_000_000), statsEndTime, nonce12)
        .accounts({
          creator,
          campaign: campaignStats,
          campaignVault: campaignStatsVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();
    });

    it("Should accumulate total_pledged but keep unique backers_count on repeated pledge", async () => {
      await program.methods
        .pledge(new BN(100_000_000))
        .accounts({
          backer: statsBacker.publicKey,
          campaign: campaignStats,
          campaignVault: campaignStatsVault,
          pledge: statsPledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([statsBacker])
        .rpc();

      await program.methods
        .pledge(new BN(150_000_000))
        .accounts({
          backer: statsBacker.publicKey,
          campaign: campaignStats,
          campaignVault: campaignStatsVault,
          pledge: statsPledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([statsBacker])
        .rpc();

      const campaignAccount = await program.account.campaign.fetch(campaignStats);
      const pledgeAccount = await program.account.pledgeAccount.fetch(statsPledge);

      assert.equal(pledgeAccount.amount.toNumber(), 250_000_000);
      assert.equal(campaignAccount.currentAmount.toNumber(), 250_000_000);
      assert.equal(campaignAccount.totalPledged.toNumber(), 250_000_000);
      assert.equal(campaignAccount.backersCount.toNumber(), 1);
      assert.equal(campaignAccount.totalRefunded.toNumber(), 0);
      assert.equal(campaignAccount.claimedAmount.toNumber(), 0);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Campaign lifecycle: success, refunds, cancellation, settlement
  // ---------------------------------------------------------------------------

  describe("[Campaign Lifecycle] Cancel Campaign", () => {
    it("Should allow creator to cancel campaign", async () => {
      await program.methods
        .cancelCampaign()
        .accounts({
          creator,
          campaign,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      const campaignAccount = await program.account.campaign.fetch(campaign);
      assert.isTrue(campaignAccount.isCancelled);
    });

    it("Should not allow double cancel", async () => {
      await expectProgramError(
        program.methods
          .cancelCampaign()
          .accounts({
            creator,
            campaign,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .rpc(),
        "Invalid campaign state"
      );
    });
  });

  describe("[Campaign Lifecycle] Full Campaign Flow - Success Case", () => {
    let campaign2: anchor.web3.PublicKey;
    let campaignVault2: anchor.web3.PublicKey;
    let backer1: anchor.web3.Keypair;
    let backer2: anchor.web3.Keypair;
    let pledge1: anchor.web3.PublicKey;
    let pledge2: anchor.web3.PublicKey;

    let goalAmount2: BN;
    let endTime2: BN;
    const nonce3 = new BN(3);

    before(async () => {
      goalAmount2 = new BN(1_000_000_000);
      endTime2 = new BN(Math.floor(Date.now() / 1000) + 12);

      backer1 = anchor.web3.Keypair.generate();
      backer2 = anchor.web3.Keypair.generate();

      for (const b of [backer1, backer2]) {
        const signature = await provider.connection.requestAirdrop(
          b.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(signature);
      }

      [campaign2] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("campaign"),
          creator.toBuffer(),
          nonce3.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      [campaignVault2] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), campaign2.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeCampaign("Success Campaign", "This campaign will succeed", goalAmount2, endTime2, nonce3)
        .accounts({
          creator,
          campaign: campaign2,
          campaignVault: campaignVault2,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      [pledge1] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("pledge"),
          backer1.publicKey.toBuffer(),
          campaign2.toBuffer(),
        ],
        program.programId
      );

      [pledge2] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("pledge"),
          backer2.publicKey.toBuffer(),
          campaign2.toBuffer(),
        ],
        program.programId
      );
    });

    it("Should accept multiple pledges", async () => {
      const pledgeAmount1 = new BN(600_000_000);
      const pledgeAmount2 = new BN(500_000_000);

      await program.methods
        .pledge(pledgeAmount1)
        .accounts({
          backer: backer1.publicKey,
          campaign: campaign2,
          campaignVault: campaignVault2,
          pledge: pledge1,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backer1])
        .rpc();

      await program.methods
        .pledge(pledgeAmount2)
        .accounts({
          backer: backer2.publicKey,
          campaign: campaign2,
          campaignVault: campaignVault2,
          pledge: pledge2,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backer2])
        .rpc();

      const campaignAccount = await program.account.campaign.fetch(campaign2);
      assert.isTrue(campaignAccount.currentAmount.gte(goalAmount2));
      assert.equal(campaignAccount.backersCount.toNumber(), 2);
      assert.equal(campaignAccount.totalPledged.toNumber(), 1_100_000_000);
    });

    it("Should not allow claiming before goal is reached", async () => {
      const underfundedBacker = anchor.web3.Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        underfundedBacker.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      const underfundedNonce = new BN(42);
      const underfundedEndTime = new BN(Math.floor(Date.now() / 1000) + 60);
      const [underfundedCampaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), underfundedNonce.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [underfundedVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), underfundedCampaign.toBuffer()],
        program.programId
      );
      const [underfundedPledge] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), underfundedBacker.publicKey.toBuffer(), underfundedCampaign.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeCampaign(
          "Underfunded Claim",
          "Claim should fail before the goal is reached",
          new BN(1_000_000_000),
          underfundedEndTime,
          underfundedNonce
        )
        .accounts({
          creator,
          campaign: underfundedCampaign,
          campaignVault: underfundedVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .pledge(new BN(300_000_000))
        .accounts({
          backer: underfundedBacker.publicKey,
          campaign: underfundedCampaign,
          campaignVault: underfundedVault,
          pledge: underfundedPledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([underfundedBacker])
        .rpc();

      await expectProgramError(
        program.methods
          .claim()
          .accounts({
            creator,
            campaign: underfundedCampaign,
            campaignVault: underfundedVault,
            config,
            treasury: treasury.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .rpc(),
        "Invalid campaign state"
      );
    });

    it("Should allow claiming after campaign ends and goal reached", async () => {
      await advancePastUnixTimestamp(endTime2);
      await finalizeCampaign(campaign2);

      const finalizedCampaign = await program.account.campaign.fetch(campaign2);
      assert.deepEqual(finalizedCampaign.state, { successful: {} });

      const treasuryBalanceBefore = await provider.connection.getBalance(treasury.publicKey);
      const vaultBalanceBefore = await provider.connection.getBalance(campaignVault2);
      const expectedFee = Math.floor(1_100_000_000 * feeBps / 10_000);

      await program.methods
        .claim()
        .accounts({
          creator,
          campaign: campaign2,
          campaignVault: campaignVault2,
          config,
          treasury: treasury.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      const campaignAccount = await program.account.campaign.fetch(campaign2);
      assert.deepEqual(campaignAccount.state, { claimed: {} });
      assert.isTrue(campaignAccount.isClaimed);
      assert.equal(campaignAccount.currentAmount.toNumber(), 0);
      assert.equal(campaignAccount.totalPledged.toNumber(), 1_100_000_000);
      assert.equal(campaignAccount.totalRefunded.toNumber(), 0);
      assert.equal(campaignAccount.claimedAmount.toNumber(), 1_100_000_000 - expectedFee);

      const treasuryBalanceAfter = await provider.connection.getBalance(treasury.publicKey);
      const vaultBalanceAfter = await provider.connection.getBalance(campaignVault2);
      assert.equal(treasuryBalanceAfter - treasuryBalanceBefore, expectedFee);
      assert.equal(vaultBalanceBefore - vaultBalanceAfter, 1_100_000_000);
    });

    it("Should not allow double claiming", async () => {
      await expectProgramError(
        program.methods
          .claim()
          .accounts({
            creator,
            campaign: campaign2,
            campaignVault: campaignVault2,
            config,
            treasury: treasury.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .rpc(),
        "Invalid campaign state"
      );
    });
  });

  describe("[Campaign Lifecycle] Full Campaign Flow - Refund Case", () => {
    let campaign3: anchor.web3.PublicKey;
    let campaignVault3: anchor.web3.PublicKey;
    let backer3: anchor.web3.Keypair;
    let pledge3: anchor.web3.PublicKey;

    let goalAmount3: BN;
    let endTime3: BN;
    const nonce4 = new BN(4);

    before(async () => {
      goalAmount3 = new BN(2_000_000_000);
      endTime3 = new BN(Math.floor(Date.now() / 1000) + 12);

      backer3 = anchor.web3.Keypair.generate();

      const signature = await provider.connection.requestAirdrop(
        backer3.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(signature);

      [campaign3] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("campaign"),
          creator.toBuffer(),
          nonce4.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      [campaignVault3] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), campaign3.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeCampaign("Refund Campaign", "This campaign will fail", goalAmount3, endTime3, nonce4)
        .accounts({
          creator,
          campaign: campaign3,
          campaignVault: campaignVault3,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      [pledge3] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("pledge"),
          backer3.publicKey.toBuffer(),
          campaign3.toBuffer(),
        ],
        program.programId
      );
    });

    it("Should accept pledge for failing campaign", async () => {
      const pledgeAmount = new BN(500_000_000);

      await program.methods
        .pledge(pledgeAmount)
        .accounts({
          backer: backer3.publicKey,
          campaign: campaign3,
          campaignVault: campaignVault3,
          pledge: pledge3,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backer3])
        .rpc();

      const pledgeAccount = await program.account.pledgeAccount.fetch(pledge3);
      assert.equal(pledgeAccount.amount.toNumber(), pledgeAmount.toNumber());
    });

    it("Should not allow refund before campaign ends", async () => {
      await expectProgramError(
        program.methods
          .cancelPledge()
          .accounts({
            backer: backer3.publicKey,
            campaign: campaign3,
            campaignVault: campaignVault3,
            pledge: pledge3,
            systemProgram: anchor.web3.SystemProgram.programId,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
            creator,
          })
          .signers([backer3])
          .rpc(),
        "Refund not available"
      );
    });

    it("Should allow refund after campaign ends without reaching goal", async () => {
      await advancePastUnixTimestamp(endTime3);
      await finalizeCampaign(campaign3);

      const finalizedCampaign = await program.account.campaign.fetch(campaign3);
      assert.deepEqual(finalizedCampaign.state, { failed: {} });

      await program.methods
        .cancelPledge()
        .accounts({
          backer: backer3.publicKey,
          campaign: campaign3,
          campaignVault: campaignVault3,
          pledge: pledge3,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backer3])
        .rpc();

      const pledgeAccount = await program.account.pledgeAccount.fetch(pledge3);
      assert.isTrue(pledgeAccount.isRefunded);

      const campaignAccount = await program.account.campaign.fetch(campaign3);
      assert.equal(campaignAccount.currentAmount.toNumber(), 0);
      assert.equal(campaignAccount.backersCount.toNumber(), 1);
      assert.equal(campaignAccount.totalPledged.toNumber(), 500_000_000);
      assert.equal(campaignAccount.totalRefunded.toNumber(), 500_000_000);
      assert.equal(campaignAccount.claimedAmount.toNumber(), 0);
    });

    it("Should not allow double refund", async () => {
      await expectProgramError(
        program.methods
          .cancelPledge()
          .accounts({
            backer: backer3.publicKey,
            campaign: campaign3,
            campaignVault: campaignVault3,
            pledge: pledge3,
            systemProgram: anchor.web3.SystemProgram.programId,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
            creator,
          })
          .signers([backer3])
          .rpc(),
        "Pledge already refunded"
      );
    });
  });

  describe("[Campaign Lifecycle] Creator As Backer Refund", () => {
    let selfBackedCampaign: anchor.web3.PublicKey;
    let selfBackedVault: anchor.web3.PublicKey;
    let selfBackedPledge: anchor.web3.PublicKey;
    const selfBackedNonce = new BN(45);
    let selfBackedEndTime: BN;
    const selfBackedAmount = new BN(250_000_000);

    before(async () => {
      selfBackedEndTime = new BN(Math.floor(Date.now() / 1000) + 300);

      [selfBackedCampaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), selfBackedNonce.toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      [selfBackedVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), selfBackedCampaign.toBuffer()],
        program.programId
      );

      [selfBackedPledge] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), creator.toBuffer(), selfBackedCampaign.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeCampaign(
          "Creator Self Backed",
          "Creator should be able to refund own pledge after cancellation",
          new BN(1_000_000_000),
          selfBackedEndTime,
          selfBackedNonce
        )
        .accounts({
          creator,
          campaign: selfBackedCampaign,
          campaignVault: selfBackedVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();
    });

    it("Should allow creator to pledge into own campaign", async () => {
      await program.methods
        .pledge(selfBackedAmount)
        .accounts({
          backer: creator,
          campaign: selfBackedCampaign,
          campaignVault: selfBackedVault,
          pledge: selfBackedPledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .rpc();

      const pledgeAccount = await program.account.pledgeAccount.fetch(selfBackedPledge);
      assert.equal(pledgeAccount.amount.toNumber(), selfBackedAmount.toNumber());
      assert.isFalse(pledgeAccount.isRefunded);
    });

    it("Should allow creator to cancel own self-backed campaign", async () => {
      await program.methods
        .cancelCampaign()
        .accounts({
          creator,
          campaign: selfBackedCampaign,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      const campaignAccount = await program.account.campaign.fetch(selfBackedCampaign);
      assert.deepEqual(campaignAccount.state, { cancelled: {} });
      assert.isTrue(campaignAccount.isCancelled);
    });

    it("Should allow creator to refund own pledge after cancellation", async () => {
      await program.methods
        .cancelPledge()
        .accounts({
          backer: creator,
          campaign: selfBackedCampaign,
          campaignVault: selfBackedVault,
          pledge: selfBackedPledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .rpc();

      const pledgeAccount = await program.account.pledgeAccount.fetch(selfBackedPledge);
      assert.isTrue(pledgeAccount.isRefunded);
      assert.equal(pledgeAccount.refundedAmount.toNumber(), selfBackedAmount.toNumber());

      const campaignAccount = await program.account.campaign.fetch(selfBackedCampaign);
      assert.equal(campaignAccount.currentAmount.toNumber(), 0);
      assert.equal(campaignAccount.totalPledged.toNumber(), selfBackedAmount.toNumber());
      assert.equal(campaignAccount.totalRefunded.toNumber(), selfBackedAmount.toNumber());
    });
  });

  describe("[Campaign Lifecycle] Extend Campaign", () => {
    let campaign4: anchor.web3.PublicKey;
    let campaignVault4: anchor.web3.PublicKey;

    let goalAmount4: BN;
    let endTime4: BN;
    const nonce5 = new BN(5);

    before(async () => {
      goalAmount4 = new BN(1_000_000_000);
      endTime4 = new BN(Math.floor(Date.now() / 1000) + 3600);

      [campaign4] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("campaign"),
          creator.toBuffer(),
          nonce5.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      [campaignVault4] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), campaign4.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeCampaign("Extend Campaign", "This campaign will be extended", goalAmount4, endTime4, nonce5)
        .accounts({
          creator,
          campaign: campaign4,
          campaignVault: campaignVault4,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();
    });

    it("Should allow creator to extend campaign", async () => {
      const newEndTime = new BN(Math.floor(Date.now() / 1000) + 7200);

      await program.methods
        .extendCampaign(newEndTime)
        .accounts({
          creator,
          campaign: campaign4,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      const campaignAccount = await program.account.campaign.fetch(campaign4);
      assert.equal(campaignAccount.endTime.toNumber(), newEndTime.toNumber());
    });

    it("Should fail to extend with earlier end time", async () => {
      const earlierTime = new BN(Math.floor(Date.now() / 1000) + 1800);

      await expectProgramError(
        program.methods
          .extendCampaign(earlierTime)
          .accounts({
            creator,
            campaign: campaign4,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .rpc(),
        "Invalid end time"
      );
    });
  });

  // ==================== Additional Tests ====================

  describe("[Campaign Lifecycle] Automatic Settlement", () => {
    let settleCampaignSuccess: anchor.web3.PublicKey;
    let settleCampaignSuccessVault: anchor.web3.PublicKey;
    let settleCampaignFail: anchor.web3.PublicKey;
    let settleCampaignFailVault: anchor.web3.PublicKey;
    let settleBacker1: anchor.web3.Keypair;
    let settleBacker2: anchor.web3.Keypair;
    let failBacker: anchor.web3.Keypair;
    let settlePledge1: anchor.web3.PublicKey;
    let settlePledge2: anchor.web3.PublicKey;
    let failPledge: anchor.web3.PublicKey;
    let settleEndTimeSuccess: BN;
    let settleEndTimeFail: BN;
    const nonce13 = new BN(13);
    const nonce14 = new BN(14);

    before(async () => {
      settleBacker1 = anchor.web3.Keypair.generate();
      settleBacker2 = anchor.web3.Keypair.generate();
      failBacker = anchor.web3.Keypair.generate();

      for (const b of [settleBacker1, settleBacker2, failBacker]) {
        const sig = await provider.connection.requestAirdrop(
          b.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(sig);
      }

      settleEndTimeSuccess = new BN(Math.floor(Date.now() / 1000) + 8);
      settleEndTimeFail = new BN(Math.floor(Date.now() / 1000) + 8);

      [settleCampaignSuccess] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), nonce13.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      [settleCampaignSuccessVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), settleCampaignSuccess.toBuffer()],
        program.programId
      );
      [settleCampaignFail] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), nonce14.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      [settleCampaignFailVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), settleCampaignFail.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeCampaign("Auto Settle Success", "Automatic funding path", new BN(1_000_000_000), settleEndTimeSuccess, nonce13)
        .accounts({
          creator,
          campaign: settleCampaignSuccess,
          campaignVault: settleCampaignSuccessVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .initializeCampaign("Auto Settle Fail", "Automatic refund enablement", new BN(1_000_000_000), settleEndTimeFail, nonce14)
        .accounts({
          creator,
          campaign: settleCampaignFail,
          campaignVault: settleCampaignFailVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      [settlePledge1] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), settleBacker1.publicKey.toBuffer(), settleCampaignSuccess.toBuffer()],
        program.programId
      );
      [settlePledge2] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), settleBacker2.publicKey.toBuffer(), settleCampaignSuccess.toBuffer()],
        program.programId
      );
      [failPledge] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), failBacker.publicKey.toBuffer(), settleCampaignFail.toBuffer()],
        program.programId
      );

      await program.methods
        .pledge(new BN(600_000_000))
        .accounts({
          backer: settleBacker1.publicKey,
          campaign: settleCampaignSuccess,
          campaignVault: settleCampaignSuccessVault,
          pledge: settlePledge1,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([settleBacker1])
        .rpc();

      await program.methods
        .pledge(new BN(500_000_000))
        .accounts({
          backer: settleBacker2.publicKey,
          campaign: settleCampaignSuccess,
          campaignVault: settleCampaignSuccessVault,
          pledge: settlePledge2,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([settleBacker2])
        .rpc();

      await program.methods
        .pledge(new BN(300_000_000))
        .accounts({
          backer: failBacker.publicKey,
          campaign: settleCampaignFail,
          campaignVault: settleCampaignFailVault,
          pledge: failPledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([failBacker])
        .rpc();
    });

    it("Should automatically fund successful campaign during settlement", async () => {
      await advancePastUnixTimestamp(settleEndTimeSuccess);

      const treasuryBalanceBefore = await provider.connection.getBalance(treasury.publicKey);
      const vaultBalanceBefore = await provider.connection.getBalance(settleCampaignSuccessVault);
      const expectedFee = Math.floor(1_100_000_000 * feeBps / 10_000);

      await settleCampaign(settleCampaignSuccess, settleCampaignSuccessVault, creator);

      const campaignAccount = await program.account.campaign.fetch(settleCampaignSuccess);
      const treasuryBalanceAfter = await provider.connection.getBalance(treasury.publicKey);
      const vaultBalanceAfter = await provider.connection.getBalance(settleCampaignSuccessVault);

      assert.deepEqual(campaignAccount.state, { claimed: {} });
      assert.equal(campaignAccount.currentAmount.toNumber(), 0);
      assert.equal(campaignAccount.claimedAmount.toNumber(), 1_100_000_000 - expectedFee);
      assert.equal(treasuryBalanceAfter - treasuryBalanceBefore, expectedFee);
      assert.equal(vaultBalanceBefore - vaultBalanceAfter, 1_100_000_000);
    });

    it("Should automatically finalize failed campaign and enable refunds", async () => {
      await advancePastUnixTimestamp(settleEndTimeFail);
      await settleCampaign(settleCampaignFail, settleCampaignFailVault, creator);

      let campaignAccount = await program.account.campaign.fetch(settleCampaignFail);
      assert.deepEqual(campaignAccount.state, { failed: {} });

      await program.methods
        .cancelPledge()
        .accounts({
          backer: failBacker.publicKey,
          campaign: settleCampaignFail,
          campaignVault: settleCampaignFailVault,
          pledge: failPledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([failBacker])
        .rpc();

      campaignAccount = await program.account.campaign.fetch(settleCampaignFail);
      assert.equal(campaignAccount.currentAmount.toNumber(), 0);
      assert.equal(campaignAccount.totalRefunded.toNumber(), 300_000_000);
    });

    it("Should not allow settlement before campaign ends", async () => {
      const earlyNonce = new BN(17);
      const earlyEndTime = new BN(Math.floor(Date.now() / 1000) + 30);
      const [earlyCampaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), earlyNonce.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [earlyVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), earlyCampaign.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeCampaign("Early Settle", "Should not settle before deadline", new BN(100_000_000), earlyEndTime, earlyNonce)
        .accounts({
          creator,
          campaign: earlyCampaign,
          campaignVault: earlyVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await expectProgramError(
        settleCampaign(earlyCampaign, earlyVault, creator),
        "Campaign not ended"
      );
    });

    it("Should allow early settlement before deadline once goal is reached", async () => {
      const earlySuccessBacker = anchor.web3.Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        earlySuccessBacker.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      const earlySuccessNonce = new BN(26);
      const earlySuccessEndTime = new BN(Math.floor(Date.now() / 1000) + 60);
      const [earlySuccessCampaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), earlySuccessNonce.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [earlySuccessVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), earlySuccessCampaign.toBuffer()],
        program.programId
      );
      const [earlySuccessPledge] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), earlySuccessBacker.publicKey.toBuffer(), earlySuccessCampaign.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeCampaign("Early Success", "Settlement before deadline after reaching goal", new BN(100_000_000), earlySuccessEndTime, earlySuccessNonce)
        .accounts({
          creator,
          campaign: earlySuccessCampaign,
          campaignVault: earlySuccessVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .pledge(new BN(100_000_000))
        .accounts({
          backer: earlySuccessBacker.publicKey,
          campaign: earlySuccessCampaign,
          campaignVault: earlySuccessVault,
          pledge: earlySuccessPledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([earlySuccessBacker])
        .rpc();

      await settleCampaign(earlySuccessCampaign, earlySuccessVault, creator);

      const campaignAccount = await program.account.campaign.fetch(earlySuccessCampaign);
      assert.deepEqual(campaignAccount.state, { claimed: {} });
      assert.equal(campaignAccount.currentAmount.toNumber(), 0);
    });

    it("Should not allow settlement twice", async () => {
      await expectProgramError(
        settleCampaign(settleCampaignSuccess, settleCampaignSuccessVault, creator),
        "Campaign already finalized"
      );
    });

    it("Should not allow claim after successful settlement", async () => {
      await expectProgramError(
        program.methods
          .claim()
          .accounts({
            creator,
            campaign: settleCampaignSuccess,
            campaignVault: settleCampaignSuccessVault,
            config,
            treasury: treasury.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .rpc(),
        "Invalid campaign state"
      );
    });

    it("Should not allow settlement for cancelled campaign", async () => {
      const cancelledNonce = new BN(20);
      const cancelledEndTime = new BN(Math.floor(Date.now() / 1000) + 30);
      const [cancelledCampaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), cancelledNonce.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [cancelledVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), cancelledCampaign.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeCampaign("Cancelled Settle", "Settlement should fail for cancelled campaign", new BN(100_000_000), cancelledEndTime, cancelledNonce)
        .accounts({
          creator,
          campaign: cancelledCampaign,
          campaignVault: cancelledVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .cancelCampaign()
        .accounts({
          creator,
          campaign: cancelledCampaign,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await advancePastUnixTimestamp(cancelledEndTime);

      await expectProgramError(
        settleCampaign(cancelledCampaign, cancelledVault, creator),
        "Campaign already finalized"
      );
    });
  });

  describe("[Campaign Lifecycle] Lazy Auto Finalization", () => {
    let lazySuccessCampaign: anchor.web3.PublicKey;
    let lazySuccessVault: anchor.web3.PublicKey;
    let lazyFailCampaign: anchor.web3.PublicKey;
    let lazyFailVault: anchor.web3.PublicKey;
    let lazySuccessBacker: anchor.web3.Keypair;
    let lazyFailBacker: anchor.web3.Keypair;
    let lazySuccessPledge: anchor.web3.PublicKey;
    let lazyFailPledge: anchor.web3.PublicKey;
    let lazySuccessEndTime: BN;
    let lazyFailEndTime: BN;
    const nonce15 = new BN(15);
    const nonce16 = new BN(16);

    before(async () => {
      lazySuccessBacker = anchor.web3.Keypair.generate();
      lazyFailBacker = anchor.web3.Keypair.generate();

      for (const b of [lazySuccessBacker, lazyFailBacker]) {
        const sig = await provider.connection.requestAirdrop(
          b.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(sig);
      }

      lazySuccessEndTime = new BN(Math.floor(Date.now() / 1000) + 8);
      lazyFailEndTime = new BN(Math.floor(Date.now() / 1000) + 8);

      [lazySuccessCampaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), nonce15.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      [lazySuccessVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), lazySuccessCampaign.toBuffer()],
        program.programId
      );
      [lazyFailCampaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), nonce16.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      [lazyFailVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), lazyFailCampaign.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeCampaign("Lazy Success", "Claim should auto-finalize", new BN(400_000_000), lazySuccessEndTime, nonce15)
        .accounts({
          creator,
          campaign: lazySuccessCampaign,
          campaignVault: lazySuccessVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .initializeCampaign("Lazy Fail", "Refund should auto-finalize", new BN(800_000_000), lazyFailEndTime, nonce16)
        .accounts({
          creator,
          campaign: lazyFailCampaign,
          campaignVault: lazyFailVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      [lazySuccessPledge] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), lazySuccessBacker.publicKey.toBuffer(), lazySuccessCampaign.toBuffer()],
        program.programId
      );
      [lazyFailPledge] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), lazyFailBacker.publicKey.toBuffer(), lazyFailCampaign.toBuffer()],
        program.programId
      );

      await program.methods
        .pledge(new BN(400_000_000))
        .accounts({
          backer: lazySuccessBacker.publicKey,
          campaign: lazySuccessCampaign,
          campaignVault: lazySuccessVault,
          pledge: lazySuccessPledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([lazySuccessBacker])
        .rpc();

      await program.methods
        .pledge(new BN(300_000_000))
        .accounts({
          backer: lazyFailBacker.publicKey,
          campaign: lazyFailCampaign,
          campaignVault: lazyFailVault,
          pledge: lazyFailPledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([lazyFailBacker])
        .rpc();
    });

    it("Should auto-finalize inside claim after deadline", async () => {
      await advancePastUnixTimestamp(lazySuccessEndTime);

      await program.methods
        .claim()
        .accounts({
          creator,
          campaign: lazySuccessCampaign,
          campaignVault: lazySuccessVault,
          config,
          treasury: treasury.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      const campaignAccount = await program.account.campaign.fetch(lazySuccessCampaign);
      assert.deepEqual(campaignAccount.state, { claimed: {} });
      assert.equal(campaignAccount.currentAmount.toNumber(), 0);
      assert.isAbove(campaignAccount.claimedAmount.toNumber(), 0);
    });

    it("Should auto-finalize inside refund after deadline", async () => {
      await advancePastUnixTimestamp(lazyFailEndTime);

      await program.methods
        .cancelPledge()
        .accounts({
          backer: lazyFailBacker.publicKey,
          campaign: lazyFailCampaign,
          campaignVault: lazyFailVault,
          pledge: lazyFailPledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([lazyFailBacker])
        .rpc();

      const campaignAccount = await program.account.campaign.fetch(lazyFailCampaign);
      const pledgeAccount = await program.account.pledgeAccount.fetch(lazyFailPledge);
      assert.deepEqual(campaignAccount.state, { failed: {} });
      assert.equal(campaignAccount.currentAmount.toNumber(), 0);
      assert.isTrue(pledgeAccount.isRefunded);
    });

    it("Should allow early claim before deadline once goal is reached", async () => {
      const earlyClaimBacker = anchor.web3.Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        earlyClaimBacker.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      const earlyClaimNonce = new BN(27);
      const earlyClaimEndTime = new BN(Math.floor(Date.now() / 1000) + 60);
      const [earlyClaimCampaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), earlyClaimNonce.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [earlyClaimVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), earlyClaimCampaign.toBuffer()],
        program.programId
      );
      const [earlyClaimPledge] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), earlyClaimBacker.publicKey.toBuffer(), earlyClaimCampaign.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeCampaign("Early Claim", "Lazy claim before deadline after goal", new BN(120_000_000), earlyClaimEndTime, earlyClaimNonce)
        .accounts({
          creator,
          campaign: earlyClaimCampaign,
          campaignVault: earlyClaimVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .pledge(new BN(120_000_000))
        .accounts({
          backer: earlyClaimBacker.publicKey,
          campaign: earlyClaimCampaign,
          campaignVault: earlyClaimVault,
          pledge: earlyClaimPledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([earlyClaimBacker])
        .rpc();

      await program.methods
        .claim()
        .accounts({
          creator,
          campaign: earlyClaimCampaign,
          campaignVault: earlyClaimVault,
          config,
          treasury: treasury.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      const campaignAccount = await program.account.campaign.fetch(earlyClaimCampaign);
      assert.deepEqual(campaignAccount.state, { claimed: {} });
      assert.equal(campaignAccount.currentAmount.toNumber(), 0);
      assert.isAbove(campaignAccount.claimedAmount.toNumber(), 0);
    });

    it("Should reject claim for failed campaign after lazy finalization", async () => {
      await expectProgramError(
        program.methods
          .claim()
          .accounts({
            creator,
            campaign: lazyFailCampaign,
            campaignVault: lazyFailVault,
            config,
            treasury: treasury.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .rpc(),
        "Invalid campaign state"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Guard cases and invariants
  // ---------------------------------------------------------------------------

  describe("[Guards] Cancelled Campaign", () => {
    let campaign7: anchor.web3.PublicKey;
    let campaignVault7: anchor.web3.PublicKey;
    let backerC: anchor.web3.Keypair;
    let pledgeC: anchor.web3.PublicKey;
    const nonce8 = new BN(8);

    before(async () => {
      backerC = anchor.web3.Keypair.generate();
      const sig = await provider.connection.requestAirdrop(backerC.publicKey, anchor.web3.LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);

      const endTime7 = new BN(Math.floor(Date.now() / 1000) + 3600);
      [campaign7] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("campaign"),
          creator.toBuffer(),
          nonce8.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      [campaignVault7] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), campaign7.toBuffer()],
        program.programId
      );
      await program.methods
        .initializeCampaign("Cancel Test Campaign", "Test pledge after cancel", new BN(1_000_000_000), endTime7, nonce8)
        .accounts({
          creator,
          campaign: campaign7,
          campaignVault: campaignVault7,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      [pledgeC] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("pledge"),
          backerC.publicKey.toBuffer(),
          campaign7.toBuffer(),
        ],
        program.programId
      );

      await program.methods
        .pledge(new BN(100_000_000))
        .accounts({
          backer: backerC.publicKey,
          campaign: campaign7,
          campaignVault: campaignVault7,
          pledge: pledgeC,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backerC])
        .rpc();
    });

    it("Should allow creator to cancel after pledge", async () => {
      await program.methods
        .cancelCampaign()
        .accounts({
          creator,
          campaign: campaign7,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      const campaignAccount = await program.account.campaign.fetch(campaign7);
      assert.deepEqual(campaignAccount.state, { cancelled: {} });
      assert.isTrue(campaignAccount.isCancelled);
    });

    it("Should not allow new pledge to cancelled campaign", async () => {
      const newBacker = anchor.web3.Keypair.generate();
      const sig = await provider.connection.requestAirdrop(newBacker.publicKey, anchor.web3.LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);

      const [newPledge] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("pledge"),
          newBacker.publicKey.toBuffer(),
          campaign7.toBuffer(),
        ],
        program.programId
      );

      await expectProgramError(
        program.methods
          .pledge(new BN(100_000_000))
          .accounts({
            backer: newBacker.publicKey,
            campaign: campaign7,
            campaignVault: campaignVault7,
            pledge: newPledge,
            systemProgram: anchor.web3.SystemProgram.programId,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
            creator,
          })
          .signers([newBacker])
          .rpc(),
        "Invalid campaign state"
      );
    });

    it("Should not allow claim for cancelled campaign", async () => {
      await expectProgramError(
        program.methods
          .claim()
          .accounts({
            creator,
            campaign: campaign7,
            campaignVault: campaignVault7,
            config,
            treasury: treasury.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .rpc(),
        "Invalid campaign state"
      );
    });

    it("Should not allow extend for cancelled campaign", async () => {
      const newEndTime = new BN(Math.floor(Date.now() / 1000) + 7200);

      await expectProgramError(
        program.methods
          .extendCampaign(newEndTime)
          .accounts({
            creator,
            campaign: campaign7,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .rpc(),
        "Invalid campaign state"
      );
    });

    it("Should allow backer to refund after cancel", async () => {
      await program.methods
        .cancelPledge()
        .accounts({
          backer: backerC.publicKey,
          campaign: campaign7,
          campaignVault: campaignVault7,
          pledge: pledgeC,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backerC])
        .rpc();

      const pledgeAccount = await program.account.pledgeAccount.fetch(pledgeC);
      assert.isTrue(pledgeAccount.isRefunded);
    });
  });

  describe("[Guards] Authorization", () => {
    let protectedCampaign: anchor.web3.PublicKey;
    let protectedVault: anchor.web3.PublicKey;
    let protectedPledge: anchor.web3.PublicKey;
    let legitBacker: anchor.web3.Keypair;
    let outsider: anchor.web3.Keypair;
    const nonce18 = new BN(18);

    before(async () => {
      legitBacker = anchor.web3.Keypair.generate();
      outsider = anchor.web3.Keypair.generate();

      for (const signer of [legitBacker, outsider]) {
        const sig = await provider.connection.requestAirdrop(
          signer.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(sig);
      }

      const protectedEndTime = new BN(Math.floor(Date.now() / 1000) + 3600);
      [protectedCampaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), nonce18.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      [protectedVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), protectedCampaign.toBuffer()],
        program.programId
      );
      [protectedPledge] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), legitBacker.publicKey.toBuffer(), protectedCampaign.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeCampaign("Protected Campaign", "Authorization guard checks", new BN(500_000_000), protectedEndTime, nonce18)
        .accounts({
          creator,
          campaign: protectedCampaign,
          campaignVault: protectedVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .pledge(new BN(100_000_000))
        .accounts({
          backer: legitBacker.publicKey,
          campaign: protectedCampaign,
          campaignVault: protectedVault,
          pledge: protectedPledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([legitBacker])
        .rpc();
    });

    it("Should not allow unauthorized user to claim", async () => {
      await expectProgramError(
        program.methods
          .claim()
          .accounts({
            creator: outsider.publicKey,
            campaign: protectedCampaign,
            campaignVault: protectedVault,
            config,
            treasury: treasury.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .signers([outsider])
          .rpc(),
        "ConstraintSeeds"
      );
    });

    it("Should not allow unauthorized user to cancel campaign", async () => {
      await expectProgramError(
        program.methods
          .cancelCampaign()
          .accounts({
            creator: outsider.publicKey,
            campaign: protectedCampaign,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .signers([outsider])
          .rpc(),
        "ConstraintSeeds"
      );
    });

    it("Should not allow unauthorized user to extend campaign", async () => {
      await expectProgramError(
        program.methods
          .extendCampaign(new BN(Math.floor(Date.now() / 1000) + 7200))
          .accounts({
            creator: outsider.publicKey,
            campaign: protectedCampaign,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .signers([outsider])
          .rpc(),
        "ConstraintSeeds"
      );
    });

    it("Should not allow different backer to refund someone else's pledge", async () => {
      await expectProgramError(
        program.methods
          .cancelPledge()
          .accounts({
            backer: outsider.publicKey,
            campaign: protectedCampaign,
            campaignVault: protectedVault,
            pledge: protectedPledge,
            systemProgram: anchor.web3.SystemProgram.programId,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
            creator,
          })
          .signers([outsider])
          .rpc(),
        "ConstraintSeeds"
      );
    });
  });

  describe("[Guards] Deadline", () => {
    it("Should not allow pledge after campaign deadline", async () => {
      const deadlineBacker = anchor.web3.Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        deadlineBacker.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      const deadlineNonce = new BN(19);
      const deadlineEndTime = new BN(Math.floor(Date.now() / 1000) + 3);
      const [deadlineCampaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), deadlineNonce.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [deadlineVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), deadlineCampaign.toBuffer()],
        program.programId
      );
      const [deadlinePledge] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), deadlineBacker.publicKey.toBuffer(), deadlineCampaign.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeCampaign("Deadline Campaign", "No pledges after deadline", new BN(100_000_000), deadlineEndTime, deadlineNonce)
        .accounts({
          creator,
          campaign: deadlineCampaign,
          campaignVault: deadlineVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await advancePastUnixTimestamp(deadlineEndTime);

      await expectProgramError(
        program.methods
          .pledge(new BN(50_000_000))
          .accounts({
            backer: deadlineBacker.publicKey,
            campaign: deadlineCampaign,
            campaignVault: deadlineVault,
            pledge: deadlinePledge,
            systemProgram: anchor.web3.SystemProgram.programId,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
            creator,
          })
          .signers([deadlineBacker])
          .rpc(),
        "Campaign ended"
      );
    });

    it("Should not allow cancel campaign after deadline", async () => {
      const cancelBacker = anchor.web3.Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        cancelBacker.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      const cancelNonce = new BN(21);
      const cancelEndTime = new BN(Math.floor(Date.now() / 1000) + 3);
      const [cancelDeadlineCampaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), cancelNonce.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [cancelDeadlineVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), cancelDeadlineCampaign.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeCampaign("Cancel Deadline", "Cancel should fail after deadline", new BN(100_000_000), cancelEndTime, cancelNonce)
        .accounts({
          creator,
          campaign: cancelDeadlineCampaign,
          campaignVault: cancelDeadlineVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await advancePastUnixTimestamp(cancelEndTime);

      await expectProgramError(
        program.methods
          .cancelCampaign()
          .accounts({
            creator,
            campaign: cancelDeadlineCampaign,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .rpc(),
        "Campaign ended"
      );
    });

    it("Should not allow extend campaign after deadline", async () => {
      const extendNonce = new BN(22);
      const extendEndTime = new BN(Math.floor(Date.now() / 1000) + 3);
      const [extendDeadlineCampaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), extendNonce.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [extendDeadlineVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), extendDeadlineCampaign.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeCampaign("Extend Deadline", "Extend should fail after deadline", new BN(100_000_000), extendEndTime, extendNonce)
        .accounts({
          creator,
          campaign: extendDeadlineCampaign,
          campaignVault: extendDeadlineVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await advancePastUnixTimestamp(extendEndTime);

      await expectProgramError(
        program.methods
          .extendCampaign(new BN(Math.floor(Date.now() / 1000) + 7200))
          .accounts({
            creator,
            campaign: extendDeadlineCampaign,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .rpc(),
        "Campaign ended"
      );
    });
  });

  describe("[Guards] Finalization", () => {
    it("Should not allow finalization twice", async () => {
      const finalizeNonce = new BN(24);
      const finalizeEndTime = new BN(Math.floor(Date.now() / 1000) + 3);
      const [finalizeCampaignPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), finalizeNonce.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [finalizeVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), finalizeCampaignPda.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeCampaign("Finalize Twice", "Finalization should be single-use", new BN(100_000_000), finalizeEndTime, finalizeNonce)
        .accounts({
          creator,
          campaign: finalizeCampaignPda,
          campaignVault: finalizeVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await advancePastUnixTimestamp(finalizeEndTime);
      await finalizeCampaign(finalizeCampaignPda);

      await expectProgramError(
        finalizeCampaign(finalizeCampaignPda),
        "Campaign already finalized"
      );
    });

    it("Should not allow finalization for cancelled campaign", async () => {
      const cancelledFinalizeNonce = new BN(25);
      const cancelledFinalizeEndTime = new BN(Math.floor(Date.now() / 1000) + 30);
      const [cancelledFinalizeCampaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), cancelledFinalizeNonce.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [cancelledFinalizeVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), cancelledFinalizeCampaign.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeCampaign("Cancelled Finalize", "Cancelled campaign should not finalize", new BN(100_000_000), cancelledFinalizeEndTime, cancelledFinalizeNonce)
        .accounts({
          creator,
          campaign: cancelledFinalizeCampaign,
          campaignVault: cancelledFinalizeVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .cancelCampaign()
        .accounts({
          creator,
          campaign: cancelledFinalizeCampaign,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await expectProgramError(
        finalizeCampaign(cancelledFinalizeCampaign),
        "Campaign already finalized"
      );
    });

    it("Should not allow refund for successful campaign after deadline", async () => {
      const refundBacker = anchor.web3.Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        refundBacker.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      const refundNonce = new BN(23);
      const refundEndTime = new BN(Math.floor(Date.now() / 1000) + 3);
      const [refundCampaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), refundNonce.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [refundVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), refundCampaign.toBuffer()],
        program.programId
      );
      const [refundPledge] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), refundBacker.publicKey.toBuffer(), refundCampaign.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeCampaign("Successful Refund Guard", "Refund should fail on successful campaign", new BN(100_000_000), refundEndTime, refundNonce)
        .accounts({
          creator,
          campaign: refundCampaign,
          campaignVault: refundVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .pledge(new BN(100_000_000))
        .accounts({
          backer: refundBacker.publicKey,
          campaign: refundCampaign,
          campaignVault: refundVault,
          pledge: refundPledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([refundBacker])
        .rpc();

      await advancePastUnixTimestamp(refundEndTime);

      await expectProgramError(
        program.methods
          .cancelPledge()
          .accounts({
            backer: refundBacker.publicKey,
            campaign: refundCampaign,
            campaignVault: refundVault,
            pledge: refundPledge,
            systemProgram: anchor.web3.SystemProgram.programId,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
            creator,
          })
          .signers([refundBacker])
          .rpc(),
        "Refund not available"
      );
    });
  });

  describe("[Guards] Active Campaign Transitions", () => {
    let campaign8: anchor.web3.PublicKey;
    let campaignVault8: anchor.web3.PublicKey;
    const nonce9 = new BN(9);

    before(async () => {
      const endTime8 = new BN(Math.floor(Date.now() / 1000) + 3600);
      [campaign8] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("campaign"),
          creator.toBuffer(),
          nonce9.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      [campaignVault8] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), campaign8.toBuffer()],
        program.programId
      );
      await program.methods
        .initializeCampaign("Double Extend Campaign", "Test double extend", new BN(1_000_000_000), endTime8, nonce9)
        .accounts({
          creator,
          campaign: campaign8,
          campaignVault: campaignVault8,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();
    });

    it("Should allow creator to extend campaign twice", async () => {
      const extendTime1 = new BN(Math.floor(Date.now() / 1000) + 7200);
      await program.methods
        .extendCampaign(extendTime1)
        .accounts({
          creator,
          campaign: campaign8,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      let campaignAccount = await program.account.campaign.fetch(campaign8);
      assert.equal(campaignAccount.endTime.toNumber(), extendTime1.toNumber());

      const extendTime2 = new BN(Math.floor(Date.now() / 1000) + 10800);
      await program.methods
        .extendCampaign(extendTime2)
        .accounts({
          creator,
          campaign: campaign8,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      campaignAccount = await program.account.campaign.fetch(campaign8);
      assert.equal(campaignAccount.endTime.toNumber(), extendTime2.toNumber());
    });
  });

  describe("[Guards] Financial Accounting", () => {
    let campaign9: anchor.web3.PublicKey;
    let campaignVault9: anchor.web3.PublicKey;
    let backerD: anchor.web3.Keypair;
    let backerE: anchor.web3.Keypair;
    let pledgeD: anchor.web3.PublicKey;
    let pledgeE: anchor.web3.PublicKey;
    let vaultRentReserve: number;
    let endTime9: BN;
    const nonce10 = new BN(10);

    before(async () => {
      backerD = anchor.web3.Keypair.generate();
      backerE = anchor.web3.Keypair.generate();

      for (const b of [backerD, backerE]) {
        const sig = await provider.connection.requestAirdrop(b.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
        await provider.connection.confirmTransaction(sig);
      }

      endTime9 = new BN(Math.floor(Date.now() / 1000) + 8);
      [campaign9] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("campaign"),
          creator.toBuffer(),
          nonce10.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      [campaignVault9] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), campaign9.toBuffer()],
        program.programId
      );
      await program.methods
        .initializeCampaign("Vault Test Campaign", "Test vault balance", new BN(1_000_000_000), endTime9, nonce10)
        .accounts({
          creator,
          campaign: campaign9,
          campaignVault: campaignVault9,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      vaultRentReserve = await provider.connection.getBalance(campaignVault9);

      [pledgeD] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), backerD.publicKey.toBuffer(), campaign9.toBuffer()],
        program.programId
      );
      [pledgeE] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), backerE.publicKey.toBuffer(), campaign9.toBuffer()],
        program.programId
      );
    });

    it("Vault balance should match campaign current_amount after pledges", async () => {
      const pledgeAmountD = new BN(250_000_000);
      const pledgeAmountE = new BN(250_000_000);

      await program.methods
        .pledge(pledgeAmountD)
        .accounts({
          backer: backerD.publicKey,
          campaign: campaign9,
          campaignVault: campaignVault9,
          pledge: pledgeD,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backerD])
        .rpc();

      await program.methods
        .pledge(pledgeAmountE)
        .accounts({
          backer: backerE.publicKey,
          campaign: campaign9,
          campaignVault: campaignVault9,
          pledge: pledgeE,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backerE])
        .rpc();

      const campaignAccount = await program.account.campaign.fetch(campaign9);
      const vaultBalance = await provider.connection.getBalance(campaignVault9);
      assert.equal(vaultBalance - vaultRentReserve, campaignAccount.currentAmount.toNumber());
    });

    it("Vault balance should contain only rent reserve after all refunds", async () => {
      await advancePastUnixTimestamp(endTime9);
      await finalizeCampaign(campaign9);

      await program.methods
        .cancelPledge()
        .accounts({
          backer: backerD.publicKey,
          campaign: campaign9,
          campaignVault: campaignVault9,
          pledge: pledgeD,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backerD])
        .rpc();

      await program.methods
        .cancelPledge()
        .accounts({
          backer: backerE.publicKey,
          campaign: campaign9,
          campaignVault: campaignVault9,
          pledge: pledgeE,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backerE])
        .rpc();

      const vaultBalance = await provider.connection.getBalance(campaignVault9);
      assert.equal(vaultBalance, vaultRentReserve);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Milestone-based escrow flow
  // ---------------------------------------------------------------------------

  describe("[Milestones] Core Flow", () => {
    function findMilestonePda(campaignPubkey: anchor.web3.PublicKey, index: BN) {
      return anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("milestone"),
          campaignPubkey.toBuffer(),
          index.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      )[0];
    }

    function findMilestoneVotePda(
      milestonePubkey: anchor.web3.PublicKey,
      backerPubkey: anchor.web3.PublicKey,
    ) {
      return anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("milestone_vote"),
          milestonePubkey.toBuffer(),
          backerPubkey.toBuffer(),
        ],
        program.programId
      )[0];
    }

    it("Should release funds through approved milestones and close the campaign after all releases", async () => {
      const nonce = new BN(40);
      const endTime = new BN(Math.floor(Date.now() / 1000) + 6);
      const voteEndTime = new BN(Math.floor(Date.now() / 1000) + 3600);
      const goalAmount = new BN(1_000_000_000);
      const firstMilestoneAmount = new BN(400_000_000);
      const secondMilestoneAmount = new BN(600_000_000);
      const milestone0Index = new BN(0);
      const milestone1Index = new BN(1);

      const backerA = anchor.web3.Keypair.generate();
      const backerB = anchor.web3.Keypair.generate();

      for (const backer of [backerA, backerB]) {
        const signature = await provider.connection.requestAirdrop(
          backer.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(signature);
      }

      const [campaignMilestone] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("campaign"),
          creator.toBuffer(),
          nonce.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const [campaignMilestoneVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), campaignMilestone.toBuffer()],
        program.programId
      );
      const pledgeA = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), backerA.publicKey.toBuffer(), campaignMilestone.toBuffer()],
        program.programId
      )[0];
      const pledgeB = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), backerB.publicKey.toBuffer(), campaignMilestone.toBuffer()],
        program.programId
      )[0];
      const milestone0 = findMilestonePda(campaignMilestone, milestone0Index);
      const milestone1 = findMilestonePda(campaignMilestone, milestone1Index);

      await program.methods
        .initializeCampaign(
          "Milestone Success Campaign",
          "Campaign with staged payouts",
          goalAmount,
          endTime,
          nonce
        )
        .accounts({
          creator,
          campaign: campaignMilestone,
          campaignVault: campaignMilestoneVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .createMilestone(milestone0Index, "Prototype", "Build and validate prototype", firstMilestoneAmount, voteEndTime)
        .accounts({
          creator,
          campaign: campaignMilestone,
          milestone: milestone0,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .createMilestone(milestone1Index, "Launch", "Public launch and support", secondMilestoneAmount, voteEndTime)
        .accounts({
          creator,
          campaign: campaignMilestone,
          milestone: milestone1,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .pledge(new BN(600_000_000))
        .accounts({
          backer: backerA.publicKey,
          campaign: campaignMilestone,
          campaignVault: campaignMilestoneVault,
          pledge: pledgeA,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backerA])
        .rpc();

      await program.methods
        .pledge(new BN(400_000_000))
        .accounts({
          backer: backerB.publicKey,
          campaign: campaignMilestone,
          campaignVault: campaignMilestoneVault,
          pledge: pledgeB,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backerB])
        .rpc();

      await advancePastUnixTimestamp(endTime);
      await finalizeCampaign(campaignMilestone);

      await expectProgramError(
        program.methods
          .claim()
          .accounts({
            creator,
            campaign: campaignMilestone,
            campaignVault: campaignMilestoneVault,
            config,
            treasury: treasury.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .rpc(),
        "Milestone flow is required"
      );

      for (const [milestonePubkey, index, expectedGross] of [
        [milestone0, milestone0Index, firstMilestoneAmount],
        [milestone1, milestone1Index, secondMilestoneAmount],
      ] as const) {
        await program.methods
          .submitMilestone()
          .accounts({
            creator,
            campaign: campaignMilestone,
            milestone: milestonePubkey,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .rpc();

        for (const backer of [backerA, backerB]) {
          const milestoneVote = findMilestoneVotePda(milestonePubkey, backer.publicKey);
          const pledge = backer.publicKey.equals(backerA.publicKey) ? pledgeA : pledgeB;

          await program.methods
            .voteMilestone(true)
            .accounts({
              backer: backer.publicKey,
              campaign: campaignMilestone,
              milestone: milestonePubkey,
              pledge,
              milestoneVote,
              systemProgram: anchor.web3.SystemProgram.programId,
              clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
            })
            .signers([backer])
            .rpc();
        }

        await program.methods
          .finalizeMilestone()
          .accounts({
            campaign: campaignMilestone,
            milestone: milestonePubkey,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .rpc();

        await program.methods
          .releaseMilestoneFunds()
          .accounts({
            creator,
            campaign: campaignMilestone,
            milestone: milestonePubkey,
            campaignVault: campaignMilestoneVault,
            config,
            treasury: treasury.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();

        const milestoneAccount = await program.account.milestone.fetch(milestonePubkey);
        assert.deepEqual(milestoneAccount.state, { released: {} });
        assert.equal(milestoneAccount.releasedAmount.toNumber(), expectedGross.toNumber());
        assert.equal(milestoneAccount.index.toNumber(), index.toNumber());
      }

      const updatedCampaign = await program.account.campaign.fetch(campaignMilestone);
      assert.deepEqual(updatedCampaign.state, { claimed: {} });
      assert.equal(updatedCampaign.currentAmount.toNumber(), 0);
      assert.equal(updatedCampaign.milestoneCount.toNumber(), 2);
      assert.equal(updatedCampaign.releasedMilestones.toNumber(), 2);
      assert.equal(updatedCampaign.milestoneAmountTotal.toNumber(), 1_000_000_000);
      assert.equal(updatedCampaign.milestoneAmountReleased.toNumber(), 1_000_000_000);
      assert.equal(
        updatedCampaign.claimedAmount.toNumber(),
        1_000_000_000 - Math.floor(1_000_000_000 * feeBps / 10_000)
      );
    });

    it("Should open proportional refunds after a rejected milestone following a partial release", async () => {
      const nonce = new BN(41);
      const endTime = new BN(Math.floor(Date.now() / 1000) + 6);
      const voteEndTime = new BN(Math.floor(Date.now() / 1000) + 3600);
      const goalAmount = new BN(1_000_000_000);
      const releasedMilestoneAmount = new BN(400_000_000);
      const rejectedMilestoneAmount = new BN(600_000_000);
      const milestone0Index = new BN(0);
      const milestone1Index = new BN(1);

      const backerA = anchor.web3.Keypair.generate();
      const backerB = anchor.web3.Keypair.generate();

      for (const backer of [backerA, backerB]) {
        const signature = await provider.connection.requestAirdrop(
          backer.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(signature);
      }

      const [campaignMilestone] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("campaign"),
          creator.toBuffer(),
          nonce.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const [campaignMilestoneVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), campaignMilestone.toBuffer()],
        program.programId
      );
      const pledgeA = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), backerA.publicKey.toBuffer(), campaignMilestone.toBuffer()],
        program.programId
      )[0];
      const pledgeB = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), backerB.publicKey.toBuffer(), campaignMilestone.toBuffer()],
        program.programId
      )[0];
      const milestone0 = findMilestonePda(campaignMilestone, milestone0Index);
      const milestone1 = findMilestonePda(campaignMilestone, milestone1Index);

      await program.methods
        .initializeCampaign(
          "Milestone Refund Campaign",
          "Campaign that fails after the first release",
          goalAmount,
          endTime,
          nonce
        )
        .accounts({
          creator,
          campaign: campaignMilestone,
          campaignVault: campaignMilestoneVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .createMilestone(milestone0Index, "Foundation", "Initial deliverable", releasedMilestoneAmount, voteEndTime)
        .accounts({
          creator,
          campaign: campaignMilestone,
          milestone: milestone0,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .createMilestone(milestone1Index, "Delivery", "Final deliverable", rejectedMilestoneAmount, voteEndTime)
        .accounts({
          creator,
          campaign: campaignMilestone,
          milestone: milestone1,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .pledge(new BN(700_000_000))
        .accounts({
          backer: backerA.publicKey,
          campaign: campaignMilestone,
          campaignVault: campaignMilestoneVault,
          pledge: pledgeA,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backerA])
        .rpc();

      await program.methods
        .pledge(new BN(300_000_000))
        .accounts({
          backer: backerB.publicKey,
          campaign: campaignMilestone,
          campaignVault: campaignMilestoneVault,
          pledge: pledgeB,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backerB])
        .rpc();

      await advancePastUnixTimestamp(endTime);
      await finalizeCampaign(campaignMilestone);

      await program.methods
        .submitMilestone()
        .accounts({
          creator,
          campaign: campaignMilestone,
          milestone: milestone0,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      for (const backer of [backerA, backerB]) {
        const milestoneVote = findMilestoneVotePda(milestone0, backer.publicKey);
        const pledge = backer.publicKey.equals(backerA.publicKey) ? pledgeA : pledgeB;

        await program.methods
          .voteMilestone(true)
          .accounts({
            backer: backer.publicKey,
            campaign: campaignMilestone,
            milestone: milestone0,
            pledge,
            milestoneVote,
            systemProgram: anchor.web3.SystemProgram.programId,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .signers([backer])
          .rpc();
      }

      await program.methods
        .finalizeMilestone()
        .accounts({
          campaign: campaignMilestone,
          milestone: milestone0,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .releaseMilestoneFunds()
        .accounts({
          creator,
          campaign: campaignMilestone,
          milestone: milestone0,
          campaignVault: campaignMilestoneVault,
          config,
          treasury: treasury.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .submitMilestone()
        .accounts({
          creator,
          campaign: campaignMilestone,
          milestone: milestone1,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      const rejectVoteA = findMilestoneVotePda(milestone1, backerA.publicKey);
      await program.methods
        .voteMilestone(false)
        .accounts({
          backer: backerA.publicKey,
          campaign: campaignMilestone,
          milestone: milestone1,
          pledge: pledgeA,
          milestoneVote: rejectVoteA,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([backerA])
        .rpc();

      await program.methods
        .finalizeMilestone()
        .accounts({
          campaign: campaignMilestone,
          milestone: milestone1,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .failCampaignAndOpenRefunds()
        .accounts({
          creator,
          campaign: campaignMilestone,
          milestone: milestone1,
        })
        .rpc();

      const refundBeforeA = await provider.connection.getBalance(backerA.publicKey);
      const refundBeforeB = await provider.connection.getBalance(backerB.publicKey);

      await program.methods
        .cancelPledge()
        .accounts({
          backer: backerA.publicKey,
          campaign: campaignMilestone,
          campaignVault: campaignMilestoneVault,
          pledge: pledgeA,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backerA])
        .rpc();

      await program.methods
        .cancelPledge()
        .accounts({
          backer: backerB.publicKey,
          campaign: campaignMilestone,
          campaignVault: campaignMilestoneVault,
          pledge: pledgeB,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backerB])
        .rpc();

      const refundAfterA = await provider.connection.getBalance(backerA.publicKey);
      const refundAfterB = await provider.connection.getBalance(backerB.publicKey);

      assert.equal(refundAfterA - refundBeforeA, 420_000_000);
      assert.equal(refundAfterB - refundBeforeB, 180_000_000);

      const campaignAccount = await program.account.campaign.fetch(campaignMilestone);
      assert.deepEqual(campaignAccount.state, { failed: {} });
      assert.equal(campaignAccount.currentAmount.toNumber(), 0);
      assert.equal(campaignAccount.totalRefunded.toNumber(), 600_000_000);
      assert.equal(campaignAccount.refundSnapshotAmount.toNumber(), 600_000_000);
      assert.equal(campaignAccount.refundSnapshotTotalPledged.toNumber(), 1_000_000_000);
      assert.equal(campaignAccount.claimedAmount.toNumber(), 400_000_000 - Math.floor(400_000_000 * feeBps / 10_000));
    });

    it("Should not allow unauthorized user to submit milestone", async () => {
      const nonce = new BN(46);
      const endTime = new BN(Math.floor(Date.now() / 1000) + 6);
      const voteEndTime = new BN(Math.floor(Date.now() / 1000) + 3600);
      const outsider = anchor.web3.Keypair.generate();
      const milestoneIndex = new BN(0);

      const sig = await provider.connection.requestAirdrop(outsider.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);

      const [campaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), nonce.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), campaign.toBuffer()],
        program.programId
      );
      const milestone = findMilestonePda(campaign, milestoneIndex);

      await program.methods
        .initializeCampaign("Unauthorized Submit", "Only creator may submit milestone", new BN(100_000_000), endTime, nonce)
        .accounts({
          creator,
          campaign,
          campaignVault: vault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .createMilestone(milestoneIndex, "Stage", "Unauthorized submit guard", new BN(100_000_000), voteEndTime)
        .accounts({
          creator,
          campaign,
          milestone,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await advancePastUnixTimestamp(endTime);
      await finalizeCampaign(campaign);

      await expectProgramError(
        program.methods
          .submitMilestone()
          .accounts({
            creator: outsider.publicKey,
            campaign,
            milestone,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .signers([outsider])
          .rpc(),
        "ConstraintSeeds"
      );
    });

    it("Should not allow repeat voting by the same backer on one milestone", async () => {
      const nonce = new BN(47);
      const endTime = new BN(Math.floor(Date.now() / 1000) + 6);
      const voteEndTime = new BN(Math.floor(Date.now() / 1000) + 3600);
      const goal = new BN(100_000_000);
      const milestoneIndex = new BN(0);
      const backer = anchor.web3.Keypair.generate();

      const sig = await provider.connection.requestAirdrop(backer.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);

      const [campaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), nonce.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), campaign.toBuffer()],
        program.programId
      );
      const [pledge] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), backer.publicKey.toBuffer(), campaign.toBuffer()],
        program.programId
      );
      const milestone = findMilestonePda(campaign, milestoneIndex);
      const milestoneVote = findMilestoneVotePda(milestone, backer.publicKey);

      await program.methods
        .initializeCampaign("Repeat Vote Guard", "Backer should not vote twice", goal, endTime, nonce)
        .accounts({
          creator,
          campaign,
          campaignVault: vault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .createMilestone(milestoneIndex, "Stage", "Repeat vote guard", goal, voteEndTime)
        .accounts({
          creator,
          campaign,
          milestone,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .pledge(goal)
        .accounts({
          backer: backer.publicKey,
          campaign,
          campaignVault: vault,
          pledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backer])
        .rpc();

      await advancePastUnixTimestamp(endTime);
      await finalizeCampaign(campaign);

      await program.methods
        .submitMilestone()
        .accounts({
          creator,
          campaign,
          milestone,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .voteMilestone(true)
        .accounts({
          backer: backer.publicKey,
          campaign,
          milestone,
          pledge,
          milestoneVote,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([backer])
        .rpc();

      await expectProgramError(
        program.methods
          .voteMilestone(true)
          .accounts({
            backer: backer.publicKey,
            campaign,
            milestone,
            pledge,
            milestoneVote,
            systemProgram: anchor.web3.SystemProgram.programId,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .signers([backer])
          .rpc(),
        "already in use"
      );
    });

    it("Should finalize milestone by timeout without majority into rejected state", async () => {
      const nonce = new BN(48);
      const endTime = new BN(Math.floor(Date.now() / 1000) + 6);
      const voteEndTime = new BN(Math.floor(Date.now() / 1000) + 10);
      const goal = new BN(100_000_000);
      const milestoneIndex = new BN(0);
      const backer = anchor.web3.Keypair.generate();

      const sig = await provider.connection.requestAirdrop(backer.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);

      const [campaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), nonce.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), campaign.toBuffer()],
        program.programId
      );
      const [pledge] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), backer.publicKey.toBuffer(), campaign.toBuffer()],
        program.programId
      );
      const milestone = findMilestonePda(campaign, milestoneIndex);

      await program.methods
        .initializeCampaign("Timeout Finalize", "Milestone should reject after timeout", goal, endTime, nonce)
        .accounts({
          creator,
          campaign,
          campaignVault: vault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .createMilestone(milestoneIndex, "Stage", "Timeout path", goal, voteEndTime)
        .accounts({
          creator,
          campaign,
          milestone,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .pledge(goal)
        .accounts({
          backer: backer.publicKey,
          campaign,
          campaignVault: vault,
          pledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backer])
        .rpc();

      await advancePastUnixTimestamp(endTime);
      await finalizeCampaign(campaign);

      await program.methods
        .submitMilestone()
        .accounts({
          creator,
          campaign,
          milestone,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await advancePastUnixTimestamp(voteEndTime);

      await program.methods
        .finalizeMilestone()
        .accounts({
          campaign,
          milestone,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      const milestoneAccount = await program.account.milestone.fetch(milestone);
      assert.deepEqual(milestoneAccount.state, { rejected: {} });
      assert.equal(milestoneAccount.votesFor.toNumber(), 0);
      assert.equal(milestoneAccount.votesAgainst.toNumber(), 0);
    });

    it("Should not allow unauthorized user to release milestone funds and should reject double release", async () => {
      const nonce = new BN(49);
      const endTime = new BN(Math.floor(Date.now() / 1000) + 6);
      const voteEndTime = new BN(Math.floor(Date.now() / 1000) + 3600);
      const goal = new BN(100_000_000);
      const milestoneIndex = new BN(0);
      const backer = anchor.web3.Keypair.generate();
      const outsider = anchor.web3.Keypair.generate();

      for (const signer of [backer, outsider]) {
        const sig = await provider.connection.requestAirdrop(signer.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
        await provider.connection.confirmTransaction(sig);
      }

      const [campaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), nonce.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), campaign.toBuffer()],
        program.programId
      );
      const [pledge] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), backer.publicKey.toBuffer(), campaign.toBuffer()],
        program.programId
      );
      const milestone = findMilestonePda(campaign, milestoneIndex);
      const milestoneVote = findMilestoneVotePda(milestone, backer.publicKey);

      await program.methods
        .initializeCampaign("Release Guard", "Unauthorized and double release guards", goal, endTime, nonce)
        .accounts({
          creator,
          campaign,
          campaignVault: vault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .createMilestone(milestoneIndex, "Stage", "Release guard", goal, voteEndTime)
        .accounts({
          creator,
          campaign,
          milestone,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .pledge(goal)
        .accounts({
          backer: backer.publicKey,
          campaign,
          campaignVault: vault,
          pledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backer])
        .rpc();

      await advancePastUnixTimestamp(endTime);
      await finalizeCampaign(campaign);

      await program.methods
        .submitMilestone()
        .accounts({
          creator,
          campaign,
          milestone,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .voteMilestone(true)
        .accounts({
          backer: backer.publicKey,
          campaign,
          milestone,
          pledge,
          milestoneVote,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([backer])
        .rpc();

      await program.methods
        .finalizeMilestone()
        .accounts({
          campaign,
          milestone,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await expectProgramError(
        program.methods
          .releaseMilestoneFunds()
          .accounts({
            creator: outsider.publicKey,
            campaign,
            milestone,
            campaignVault: vault,
            config,
            treasury: treasury.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([outsider])
          .rpc(),
        "ConstraintSeeds"
      );

      await program.methods
        .releaseMilestoneFunds()
        .accounts({
          creator,
          campaign,
          milestone,
          campaignVault: vault,
          config,
          treasury: treasury.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await expectProgramError(
        program.methods
          .releaseMilestoneFunds()
          .accounts({
            creator,
            campaign,
            milestone,
            campaignVault: vault,
            config,
            treasury: treasury.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc(),
        "Invalid campaign state"
      );
    });

    it("Should allow milestone resubmission after rejection", async () => {
      const nonce = new BN(50);
      const endTime = new BN(Math.floor(Date.now() / 1000) + 6);
      const voteEndTime = new BN(Math.floor(Date.now() / 1000) + 3600);
      const goal = new BN(100_000_000);
      const milestoneIndex = new BN(0);
      const backer = anchor.web3.Keypair.generate();

      const sig = await provider.connection.requestAirdrop(backer.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);

      const [campaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), nonce.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), campaign.toBuffer()],
        program.programId
      );
      const [pledge] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), backer.publicKey.toBuffer(), campaign.toBuffer()],
        program.programId
      );
      const milestone = findMilestonePda(campaign, milestoneIndex);
      const milestoneVote = findMilestoneVotePda(milestone, backer.publicKey);

      await program.methods
        .initializeCampaign("Resubmit Milestone", "Rejected milestone can be resubmitted", goal, endTime, nonce)
        .accounts({
          creator,
          campaign,
          campaignVault: vault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .createMilestone(milestoneIndex, "Stage", "Resubmit path", goal, voteEndTime)
        .accounts({
          creator,
          campaign,
          milestone,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .pledge(goal)
        .accounts({
          backer: backer.publicKey,
          campaign,
          campaignVault: vault,
          pledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backer])
        .rpc();

      await advancePastUnixTimestamp(endTime);
      await finalizeCampaign(campaign);

      await program.methods
        .submitMilestone()
        .accounts({
          creator,
          campaign,
          milestone,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .voteMilestone(false)
        .accounts({
          backer: backer.publicKey,
          campaign,
          milestone,
          pledge,
          milestoneVote,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([backer])
        .rpc();

      await program.methods
        .finalizeMilestone()
        .accounts({
          campaign,
          milestone,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      let milestoneAccount = await program.account.milestone.fetch(milestone);
      assert.deepEqual(milestoneAccount.state, { rejected: {} });
      assert.equal(milestoneAccount.votesAgainst.toNumber(), goal.toNumber());

      await program.methods
        .submitMilestone()
        .accounts({
          creator,
          campaign,
          milestone,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      milestoneAccount = await program.account.milestone.fetch(milestone);
      assert.deepEqual(milestoneAccount.state, { readyForReview: {} });
      assert.equal(milestoneAccount.votesFor.toNumber(), 0);
      assert.equal(milestoneAccount.votesAgainst.toNumber(), 0);
    });
  });

  describe("[Milestones] Dispute Flow", () => {
    function findMilestonePda(campaignPubkey: anchor.web3.PublicKey, index: BN) {
      return anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("milestone"),
          campaignPubkey.toBuffer(),
          index.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      )[0];
    }

    function findMilestoneVotePda(
      milestonePubkey: anchor.web3.PublicKey,
      backerPubkey: anchor.web3.PublicKey,
    ) {
      return anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("milestone_vote"),
          milestonePubkey.toBuffer(),
          backerPubkey.toBuffer(),
        ],
        program.programId
      )[0];
    }

    it("Should allow arbiter to approve a disputed milestone", async () => {
      const nonce = new BN(43);
      const endTime = new BN(Math.floor(Date.now() / 1000) + 6);
      const voteEndTime = new BN(Math.floor(Date.now() / 1000) + 3600);
      const goalAmount = new BN(500_000_000);
      const milestoneAmount = new BN(500_000_000);
      const milestoneIndex = new BN(0);

      const backer = anchor.web3.Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        backer.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      const [campaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), nonce.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), campaign.toBuffer()],
        program.programId
      );
      const [pledge] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), backer.publicKey.toBuffer(), campaign.toBuffer()],
        program.programId
      );
      const milestone = findMilestonePda(campaign, milestoneIndex);

      await program.methods
        .initializeCampaign("Dispute Approve", "Arbiter approves disputed milestone", goalAmount, endTime, nonce)
        .accounts({
          creator,
          campaign,
          campaignVault: vault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .createMilestone(milestoneIndex, "Delivery", "Creator asks arbiter to approve", milestoneAmount, voteEndTime)
        .accounts({
          creator,
          campaign,
          milestone,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .pledge(goalAmount)
        .accounts({
          backer: backer.publicKey,
          campaign,
          campaignVault: vault,
          pledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backer])
        .rpc();

      await advancePastUnixTimestamp(endTime);
      await finalizeCampaign(campaign);

      await program.methods
        .submitMilestone()
        .accounts({
          creator,
          campaign,
          milestone,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      const rejectVote = findMilestoneVotePda(milestone, backer.publicKey);
      await program.methods
        .voteMilestone(false)
        .accounts({
          backer: backer.publicKey,
          campaign,
          milestone,
          pledge,
          milestoneVote: rejectVote,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([backer])
        .rpc();

      await program.methods
        .finalizeMilestone()
        .accounts({
          campaign,
          milestone,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .openDispute()
        .accounts({
          creator,
          campaign,
          milestone,
        })
        .rpc();

      let milestoneAccount = await program.account.milestone.fetch(milestone);
      assert.deepEqual(milestoneAccount.state, { disputed: {} });

      await program.methods
        .resolveDispute({ approveMilestone: {} })
        .accounts({
          arbiter: creator,
          campaign,
          milestone,
          config,
        })
        .rpc();

      milestoneAccount = await program.account.milestone.fetch(milestone);
      assert.deepEqual(milestoneAccount.state, { approved: {} });

      await program.methods
        .releaseMilestoneFunds()
        .accounts({
          creator,
          campaign,
          milestone,
          campaignVault: vault,
          config,
          treasury: treasury.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const campaignAccount = await program.account.campaign.fetch(campaign);
      assert.deepEqual(campaignAccount.state, { claimed: {} });
      assert.equal(campaignAccount.currentAmount.toNumber(), 0);
    });

    it("Should allow arbiter to resolve a dispute into refunds", async () => {
      const nonce = new BN(44);
      const endTime = new BN(Math.floor(Date.now() / 1000) + 6);
      const voteEndTime = new BN(Math.floor(Date.now() / 1000) + 3600);
      const goalAmount = new BN(600_000_000);
      const milestoneAmount = new BN(600_000_000);
      const milestoneIndex = new BN(0);

      const backer = anchor.web3.Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        backer.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      const [campaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), nonce.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), campaign.toBuffer()],
        program.programId
      );
      const [pledge] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), backer.publicKey.toBuffer(), campaign.toBuffer()],
        program.programId
      );
      const milestone = findMilestonePda(campaign, milestoneIndex);

      await program.methods
        .initializeCampaign("Dispute Refund", "Arbiter opens refunds", goalAmount, endTime, nonce)
        .accounts({
          creator,
          campaign,
          campaignVault: vault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .createMilestone(milestoneIndex, "Only stage", "Rejected and disputed stage", milestoneAmount, voteEndTime)
        .accounts({
          creator,
          campaign,
          milestone,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .pledge(goalAmount)
        .accounts({
          backer: backer.publicKey,
          campaign,
          campaignVault: vault,
          pledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backer])
        .rpc();

      await advancePastUnixTimestamp(endTime);
      await finalizeCampaign(campaign);

      await program.methods
        .submitMilestone()
        .accounts({
          creator,
          campaign,
          milestone,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      const rejectVote = findMilestoneVotePda(milestone, backer.publicKey);
      await program.methods
        .voteMilestone(false)
        .accounts({
          backer: backer.publicKey,
          campaign,
          milestone,
          pledge,
          milestoneVote: rejectVote,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([backer])
        .rpc();

      await program.methods
        .finalizeMilestone()
        .accounts({
          campaign,
          milestone,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .openDispute()
        .accounts({
          creator,
          campaign,
          milestone,
        })
        .rpc();

      await program.methods
        .resolveDispute({ openRefunds: {} })
        .accounts({
          arbiter: creator,
          campaign,
          milestone,
          config,
        })
        .rpc();

      const campaignAccount = await program.account.campaign.fetch(campaign);
      assert.deepEqual(campaignAccount.state, { failed: {} });
      assert.equal(campaignAccount.refundSnapshotAmount.toNumber(), 600_000_000);

      await program.methods
        .cancelPledge()
        .accounts({
          backer: backer.publicKey,
          campaign,
          campaignVault: vault,
          pledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backer])
        .rpc();

      const finalCampaign = await program.account.campaign.fetch(campaign);
      assert.equal(finalCampaign.currentAmount.toNumber(), 0);
      assert.equal(finalCampaign.totalRefunded.toNumber(), 600_000_000);
    });

    it("Should not allow unauthorized user to open or resolve dispute", async () => {
      const nonce = new BN(51);
      const endTime = new BN(Math.floor(Date.now() / 1000) + 6);
      const voteEndTime = new BN(Math.floor(Date.now() / 1000) + 3600);
      const goalAmount = new BN(400_000_000);
      const milestoneAmount = new BN(400_000_000);
      const milestoneIndex = new BN(0);
      const backer = anchor.web3.Keypair.generate();
      const outsider = anchor.web3.Keypair.generate();

      for (const signer of [backer, outsider]) {
        const sig = await provider.connection.requestAirdrop(signer.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
        await provider.connection.confirmTransaction(sig);
      }

      const [campaign] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), creator.toBuffer(), nonce.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), campaign.toBuffer()],
        program.programId
      );
      const [pledge] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pledge"), backer.publicKey.toBuffer(), campaign.toBuffer()],
        program.programId
      );
      const milestone = findMilestonePda(campaign, milestoneIndex);
      const rejectVote = findMilestoneVotePda(milestone, backer.publicKey);

      await program.methods
        .initializeCampaign("Unauthorized Dispute", "Only creator and arbiter may handle disputes", goalAmount, endTime, nonce)
        .accounts({
          creator,
          campaign,
          campaignVault: vault,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .createMilestone(milestoneIndex, "Stage", "Unauthorized dispute guards", milestoneAmount, voteEndTime)
        .accounts({
          creator,
          campaign,
          milestone,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .pledge(goalAmount)
        .accounts({
          backer: backer.publicKey,
          campaign,
          campaignVault: vault,
          pledge,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          creator,
        })
        .signers([backer])
        .rpc();

      await advancePastUnixTimestamp(endTime);
      await finalizeCampaign(campaign);

      await program.methods
        .submitMilestone()
        .accounts({
          creator,
          campaign,
          milestone,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await program.methods
        .voteMilestone(false)
        .accounts({
          backer: backer.publicKey,
          campaign,
          milestone,
          pledge,
          milestoneVote: rejectVote,
          systemProgram: anchor.web3.SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([backer])
        .rpc();

      await program.methods
        .finalizeMilestone()
        .accounts({
          campaign,
          milestone,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();

      await expectProgramError(
        program.methods
          .openDispute()
          .accounts({
            creator: outsider.publicKey,
            campaign,
            milestone,
          })
          .signers([outsider])
          .rpc(),
        "ConstraintSeeds"
      );

      await program.methods
        .openDispute()
        .accounts({
          creator,
          campaign,
          milestone,
        })
        .rpc();

      await expectProgramError(
        program.methods
          .resolveDispute({ approveMilestone: {} })
          .accounts({
            arbiter: outsider.publicKey,
            campaign,
            milestone,
            config,
          })
          .signers([outsider])
          .rpc(),
        "Unauthorized"
      );
    });
  });
});
