# PulseLocker — Immutable Discipline Vaults for PLS, pDAI, or HEX  
### Unlocking via USD price threshold, or via time (guaranteed backup)

PulseLocker provides **fully on-chain, single-use vaults** for PulseChain tokens.  
Each vault unlocks **permanently and irreversibly** when **either**:

- A **user-defined USD price target** is reached  
- A **user-defined time unlock** occurs (guaranteed fallback)

All logic is enforced through **immutable smart contracts** with **no admin keys**, ensuring permanent, trustless behaviour.

---

## Features

### Immutable Vaults
- Lock **PLS (native)**, **pDAI**, or **HEX**
- Configure both:
  - a **USD price threshold**, and
  - a **backup time unlock**
- **Creation and deposit are bundled** into a single transaction
- Withdraw **once**, permanently, when conditions are met
- After withdrawal, the vault is **finished forever**
- Accidental extra tokens sent later can be safely recovered via rescue functions

---

### USD-Based Price Thresholds (On-Chain)
Vaults compute price **directly from PulseX liquidity**, with no oracles and no off-chain dependencies.

- **Dual price feeds** (primary & backup)
- Automatic feed selection based on **USD-side liquidity depth**
- Deterministic tie-breaker logic
- Fully on-chain, manipulation-resistant pricing
- If all feeds fail, **time unlock still guarantees access**

---

### Guaranteed Time Unlock
- Every vault includes a **mandatory backup unlock time**
- Funds are **always recoverable**, regardless of price behaviour
- No reliance on external services or admin intervention

---

### Single-Use, Non-Custodial Design
- Vaults are **single-purpose and single-withdraw**
- No partial withdrawals
- No re-locking
- No upgrade paths
- No owner privileges after deployment

---

### Optional Rewards (Non-Blocking)
PulseLocker may optionally emit protocol rewards when a vault is withdrawn.

- Rewards are **best-effort only**
- Rewards **never block withdrawals**
- Withdrawals always succeed, even if rewards are unavailable
- A portion of rewards may be routed to a protocol fee address

> Rewards are an optional incentive layer — **not a dependency**.

---

### Rescue & Safety
- Principal can **never** be withdrawn early
- After withdrawal:
  - Any **excess lock tokens** can be rescued
  - Any **foreign ERC20 tokens** (including WPLS) can be rescued
  - Any **native PLS** accidentally sent can be rescued
- Rescue logic is hard-restricted and cannot bypass lock conditions

---

## Architecture Overview
User
↓
VaultFactoryVNext
↓ (create + deposit + snapshot)
GenericPriceTimeVaultVNext
↓
Withdraw (price OR time)
↓
Principal returned + optional rewards

---


### Core Contracts
- **VaultFactoryVNext**
  - Token configuration
  - Price feed routing
  - Vault deployment
- **GenericPriceTimeVaultVNext**
  - Immutable vault logic
  - Unlock conditions
  - Withdrawal & rescue safety
- **RewardsDistributor** (optional)
  - Best-effort reward calculation
- **PulseLockerRewardToken** (optional)
  - Fixed-cap reward token

---

## Frontend
- Single-page web UI
- Wallet-connected (PulseChain)
- No legacy factory support
- Bundled vault creation flow
- Real-time price feed visibility
- Vault restore from on-chain registry
- View-only support for external vaults

---

## Design Principles
- **Immutability first**
- **No admin keys**
- **No oracle reliance**
- **No upgrade risk**
- **Time unlock always guaranteed**
- **Rewards never interfere with custody**

---

## Disclaimer
PulseLocker is provided **as-is**, without warranties.  
Users are solely responsible for verifying contract behaviour before use.

Smart contracts are immutable once deployed.

---

## Links
- Website: https://pulselocker.xyz
- PulseChain Explorer: https://scan.pulsechain.com
- Telegram: https://t.me/pulselocker
