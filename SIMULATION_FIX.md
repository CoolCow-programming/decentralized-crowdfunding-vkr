# Fixes for "Failed to Simulate Transaction" Error

## Problem
Phantom wallet shows error: "не удалось смоделировать результат этого запроса" (failed to simulate transaction result)

## Root Causes Identified

### 1. **Manual Transaction Sending in createCampaign** (CRITICAL)
**Issue**: Used `signTransaction` + `sendRawTransaction` instead of wallet adapter's `sendTransaction`

**Why it caused simulation failures**:
- `sendRawTransaction` bypasses preflight simulation
- `signTransaction` might be undefined for some wallet adapters
- No proper error handling for simulation failures
- Blockhash could expire during user interaction

**Fix**: 
```typescript
// BEFORE (WRONG):
const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
const tx = new Transaction({ feePayer: publicKey, blockhash, lastValidBlockHeight }).add(instruction);
const signed = await signTransaction!(tx);
const rawTx = signed.serialize();
const signature = await connection.sendRawTransaction(rawTx);

// AFTER (CORRECT):
const tx = new Transaction().add(instruction);
const signature = await sendTransaction(tx, connection, { preflight: true });
```

### 2. **Nonce Reset on Page Reload** (HIGH)
**Issue**: `nextNonce` stored in local React state, resets to 0 on page reload

**Why it caused simulation failures**:
- Trying to create campaign with existing PDA fails
- Anchor's `init` constraint requires uninitialized account
- Simulation fails with "account already initialized"

**Fix**: Fetch highest existing nonce from on-chain state:
```typescript
useEffect(() => {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: 1192 }],
  });
  
  let maxNonce = -1;
  for (const account of accounts) {
    const campaign = decodeCampaign(account.account.data);
    if (campaign.creator.equals(publicKey)) {
      maxNonce = Math.max(maxNonce, Number(campaign.nonce));
    }
  }
  
  setNextNonce(maxNonce + 1);
}, [publicKey, connection]);
```

### 3. **No Explicit Preflight Simulation** (MEDIUM)
**Issue**: Transactions sent without explicit preflight check

**Why it caused silent failures**:
- Wallet adapters might not always run preflight
- Errors only appear during actual execution
- Hard to debug for users

**Fix**: Added explicit simulation before sending:
```typescript
// Simulate transaction first to catch errors early
const simulationResult = await connection.simulateTransaction(tx);
if (simulationResult.value.err) {
  console.error('Simulation error:', simulationResult.value.err);
  console.error('Logs:', simulationResult.value.logs);
  throw new Error('Transaction simulation failed. Check console for details.');
}

// Then send with preflight enabled
const signature = await sendTransaction(tx, connection, {
  preflight: true,
});
```

### 4. **No Discriminator Verification** (MEDIUM)
**Issue**: Pre-computed discriminators never verified against actual SHA256 hashes

**Why it could cause failures**:
- If discriminators are wrong, program can't find instruction
- Silent "InstructionFallbackNotFound" error
- Hard to debug

**Fix**: Added verification on app startup:
```typescript
useEffect(() => {
  verifyDisciminators().then(isValid => {
    if (!isValid) {
      console.error('⚠️ CRITICAL: Discriminator mismatch!');
    } else {
      console.log('✅ Discriminators verified successfully');
    }
  });
}, []);
```

### 5. **Poor Error Messages** (LOW)
**Issue**: Generic error messages don't help users debug

**Fix**: Added contextual error messages:
```typescript
if (err.message?.includes('simulation')) {
  errorMessage = 'Transaction simulation failed. Possible causes:\n' +
    '• Campaign PDA already exists (try refreshing the page)\n' +
    '• Invalid account configuration\n' +
    '• Insufficient SOL for rent exemption';
}
```

## Files Modified

1. **app/src/hooks/useCampaignProgram.ts**
   - Fixed `createCampaign` to use `sendTransaction` 
   - Added nonce fetching from on-chain state
   - Added explicit preflight simulation for all methods
   - Improved error messages

2. **app/src/App.tsx**
   - Added discriminator verification on startup

3. **app/src/utils/constants.ts**
   - Added `nonce` field to Campaign interface
   - Fixed CAMPAIGN_SIZE constant

4. **app/src/utils/discriminators.ts**
   - Created utility for discriminator management
   - Added verification function

## Testing Checklist

- [ ] Connect Phantom wallet
- [ ] Create a new campaign (should show simulation in console)
- [ ] Refresh page - nonce should be correct
- [ ] Check browser console for "✅ Discriminators verified successfully"
- [ ] Try to pledge on a campaign
- [ ] Try to claim/cancel (as appropriate)
- [ ] Verify error messages are helpful when transactions fail

## How to Verify Fix

1. Open browser dev tools (F12)
2. Go to Console tab
3. Connect Phantom wallet
4. Try to create a campaign
5. You should see:
   - "✅ Discriminators verified successfully"
   - Simulation logs showing transaction details
   - If simulation fails, detailed error message with logs

If you still see "failed to simulate", check:
- Is localnet running? (`solana-test-validator`)
- Is the program deployed? (`anchor deploy`)
- Does the wallet have enough SOL? (`solana balance`)
- Check console for detailed simulation error logs
