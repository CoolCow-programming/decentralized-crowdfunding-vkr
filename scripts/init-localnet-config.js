const fs = require('fs');
const os = require('os');
const path = require('path');
const anchor = require('@coral-xyz/anchor');

const PROGRAM_ID = new anchor.web3.PublicKey('FWh6EtpM5usrduc89K6YEQZ6GQ5UmycGHfM6VSrPcpUz');
const IDL = require('../target/idl/crowdfunding_escrow.json');
const LOCALNET_URL = process.env.SOLANA_URL || 'http://127.0.0.1:8899';
const FEE_BPS = Number(process.env.FEE_BPS || 500);
const walletPath = process.env.ANCHOR_WALLET || path.join(os.homedir(), '.config/solana/id.json');

function loadKeypair(filePath) {
  const secretKey = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

async function main() {
  const keypair = loadKeypair(walletPath);
  const wallet = new anchor.Wallet(keypair);
  const connection = new anchor.web3.Connection(LOCALNET_URL, 'confirmed');
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new anchor.Program(IDL, provider);

  const [configPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    PROGRAM_ID
  );

  const existing = await connection.getAccountInfo(configPda);
  if (existing) {
    console.log(`Config already initialized: ${configPda.toBase58()}`);
    return;
  }

  const signature = await program.methods
    .initializeConfig(FEE_BPS)
    .accounts({
      admin: wallet.publicKey,
      config: configPda,
      treasury: wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log(`Config initialized: ${configPda.toBase58()}`);
  console.log(`Treasury: ${wallet.publicKey.toBase58()}`);
  console.log(`Fee bps: ${FEE_BPS}`);
  console.log(`Signature: ${signature}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
