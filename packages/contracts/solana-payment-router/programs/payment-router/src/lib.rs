#![allow(unexpected_cfgs)]

use anchor_lang::{
    prelude::*,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        program::invoke_signed,
        sysvar::instructions::{load_current_index_checked, load_instruction_at_checked},
    },
};
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("5raasGCxqaEvGsvQ1PvGxRB1JYnA7Y3L4LfjRCfkNJ4f");

const CONFIG_SEED: &[u8] = b"config";
const AUTHORITY_SEED: &[u8] = b"authority";
const INTENT_SEED: &[u8] = b"intent";
const INPUT_ASSET_SEED: &[u8] = b"input-asset";
const SETTLEMENT_ASSET_SEED: &[u8] = b"settlement-asset";
const ROUTER_SEED: &[u8] = b"router";
const ORDER_PREFIX: &[u8] = b"MAYARIN_PAYMENT_ORDER_V1";
const ED25519_HEADER_LEN: usize = 16;
const ED25519_SIGNATURE_LEN: usize = 64;
const ED25519_PUBKEY_LEN: usize = 32;
const CURRENT_INSTRUCTION: u16 = u16::MAX;
const ED25519_PROGRAM_ID: Pubkey = pubkey!("Ed25519SigVerify111111111111111111111111111");

#[program]
pub mod mayarin_payment_router {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        guardian: Pubkey,
        signer: Pubkey,
        fee_recipient: Pubkey,
        deployment_domain: [u8; 32],
    ) -> Result<()> {
        require_keys_neq!(guardian, Pubkey::default(), RouterError::ZeroAddress);
        require_keys_neq!(signer, Pubkey::default(), RouterError::ZeroAddress);
        require_keys_neq!(fee_recipient, Pubkey::default(), RouterError::ZeroAddress);
        require!(
            deployment_domain != [0; 32],
            RouterError::InvalidDeploymentDomain
        );

        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.guardian = guardian;
        config.signer = signer;
        config.fee_recipient = fee_recipient;
        config.deployment_domain = deployment_domain;
        config.paused = false;
        config.authority_bump = ctx.bumps.router_authority;
        config.bump = ctx.bumps.config;

        let settlement_asset = &mut ctx.accounts.settlement_asset;
        settlement_asset.address = ctx.accounts.settlement_mint.key();
        settlement_asset.bump = ctx.bumps.settlement_asset;

        emit!(SettlementAssetAdded {
            mint: settlement_asset.address,
        });
        Ok(())
    }

    pub fn pay_spl(ctx: Context<PaySpl>, order: Order, input_amount: u64) -> Result<()> {
        prepare_payment(
            &ctx.accounts.config,
            &ctx.accounts.instructions,
            &ctx.accounts.settlement_mint.key(),
            &order,
        )?;
        require!(input_amount >= order.min_out, RouterError::MinOutNotMet);

        let settled_amount = order
            .min_out
            .checked_sub(order.fee)
            .ok_or(RouterError::ArithmeticOverflow)?;
        let refund_amount = input_amount
            .checked_sub(order.min_out)
            .ok_or(RouterError::ArithmeticOverflow)?;
        let decimals = ctx.accounts.settlement_mint.decimals;

        transfer_from_payer(
            &ctx.accounts.token_program,
            &ctx.accounts.settlement_mint,
            &ctx.accounts.payer_settlement,
            &ctx.accounts.merchant_settlement,
            &ctx.accounts.payer,
            settled_amount,
            decimals,
        )?;
        transfer_from_payer(
            &ctx.accounts.token_program,
            &ctx.accounts.settlement_mint,
            &ctx.accounts.payer_settlement,
            &ctx.accounts.fee_settlement,
            &ctx.accounts.payer,
            order.fee,
            decimals,
        )?;
        if refund_amount > 0 {
            transfer_from_payer(
                &ctx.accounts.token_program,
                &ctx.accounts.settlement_mint,
                &ctx.accounts.payer_settlement,
                &ctx.accounts.refund_settlement,
                &ctx.accounts.payer,
                refund_amount,
                decimals,
            )?;
        }

        record_consumed(
            &mut ctx.accounts.consumed_intent,
            &order,
            ctx.accounts.payer.key(),
            ctx.bumps.consumed_intent,
        )?;
        emit_payment(
            &order,
            ctx.accounts.payer.key(),
            ctx.accounts.settlement_mint.key(),
            ctx.accounts.settlement_mint.key(),
            input_amount,
            settled_amount,
            refund_amount,
        );
        Ok(())
    }

    pub fn pay_spl_with_swap<'info>(
        ctx: Context<'_, '_, '_, 'info, PaySplWithSwap<'info>>,
        order: Order,
        input_amount: u64,
        route_data: Vec<u8>,
    ) -> Result<()> {
        prepare_payment(
            &ctx.accounts.config,
            &ctx.accounts.instructions,
            &ctx.accounts.settlement_mint.key(),
            &order,
        )?;
        require_keys_neq!(
            ctx.accounts.input_mint.key(),
            ctx.accounts.settlement_mint.key(),
            RouterError::SameAssetRoute
        );
        require!(!route_data.is_empty(), RouterError::NoRoute);
        require!(
            ctx.accounts.route_program.executable,
            RouterError::InvalidRouter
        );

        let input_baseline = ctx.accounts.router_input.amount;
        let settlement_baseline = ctx.accounts.router_settlement.amount;
        transfer_from_payer(
            &ctx.accounts.input_token_program,
            &ctx.accounts.input_mint,
            &ctx.accounts.payer_input,
            &ctx.accounts.router_input,
            &ctx.accounts.payer,
            input_amount,
            ctx.accounts.input_mint.decimals,
        )?;

        invoke_route(
            &ctx.accounts.route_program,
            &ctx.accounts.router_authority,
            ctx.remaining_accounts,
            route_data,
            ctx.accounts.config.authority_bump,
        )?;
        ctx.accounts.router_input.reload()?;
        ctx.accounts.router_settlement.reload()?;

        let output = ctx
            .accounts
            .router_settlement
            .amount
            .checked_sub(settlement_baseline)
            .ok_or(RouterError::RestingBalance)?;
        require!(output >= order.min_out, RouterError::MinOutNotMet);

        let settled_amount = order
            .min_out
            .checked_sub(order.fee)
            .ok_or(RouterError::ArithmeticOverflow)?;
        let refund_amount = output
            .checked_sub(order.min_out)
            .ok_or(RouterError::ArithmeticOverflow)?;
        let authority_bump = [ctx.accounts.config.authority_bump];
        let authority_seeds: &[&[u8]] = &[AUTHORITY_SEED, &authority_bump];

        transfer_from_router(
            &ctx.accounts.settlement_token_program,
            &ctx.accounts.settlement_mint,
            &ctx.accounts.router_settlement,
            &ctx.accounts.merchant_settlement,
            &ctx.accounts.router_authority,
            settled_amount,
            ctx.accounts.settlement_mint.decimals,
            authority_seeds,
        )?;
        transfer_from_router(
            &ctx.accounts.settlement_token_program,
            &ctx.accounts.settlement_mint,
            &ctx.accounts.router_settlement,
            &ctx.accounts.fee_settlement,
            &ctx.accounts.router_authority,
            order.fee,
            ctx.accounts.settlement_mint.decimals,
            authority_seeds,
        )?;
        if refund_amount > 0 {
            transfer_from_router(
                &ctx.accounts.settlement_token_program,
                &ctx.accounts.settlement_mint,
                &ctx.accounts.router_settlement,
                &ctx.accounts.refund_settlement,
                &ctx.accounts.router_authority,
                refund_amount,
                ctx.accounts.settlement_mint.decimals,
                authority_seeds,
            )?;
        }

        let input_residue = ctx
            .accounts
            .router_input
            .amount
            .checked_sub(input_baseline)
            .ok_or(RouterError::RestingBalance)?;
        if input_residue > 0 {
            transfer_from_router(
                &ctx.accounts.input_token_program,
                &ctx.accounts.input_mint,
                &ctx.accounts.router_input,
                &ctx.accounts.refund_input,
                &ctx.accounts.router_authority,
                input_residue,
                ctx.accounts.input_mint.decimals,
                authority_seeds,
            )?;
            emit!(ResidueRefunded {
                intent_id: order.intent_id,
                mint: ctx.accounts.input_mint.key(),
                recipient: order.refund_to,
                amount: input_residue,
            });
        }

        ctx.accounts.router_input.reload()?;
        ctx.accounts.router_settlement.reload()?;
        require!(
            ctx.accounts.router_input.amount == input_baseline
                && ctx.accounts.router_settlement.amount == settlement_baseline,
            RouterError::RestingBalance
        );

        record_consumed(
            &mut ctx.accounts.consumed_intent,
            &order,
            ctx.accounts.payer.key(),
            ctx.bumps.consumed_intent,
        )?;
        emit_payment(
            &order,
            ctx.accounts.payer.key(),
            ctx.accounts.input_mint.key(),
            ctx.accounts.settlement_mint.key(),
            input_amount,
            settled_amount,
            refund_amount,
        );
        Ok(())
    }

    pub fn add_input_asset(ctx: Context<AddInputAsset>) -> Result<()> {
        let entry = &mut ctx.accounts.input_asset;
        entry.address = ctx.accounts.mint.key();
        entry.bump = ctx.bumps.input_asset;
        emit!(InputAssetAdded {
            mint: entry.address
        });
        Ok(())
    }

    pub fn remove_input_asset(ctx: Context<RemoveInputAsset>) -> Result<()> {
        emit!(InputAssetRemoved {
            mint: ctx.accounts.input_asset.address,
        });
        Ok(())
    }

    pub fn add_settlement_asset(ctx: Context<AddSettlementAsset>) -> Result<()> {
        let entry = &mut ctx.accounts.settlement_asset;
        entry.address = ctx.accounts.mint.key();
        entry.bump = ctx.bumps.settlement_asset;
        emit!(SettlementAssetAdded {
            mint: entry.address
        });
        Ok(())
    }

    pub fn remove_settlement_asset(ctx: Context<RemoveSettlementAsset>) -> Result<()> {
        emit!(SettlementAssetRemoved {
            mint: ctx.accounts.settlement_asset.address,
        });
        Ok(())
    }

    pub fn add_router(ctx: Context<AddRouter>) -> Result<()> {
        require_keys_neq!(
            ctx.accounts.route_program.key(),
            crate::ID,
            RouterError::InvalidRouter
        );
        require!(
            ctx.accounts.route_program.executable,
            RouterError::InvalidRouter
        );
        let entry = &mut ctx.accounts.router;
        entry.address = ctx.accounts.route_program.key();
        entry.bump = ctx.bumps.router;
        emit!(RouterAdded {
            program: entry.address,
        });
        Ok(())
    }

    pub fn remove_router(ctx: Context<RemoveRouter>) -> Result<()> {
        emit!(RouterRemoved {
            program: ctx.accounts.router.address,
        });
        Ok(())
    }

    pub fn set_signer(ctx: Context<Configure>, signer: Pubkey) -> Result<()> {
        require_keys_neq!(signer, Pubkey::default(), RouterError::ZeroAddress);
        ctx.accounts.config.signer = signer;
        emit!(SignerUpdated { signer });
        Ok(())
    }

    pub fn set_fee_recipient(ctx: Context<Configure>, fee_recipient: Pubkey) -> Result<()> {
        require_keys_neq!(fee_recipient, Pubkey::default(), RouterError::ZeroAddress);
        ctx.accounts.config.fee_recipient = fee_recipient;
        emit!(FeeRecipientUpdated { fee_recipient });
        Ok(())
    }

    pub fn set_guardian(ctx: Context<Configure>, guardian: Pubkey) -> Result<()> {
        require_keys_neq!(guardian, Pubkey::default(), RouterError::ZeroAddress);
        ctx.accounts.config.guardian = guardian;
        emit!(GuardianUpdated { guardian });
        Ok(())
    }

    pub fn transfer_admin(ctx: Context<Configure>, admin: Pubkey) -> Result<()> {
        require_keys_neq!(admin, Pubkey::default(), RouterError::ZeroAddress);
        ctx.accounts.config.admin = admin;
        emit!(AdminUpdated { admin });
        Ok(())
    }

    pub fn pause(ctx: Context<Guard>) -> Result<()> {
        ctx.accounts.config.paused = true;
        emit!(Paused {});
        Ok(())
    }

    pub fn unpause(ctx: Context<Guard>) -> Result<()> {
        ctx.accounts.config.paused = false;
        emit!(Unpaused {});
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct Order {
    pub intent_id: [u8; 32],
    pub settlement_mint: Pubkey,
    pub min_out: u64,
    pub fee: u64,
    pub merchant: Pubkey,
    pub refund_to: Pubkey,
    pub deadline: i64,
}

impl Order {
    pub fn signing_message(
        &self,
        program_id: &Pubkey,
        config: &Pubkey,
        domain: &[u8; 32],
    ) -> Vec<u8> {
        let mut message = Vec::with_capacity(ORDER_PREFIX.len() + 248);
        message.extend_from_slice(ORDER_PREFIX);
        message.extend_from_slice(program_id.as_ref());
        message.extend_from_slice(config.as_ref());
        message.extend_from_slice(domain);
        message.extend_from_slice(&self.intent_id);
        message.extend_from_slice(self.settlement_mint.as_ref());
        message.extend_from_slice(&self.min_out.to_le_bytes());
        message.extend_from_slice(&self.fee.to_le_bytes());
        message.extend_from_slice(self.merchant.as_ref());
        message.extend_from_slice(self.refund_to.as_ref());
        message.extend_from_slice(&self.deadline.to_le_bytes());
        message
    }
}

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub guardian: Pubkey,
    pub signer: Pubkey,
    pub fee_recipient: Pubkey,
    pub deployment_domain: [u8; 32],
    pub paused: bool,
    pub authority_bump: u8,
    pub bump: u8,
}

impl Config {
    pub const SPACE: usize = 8 + 32 * 5 + 3;
}

#[account]
pub struct AllowlistEntry {
    pub address: Pubkey,
    pub bump: u8,
}

impl AllowlistEntry {
    pub const SPACE: usize = 8 + 32 + 1;
}

#[account]
pub struct ConsumedIntent {
    pub intent_id: [u8; 32],
    pub payer: Pubkey,
    pub consumed_at_slot: u64,
    pub bump: u8,
}

impl ConsumedIntent {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1;
}

#[derive(Accounts)]
#[instruction(guardian: Pubkey, signer: Pubkey, fee_recipient: Pubkey, deployment_domain: [u8; 32])]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = Config::SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: PDA used only as a token authority; it intentionally has no data account.
    #[account(seeds = [AUTHORITY_SEED], bump)]
    pub router_authority: UncheckedAccount<'info>,
    pub settlement_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = admin,
        space = AllowlistEntry::SPACE,
        seeds = [SETTLEMENT_ASSET_SEED, config.key().as_ref(), settlement_mint.key().as_ref()],
        bump
    )]
    pub settlement_asset: Account<'info, AllowlistEntry>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(order: Order)]
pub struct PaySpl<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, constraint = !config.paused @ RouterError::Paused)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = payer,
        space = ConsumedIntent::SPACE,
        seeds = [INTENT_SEED, config.key().as_ref(), order.intent_id.as_ref()],
        bump
    )]
    pub consumed_intent: Box<Account<'info, ConsumedIntent>>,
    pub settlement_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        seeds = [INPUT_ASSET_SEED, config.key().as_ref(), settlement_mint.key().as_ref()],
        bump = input_asset.bump,
        constraint = input_asset.address == settlement_mint.key() @ RouterError::AssetNotWhitelisted
    )]
    pub input_asset: Box<Account<'info, AllowlistEntry>>,
    #[account(
        seeds = [SETTLEMENT_ASSET_SEED, config.key().as_ref(), settlement_mint.key().as_ref()],
        bump = settlement_asset.bump,
        constraint = settlement_asset.address == settlement_mint.key() @ RouterError::SettlementAssetNotWhitelisted
    )]
    pub settlement_asset: Box<Account<'info, AllowlistEntry>>,
    #[account(mut, token::mint = settlement_mint, token::authority = payer, token::token_program = token_program)]
    pub payer_settlement: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = settlement_mint, token::token_program = token_program, constraint = merchant_settlement.owner == order.merchant @ RouterError::InvalidMerchant)]
    pub merchant_settlement: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = settlement_mint, token::token_program = token_program, constraint = fee_settlement.owner == config.fee_recipient @ RouterError::InvalidFeeRecipient)]
    pub fee_settlement: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = settlement_mint, token::token_program = token_program, constraint = refund_settlement.owner == order.refund_to @ RouterError::InvalidRefundRecipient)]
    pub refund_settlement: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: address is constrained to the instructions sysvar and read only.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(order: Order)]
pub struct PaySplWithSwap<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, constraint = !config.paused @ RouterError::Paused)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        init,
        payer = payer,
        space = ConsumedIntent::SPACE,
        seeds = [INTENT_SEED, config.key().as_ref(), order.intent_id.as_ref()],
        bump
    )]
    pub consumed_intent: Box<Account<'info, ConsumedIntent>>,
    /// CHECK: PDA used only as CPI and token authority.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub router_authority: UncheckedAccount<'info>,
    pub input_mint: Box<InterfaceAccount<'info, Mint>>,
    pub settlement_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        seeds = [INPUT_ASSET_SEED, config.key().as_ref(), input_mint.key().as_ref()],
        bump = input_asset.bump,
        constraint = input_asset.address == input_mint.key() @ RouterError::AssetNotWhitelisted
    )]
    pub input_asset: Box<Account<'info, AllowlistEntry>>,
    #[account(
        seeds = [SETTLEMENT_ASSET_SEED, config.key().as_ref(), settlement_mint.key().as_ref()],
        bump = settlement_asset.bump,
        constraint = settlement_asset.address == settlement_mint.key() @ RouterError::SettlementAssetNotWhitelisted
    )]
    pub settlement_asset: Box<Account<'info, AllowlistEntry>>,
    /// CHECK: executable and allowlisted constraints are enforced below.
    pub route_program: UncheckedAccount<'info>,
    #[account(
        seeds = [ROUTER_SEED, config.key().as_ref(), route_program.key().as_ref()],
        bump = router.bump,
        constraint = router.address == route_program.key() @ RouterError::RouterNotWhitelisted
    )]
    pub router: Box<Account<'info, AllowlistEntry>>,
    #[account(mut, token::mint = input_mint, token::authority = payer, token::token_program = input_token_program)]
    pub payer_input: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = input_mint, token::token_program = input_token_program, constraint = refund_input.owner == order.refund_to @ RouterError::InvalidRefundRecipient)]
    pub refund_input: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = input_mint, token::authority = router_authority, token::token_program = input_token_program)]
    pub router_input: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = settlement_mint, token::authority = router_authority, token::token_program = settlement_token_program)]
    pub router_settlement: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = settlement_mint, token::token_program = settlement_token_program, constraint = merchant_settlement.owner == order.merchant @ RouterError::InvalidMerchant)]
    pub merchant_settlement: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = settlement_mint, token::token_program = settlement_token_program, constraint = fee_settlement.owner == config.fee_recipient @ RouterError::InvalidFeeRecipient)]
    pub fee_settlement: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = settlement_mint, token::token_program = settlement_token_program, constraint = refund_settlement.owner == order.refund_to @ RouterError::InvalidRefundRecipient)]
    pub refund_settlement: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: address is constrained to the instructions sysvar and read only.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub input_token_program: Interface<'info, TokenInterface>,
    pub settlement_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Configure<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ RouterError::Unauthorized)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct Guard<'info> {
    pub guardian: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = guardian @ RouterError::Unauthorized)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct AddInputAsset<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ RouterError::Unauthorized)]
    pub config: Account<'info, Config>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(init, payer = admin, space = AllowlistEntry::SPACE, seeds = [INPUT_ASSET_SEED, config.key().as_ref(), mint.key().as_ref()], bump)]
    pub input_asset: Account<'info, AllowlistEntry>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RemoveInputAsset<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ RouterError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, close = admin, seeds = [INPUT_ASSET_SEED, config.key().as_ref(), input_asset.address.as_ref()], bump = input_asset.bump)]
    pub input_asset: Account<'info, AllowlistEntry>,
}

#[derive(Accounts)]
pub struct AddSettlementAsset<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ RouterError::Unauthorized)]
    pub config: Account<'info, Config>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(init, payer = admin, space = AllowlistEntry::SPACE, seeds = [SETTLEMENT_ASSET_SEED, config.key().as_ref(), mint.key().as_ref()], bump)]
    pub settlement_asset: Account<'info, AllowlistEntry>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RemoveSettlementAsset<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ RouterError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, close = admin, seeds = [SETTLEMENT_ASSET_SEED, config.key().as_ref(), settlement_asset.address.as_ref()], bump = settlement_asset.bump)]
    pub settlement_asset: Account<'info, AllowlistEntry>,
}

#[derive(Accounts)]
pub struct AddRouter<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ RouterError::Unauthorized)]
    pub config: Account<'info, Config>,
    /// CHECK: handler requires an executable account and rejects this program.
    pub route_program: UncheckedAccount<'info>,
    #[account(init, payer = admin, space = AllowlistEntry::SPACE, seeds = [ROUTER_SEED, config.key().as_ref(), route_program.key().as_ref()], bump)]
    pub router: Account<'info, AllowlistEntry>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RemoveRouter<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ RouterError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, close = admin, seeds = [ROUTER_SEED, config.key().as_ref(), router.address.as_ref()], bump = router.bump)]
    pub router: Account<'info, AllowlistEntry>,
}

fn prepare_payment(
    config: &Account<Config>,
    instructions: &UncheckedAccount,
    settlement_mint: &Pubkey,
    order: &Order,
) -> Result<()> {
    require!(!config.paused, RouterError::Paused);
    require!(
        Clock::get()?.unix_timestamp <= order.deadline,
        RouterError::ExpiredOrder
    );
    require!(order.min_out > 0, RouterError::InvalidOrder);
    require!(order.fee < order.min_out, RouterError::FeeExceedsSettlement);
    require_keys_neq!(order.merchant, Pubkey::default(), RouterError::InvalidOrder);
    require_keys_neq!(
        order.refund_to,
        Pubkey::default(),
        RouterError::InvalidOrder
    );
    require_keys_eq!(
        *settlement_mint,
        order.settlement_mint,
        RouterError::InvalidOrder
    );

    let message = order.signing_message(&crate::ID, &config.key(), &config.deployment_domain);
    verify_previous_ed25519_instruction(instructions, &config.signer, &message)
}

fn verify_previous_ed25519_instruction(
    instructions: &UncheckedAccount,
    expected_signer: &Pubkey,
    expected_message: &[u8],
) -> Result<()> {
    let current_index = load_current_index_checked(&instructions.to_account_info())?;
    require!(current_index > 0, RouterError::MissingSignatureInstruction);
    let instruction = load_instruction_at_checked(
        usize::from(current_index - 1),
        &instructions.to_account_info(),
    )?;
    require_keys_eq!(
        instruction.program_id,
        ED25519_PROGRAM_ID,
        RouterError::InvalidSigner
    );
    require!(instruction.accounts.is_empty(), RouterError::InvalidSigner);

    let data = instruction.data;
    require!(data.len() >= ED25519_HEADER_LEN, RouterError::InvalidSigner);
    require!(data[0] == 1 && data[1] == 0, RouterError::InvalidSigner);

    let signature_offset = read_u16(&data, 2)? as usize;
    let signature_instruction = read_u16(&data, 4)?;
    let pubkey_offset = read_u16(&data, 6)? as usize;
    let pubkey_instruction = read_u16(&data, 8)?;
    let message_offset = read_u16(&data, 10)? as usize;
    let message_len = read_u16(&data, 12)? as usize;
    let message_instruction = read_u16(&data, 14)?;

    require!(
        signature_instruction == CURRENT_INSTRUCTION
            && pubkey_instruction == CURRENT_INSTRUCTION
            && message_instruction == CURRENT_INSTRUCTION,
        RouterError::InvalidSigner
    );
    checked_slice(&data, signature_offset, ED25519_SIGNATURE_LEN)?;
    let pubkey = checked_slice(&data, pubkey_offset, ED25519_PUBKEY_LEN)?;
    let message = checked_slice(&data, message_offset, message_len)?;
    require!(
        pubkey == expected_signer.as_ref(),
        RouterError::InvalidSigner
    );
    require!(message == expected_message, RouterError::InvalidSigner);
    Ok(())
}

fn read_u16(data: &[u8], offset: usize) -> Result<u16> {
    let bytes = checked_slice(data, offset, 2)?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn checked_slice(data: &[u8], offset: usize, len: usize) -> Result<&[u8]> {
    let end = offset.checked_add(len).ok_or(RouterError::InvalidSigner)?;
    data.get(offset..end)
        .ok_or_else(|| error!(RouterError::InvalidSigner))
}

fn invoke_route<'info>(
    route_program: &UncheckedAccount<'info>,
    router_authority: &UncheckedAccount<'info>,
    route_accounts: &[AccountInfo<'info>],
    data: Vec<u8>,
    authority_bump: u8,
) -> Result<()> {
    let metas = route_accounts
        .iter()
        .map(|account| AccountMeta {
            pubkey: *account.key,
            // Do not forward any transaction signer's privilege into an
            // arbitrary route. The allowlisted router receives only the PDA
            // authority it needs to spend the exact input-vault deposit.
            is_signer: account.key == router_authority.key,
            is_writable: account.is_writable,
        })
        .collect();
    let instruction = Instruction {
        program_id: route_program.key(),
        accounts: metas,
        data,
    };
    let mut infos = route_accounts.to_vec();
    infos.push(route_program.to_account_info());
    let bump = [authority_bump];
    let authority_seeds: &[&[u8]] = &[AUTHORITY_SEED, &bump];
    invoke_signed(&instruction, &infos, &[authority_seeds])?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn transfer_from_payer<'info>(
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    payer: &Signer<'info>,
    amount: u64,
    decimals: u8,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token_interface::transfer_checked(
        CpiContext::new(
            token_program.to_account_info(),
            TransferChecked {
                from: from.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: payer.to_account_info(),
            },
        ),
        amount,
        decimals,
    )
}

#[allow(clippy::too_many_arguments)]
fn transfer_from_router<'info>(
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    authority: &UncheckedAccount<'info>,
    amount: u64,
    decimals: u8,
    authority_seeds: &[&[u8]],
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked {
                from: from.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: authority.to_account_info(),
            },
            &[authority_seeds],
        ),
        amount,
        decimals,
    )
}

fn record_consumed(
    consumed: &mut Account<ConsumedIntent>,
    order: &Order,
    payer: Pubkey,
    bump: u8,
) -> Result<()> {
    consumed.intent_id = order.intent_id;
    consumed.payer = payer;
    consumed.consumed_at_slot = Clock::get()?.slot;
    consumed.bump = bump;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn emit_payment(
    order: &Order,
    payer: Pubkey,
    input_mint: Pubkey,
    settlement_mint: Pubkey,
    input_amount: u64,
    settled_amount: u64,
    refund_amount: u64,
) {
    emit!(PaymentCompleted {
        intent_id: order.intent_id,
        payer,
        merchant: order.merchant,
        refund_to: order.refund_to,
        input_mint,
        settlement_mint,
        input_amount,
        settled_amount,
        fee: order.fee,
        refund_amount,
        deadline: order.deadline,
    });
}

#[event]
pub struct PaymentCompleted {
    pub intent_id: [u8; 32],
    pub payer: Pubkey,
    pub merchant: Pubkey,
    pub refund_to: Pubkey,
    pub input_mint: Pubkey,
    pub settlement_mint: Pubkey,
    pub input_amount: u64,
    pub settled_amount: u64,
    pub fee: u64,
    pub refund_amount: u64,
    pub deadline: i64,
}

#[event]
pub struct ResidueRefunded {
    pub intent_id: [u8; 32],
    pub mint: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
}

#[event]
pub struct RouterAdded {
    pub program: Pubkey,
}
#[event]
pub struct RouterRemoved {
    pub program: Pubkey,
}
#[event]
pub struct InputAssetAdded {
    pub mint: Pubkey,
}
#[event]
pub struct InputAssetRemoved {
    pub mint: Pubkey,
}
#[event]
pub struct SettlementAssetAdded {
    pub mint: Pubkey,
}
#[event]
pub struct SettlementAssetRemoved {
    pub mint: Pubkey,
}
#[event]
pub struct FeeRecipientUpdated {
    pub fee_recipient: Pubkey,
}
#[event]
pub struct SignerUpdated {
    pub signer: Pubkey,
}
#[event]
pub struct GuardianUpdated {
    pub guardian: Pubkey,
}
#[event]
pub struct AdminUpdated {
    pub admin: Pubkey,
}
#[event]
pub struct Paused {}
#[event]
pub struct Unpaused {}

#[error_code]
pub enum RouterError {
    #[msg("the payment router is paused")]
    Paused,
    #[msg("the signed order has expired")]
    ExpiredOrder,
    #[msg("the order is invalid")]
    InvalidOrder,
    #[msg("the fee must be smaller than min_out")]
    FeeExceedsSettlement,
    #[msg("the required Ed25519 signature instruction is missing")]
    MissingSignatureInstruction,
    #[msg("the order signer or signed message is invalid")]
    InvalidSigner,
    #[msg("the input asset is not whitelisted")]
    AssetNotWhitelisted,
    #[msg("the settlement asset is not whitelisted")]
    SettlementAssetNotWhitelisted,
    #[msg("the swap router is not whitelisted")]
    RouterNotWhitelisted,
    #[msg("the route is missing")]
    NoRoute,
    #[msg("the route program is invalid")]
    InvalidRouter,
    #[msg("use pay_spl for same-asset payments")]
    SameAssetRoute,
    #[msg("swap output did not meet min_out")]
    MinOutNotMet,
    #[msg("the router vault did not return to its per-call baseline")]
    RestingBalance,
    #[msg("the merchant token account has the wrong owner")]
    InvalidMerchant,
    #[msg("the refund token account has the wrong owner")]
    InvalidRefundRecipient,
    #[msg("the fee token account has the wrong owner")]
    InvalidFeeRecipient,
    #[msg("the caller is not authorized")]
    Unauthorized,
    #[msg("a required public key is zero")]
    ZeroAddress,
    #[msg("deployment_domain must not be all zeroes")]
    InvalidDeploymentDomain,
    #[msg("arithmetic overflow")]
    ArithmeticOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signing_message_is_fixed_width_and_domain_separated() {
        let order = Order {
            intent_id: [7; 32],
            settlement_mint: Pubkey::new_from_array([8; 32]),
            min_out: 100_000_000,
            fee: 1_000_000,
            merchant: Pubkey::new_from_array([9; 32]),
            refund_to: Pubkey::new_from_array([10; 32]),
            deadline: 1_900_000_000,
        };
        let program = Pubkey::new_from_array([1; 32]);
        let config = Pubkey::new_from_array([2; 32]);
        let first = order.signing_message(&program, &config, &[3; 32]);
        let second = order.signing_message(&program, &config, &[4; 32]);

        assert_eq!(first.len(), ORDER_PREFIX.len() + 248);
        assert_ne!(first, second);
        assert_eq!(&first[..ORDER_PREFIX.len()], ORDER_PREFIX);
    }

    #[test]
    fn signing_message_uses_little_endian_amounts_and_deadline() {
        let order = Order {
            intent_id: [0; 32],
            settlement_mint: Pubkey::default(),
            min_out: 0x0102_0304_0506_0708,
            fee: 0x1112_1314_1516_1718,
            merchant: Pubkey::default(),
            refund_to: Pubkey::default(),
            deadline: 0x2122_2324_2526_2728,
        };
        let message = order.signing_message(&Pubkey::default(), &Pubkey::default(), &[0; 32]);
        let amounts_offset = ORDER_PREFIX.len() + 32 * 5;

        assert_eq!(
            &message[amounts_offset..amounts_offset + 8],
            &order.min_out.to_le_bytes()
        );
        assert_eq!(
            &message[amounts_offset + 8..amounts_offset + 16],
            &order.fee.to_le_bytes()
        );
        assert_eq!(&message[message.len() - 8..], &order.deadline.to_le_bytes());
    }
}
