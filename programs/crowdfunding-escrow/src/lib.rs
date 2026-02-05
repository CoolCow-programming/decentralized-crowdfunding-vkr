use anchor_lang::prelude::*;

declare_id!("AZmmfhrAZxbiLqRtDZV7zVKwJ8wX9PMDG5wzxiCRin1r");

#[program]
pub mod crowdfunding_escrow {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
