import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Guardian Wallet - Reference Specification Model
 * Validates the state machine, actor-permission matrix, and edge cases defined in SPEC.md.
 */

const TrustTier = {
  UNKNOWN: 0,
  TRUSTED: 1,
  VERIFIED_IDENTITY: 2,
};

const TransferState = {
  NONE: 'NONE',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  CANCELLED: 'CANCELLED',
  EXECUTED: 'EXECUTED',
  EXPIRED: 'EXPIRED',
};

class GuardianWalletModel {
  constructor(owner, guardians = [], threshold = 2) {
    this.owner = owner;
    this.guardians = new Set(guardians);
    this.threshold = threshold;
    this.isFrozen = false;
    this.nonce = 0;

    // Spending limits
    this.perTxLimit = 1000n; // 1000 tUSD8
    this.dailyLimit = 2500n; // 2500 tUSD8
    this.dailySpent = 0n;
    this.lastDailyReset = 0;

    // Payee Registry
    this.payees = new Map(); // address => { tier, registeredAt }
    this.payeeCooldownPeriod = 86400; // 24 hours

    // Pending Queue
    this.transfers = new Map(); // id => Transfer object
    this.defaultTimelock = 3600; // 1 hour
    this.expirationWindow = 86400 * 3; // 3 days

    // Session Keys (Kids)
    this.sessions = new Map(); // address => { weeklyAllowance, spentThisPeriod, allowedPayees, expiresAt, isActive }

    // Sentinel Agent
    this.sentinelAgents = new Set();

    // Virtual blockchain timestamp
    this.currentTime = 1000000;
  }

  // --- Administration & Access Controls ---

  setFreeze(caller, freeze) {
    if (caller !== this.owner && !this.guardians.has(caller)) {
      throw new Error('Unauthorized');
    }
    this.isFrozen = freeze;
  }

  registerPayee(caller, payeeAddress, tier) {
    if (caller !== this.owner) {
      throw new Error('OnlyOwner');
    }
    this.payees.set(payeeAddress, {
      tier,
      registeredAt: this.currentTime,
    });
  }

  getEffectivePayeeTier(payeeAddress) {
    const record = this.payees.get(payeeAddress);
    if (!record) return TrustTier.UNKNOWN;
    if (record.tier === TrustTier.TRUSTED) {
      if (this.currentTime < record.registeredAt + this.payeeCooldownPeriod) {
        return TrustTier.UNKNOWN; // Cooldown not elapsed
      }
      return TrustTier.TRUSTED;
    }
    return record.tier;
  }

  registerSentinel(caller, sentinelAddress) {
    if (caller !== this.owner) throw new Error('OnlyOwner');
    this.sentinelAgents.add(sentinelAddress);
  }

  authorizeSessionKey(caller, sessionKeyAddress, weeklyAllowance, duration, allowedPayees = []) {
    if (caller !== this.owner) throw new Error('OnlyOwner');
    this.sessions.set(sessionKeyAddress, {
      weeklyAllowance: BigInt(weeklyAllowance),
      spentThisPeriod: 0n,
      periodStart: this.currentTime,
      allowedPayees: new Set(allowedPayees),
      expiresAt: this.currentTime + duration,
      isActive: true,
    });
  }

  revokeSessionKey(caller, sessionKeyAddress) {
    if (caller !== this.owner && !this.guardians.has(caller)) {
      throw new Error('Unauthorized');
    }
    const session = this.sessions.get(sessionKeyAddress);
    if (session) {
      session.isActive = false;
    }
  }

  // --- Spending & Transfer Operations ---

  initiateSpend(caller, to, amount) {
    if (this.isFrozen) throw new Error('AccountIsFrozen');
    if (caller !== this.owner) throw new Error('OnlyOwnerCanInitiateSpend');
    if (!to || to === '0x0') throw new Error('InvalidRecipient');
    if (amount <= 0n) throw new Error('InvalidAmount');

    const effectiveTier = this.getEffectivePayeeTier(to);
    const exceedsPerTx = amount > this.perTxLimit;
    const exceedsDaily = this.dailySpent + amount > this.dailyLimit;

    // Fast-path: Immediate clearance
    if (effectiveTier === TrustTier.TRUSTED && !exceedsPerTx && !exceedsDaily) {
      this.dailySpent += amount;
      this.nonce++;
      return {
        status: TransferState.EXECUTED,
        txId: `tx-fast-${this.nonce}`,
      };
    }

    // Slow-path: Queue transfer into PendingQueue
    this.nonce++;
    const transferId = `pending-${this.nonce}`;
    this.transfers.set(transferId, {
      id: transferId,
      to,
      amount,
      createdAt: this.currentTime,
      executeAfter: this.currentTime + this.defaultTimelock,
      expiresAt: this.currentTime + this.defaultTimelock + this.expirationWindow,
      state: TransferState.PENDING,
      approvals: new Set(),
      sentinelHold: false,
    });

    return {
      status: TransferState.PENDING,
      transferId,
      reason: effectiveTier !== TrustTier.TRUSTED ? 'UnknownPayee' : 'ExceedsLimit',
    };
  }

  approveQueuedTransfer(guardian, transferId) {
    if (!this.guardians.has(guardian)) throw new Error('OnlyGuardian');
    const transfer = this.transfers.get(transferId);
    if (!transfer) throw new Error('TransferNotFound');
    if (transfer.state !== TransferState.PENDING) throw new Error('InvalidTransferState');
    if (transfer.approvals.has(guardian)) throw new Error('AlreadyApprovedByGuardian');

    transfer.approvals.add(guardian);
    if (transfer.approvals.size >= this.threshold) {
      transfer.state = TransferState.APPROVED;
    }
    return transfer.state;
  }

  cancelQueuedTransfer(caller, transferId) {
    if (caller !== this.owner && !this.guardians.has(caller)) {
      throw new Error('Unauthorized');
    }
    const transfer = this.transfers.get(transferId);
    if (!transfer) throw new Error('TransferNotFound');
    if (transfer.state === TransferState.EXECUTED || transfer.state === TransferState.CANCELLED) {
      throw new Error('CannotCancelFinalizedTransfer');
    }
    transfer.state = TransferState.CANCELLED;
    return transfer.state;
  }

  holdBySentinel(agent, transferId, reason) {
    if (!this.sentinelAgents.has(agent)) throw new Error('OnlySentinel');
    const transfer = this.transfers.get(transferId);
    if (!transfer) throw new Error('TransferNotFound');
    if (transfer.state !== TransferState.PENDING) throw new Error('InvalidTransferState');

    transfer.sentinelHold = true;
    transfer.holdReason = reason;
    return true;
  }

  executeTransfer(caller, transferId) {
    if (this.isFrozen) throw new Error('AccountIsFrozen');
    const transfer = this.transfers.get(transferId);
    if (!transfer) throw new Error('TransferNotFound');

    if (transfer.state === TransferState.EXECUTED) throw new Error('AlreadyExecuted');
    if (transfer.state === TransferState.CANCELLED) throw new Error('TransferCancelled');
    if (transfer.state !== TransferState.APPROVED) throw new Error('TransferNotApproved');

    if (this.currentTime < transfer.executeAfter) throw new Error('TimelockNotElapsed');
    if (this.currentTime > transfer.expiresAt) {
      transfer.state = TransferState.EXPIRED;
      throw new Error('TransferExpired');
    }
    if (transfer.sentinelHold) throw new Error('HeldBySentinel');

    transfer.state = TransferState.EXECUTED;
    return true;
  }

  // --- Session Key Execution (Kids) ---

  executeViaSessionKey(sessionKey, to, amount) {
    if (this.isFrozen) throw new Error('AccountIsFrozen');
    const session = this.sessions.get(sessionKey);
    if (!session || !session.isActive) throw new Error('InvalidOrRevokedSessionKey');
    if (this.currentTime > session.expiresAt) throw new Error('SessionKeyExpired');
    if (!session.allowedPayees.has(to)) throw new Error('PayeeNotAllowedForSession');
    if (session.spentThisPeriod + amount > session.weeklyAllowance) throw new Error('ExceedsSessionCap');

    session.spentThisPeriod += amount;
    this.nonce++;
    return {
      status: TransferState.EXECUTED,
      txId: `tx-session-${this.nonce}`,
    };
  }
}

// =========================================================================
// TEST SUITE: Validating Specification & Threat Model Edge Cases
// =========================================================================

test('SPEC 1: Fast-path execution for trusted payee within limits', () => {
  const wallet = new GuardianWalletModel('0xOwner', ['0xG1', '0xG2'], 2);
  const payee = '0xTrustedStore';
  wallet.registerPayee('0xOwner', payee, TrustTier.TRUSTED);
  wallet.currentTime += 86401; // Elapse 24h cooldown

  const res = wallet.initiateSpend('0xOwner', payee, 500n);
  assert.equal(res.status, TransferState.EXECUTED);
  assert.equal(wallet.dailySpent, 500n);
});

test('SPEC 2: Unknown payee triggers PendingQueue timelock', () => {
  const wallet = new GuardianWalletModel('0xOwner', ['0xG1', '0xG2'], 2);
  const unknownPayee = '0xStranger';

  const res = wallet.initiateSpend('0xOwner', unknownPayee, 200n);
  assert.equal(res.status, TransferState.PENDING);
  assert.equal(res.reason, 'UnknownPayee');
  assert.ok(wallet.transfers.has(res.transferId));
});

test('SPEC 3: Transfer exceeding per-transaction cap triggers PendingQueue', () => {
  const wallet = new GuardianWalletModel('0xOwner', ['0xG1', '0xG2'], 2);
  const payee = '0xTrustedStore';
  wallet.registerPayee('0xOwner', payee, TrustTier.TRUSTED);
  wallet.currentTime += 86401;

  // 1500 tUSD8 exceeds perTxLimit (1000 tUSD8)
  const res = wallet.initiateSpend('0xOwner', payee, 1500n);
  assert.equal(res.status, TransferState.PENDING);
  assert.equal(res.reason, 'ExceedsLimit');
});

test('SPEC 4: Guardian approval threshold (m-of-n) transitions state to APPROVED', () => {
  const wallet = new GuardianWalletModel('0xOwner', ['0xG1', '0xG2', '0xG3'], 2);
  const res = wallet.initiateSpend('0xOwner', '0xUnknown', 500n);
  const id = res.transferId;

  // First guardian approves
  let state = wallet.approveQueuedTransfer('0xG1', id);
  assert.equal(state, TransferState.PENDING);

  // Second guardian approves -> threshold met!
  state = wallet.approveQueuedTransfer('0xG2', id);
  assert.equal(state, TransferState.APPROVED);
});

test('SPEC 5: Guardian double-voting is rejected', () => {
  const wallet = new GuardianWalletModel('0xOwner', ['0xG1', '0xG2'], 2);
  const res = wallet.initiateSpend('0xOwner', '0xUnknown', 500n);
  const id = res.transferId;

  wallet.approveQueuedTransfer('0xG1', id);
  assert.throws(() => {
    wallet.approveQueuedTransfer('0xG1', id);
  }, /AlreadyApprovedByGuardian/);
});

test('SPEC 6: Timelock enforcement - Execution reverts before executeAfter', () => {
  const wallet = new GuardianWalletModel('0xOwner', ['0xG1', '0xG2'], 2);
  const res = wallet.initiateSpend('0xOwner', '0xUnknown', 500n);
  const id = res.transferId;

  wallet.approveQueuedTransfer('0xG1', id);
  wallet.approveQueuedTransfer('0xG2', id);

  // Attempt execution immediately before timelock elapses
  assert.throws(() => {
    wallet.executeTransfer('0xKeeper', id);
  }, /TimelockNotElapsed/);

  // Fast forward time past timelock (3600 seconds)
  wallet.currentTime += 3601;
  const executed = wallet.executeTransfer('0xKeeper', id);
  assert.equal(executed, true);
});

test('SPEC 7: Replay protection - Double execution reverts with AlreadyExecuted', () => {
  const wallet = new GuardianWalletModel('0xOwner', ['0xG1', '0xG2'], 2);
  const res = wallet.initiateSpend('0xOwner', '0xUnknown', 500n);
  const id = res.transferId;

  wallet.approveQueuedTransfer('0xG1', id);
  wallet.approveQueuedTransfer('0xG2', id);
  wallet.currentTime += 3601;

  wallet.executeTransfer('0xKeeper', id);

  // Attempt second execution
  assert.throws(() => {
    wallet.executeTransfer('0xKeeper', id);
  }, /AlreadyExecuted/);
});

test('SPEC 8: Cancellation by owner or any single guardian cancels queued transfer', () => {
  const wallet = new GuardianWalletModel('0xOwner', ['0xG1', '0xG2'], 2);
  const res = wallet.initiateSpend('0xOwner', '0xUnknown', 500n);
  const id = res.transferId;

  // Single guardian cancels
  const state = wallet.cancelQueuedTransfer('0xG1', id);
  assert.equal(state, TransferState.CANCELLED);

  // Attempting to execute reverts
  wallet.currentTime += 3601;
  assert.throws(() => {
    wallet.executeTransfer('0xKeeper', id);
  }, /TransferCancelled/);
});

test('SPEC 9: Panic freeze halts all outgoing operations', () => {
  const wallet = new GuardianWalletModel('0xOwner', ['0xG1', '0xG2'], 2);
  const payee = '0xTrustedStore';
  wallet.registerPayee('0xOwner', payee, TrustTier.TRUSTED);
  wallet.currentTime += 86401;

  // Guardian triggers emergency freeze
  wallet.setFreeze('0xG1', true);

  // Owner cannot spend while frozen
  assert.throws(() => {
    wallet.initiateSpend('0xOwner', payee, 100n);
  }, /AccountIsFrozen/);
});

test('SPEC 10: Guardians have no direct spending privilege', () => {
  const wallet = new GuardianWalletModel('0xOwner', ['0xG1'], 1);
  assert.throws(() => {
    wallet.initiateSpend('0xG1', '0xAnyPayee', 100n);
  }, /OnlyOwnerCanInitiateSpend/);
});

test('SPEC 11: Newly added payee cooldown period treats address as UNKNOWN', () => {
  const wallet = new GuardianWalletModel('0xOwner', ['0xG1'], 1);
  const attackerAddress = '0xScammerAddress';

  // Owner tricked into adding attacker address
  wallet.registerPayee('0xOwner', attackerAddress, TrustTier.TRUSTED);

  // Immediate spend attempt within 24h cooldown
  const res = wallet.initiateSpend('0xOwner', attackerAddress, 200n);
  assert.equal(res.status, TransferState.PENDING);
  assert.equal(res.reason, 'UnknownPayee');
});

test('SPEC 12: Sentinel agent least-privilege (can hold, cannot approve)', () => {
  const wallet = new GuardianWalletModel('0xOwner', ['0xG1', '0xG2'], 2);
  const sentinel = '0xSentinelAgent';
  wallet.registerSentinel('0xOwner', sentinel);

  const res = wallet.initiateSpend('0xOwner', '0xPhishingSite', 800n);
  const id = res.transferId;

  // Sentinel agent holds transfer
  wallet.holdBySentinel(sentinel, id, 'Scam pattern detected');
  assert.equal(wallet.transfers.get(id).sentinelHold, true);

  // Sentinel tries to approve -> rejected (not a guardian)
  assert.throws(() => {
    wallet.approveQueuedTransfer(sentinel, id);
  }, /OnlyGuardian/);

  // Even if guardians approve, sentinelHold prevents execution until cleared
  wallet.approveQueuedTransfer('0xG1', id);
  wallet.approveQueuedTransfer('0xG2', id);
  wallet.currentTime += 3601;

  assert.throws(() => {
    wallet.executeTransfer('0xKeeper', id);
  }, /HeldBySentinel/);
});

test('SPEC 13: Kid session key enforces weekly allowance cap', () => {
  const wallet = new GuardianWalletModel('0xOwner', ['0xG1'], 1);
  const kidKey = '0xKidKey';
  const schoolCafeteria = '0xCafeteria';

  wallet.authorizeSessionKey('0xOwner', kidKey, 50n, 86400 * 7, [schoolCafeteria]);

  // First spend: 30 tUSD8 (success)
  const res1 = wallet.executeViaSessionKey(kidKey, schoolCafeteria, 30n);
  assert.equal(res1.status, TransferState.EXECUTED);

  // Second spend: 25 tUSD8 (30 + 25 = 55 > 50 -> reverts)
  assert.throws(() => {
    wallet.executeViaSessionKey(kidKey, schoolCafeteria, 25n);
  }, /ExceedsSessionCap/);
});

test('SPEC 14: Kid session key enforces allowed-payees whitelist', () => {
  const wallet = new GuardianWalletModel('0xOwner', ['0xG1'], 1);
  const kidKey = '0xKidKey';
  const schoolCafeteria = '0xCafeteria';
  const arcade = '0xArcade';

  wallet.authorizeSessionKey('0xOwner', kidKey, 50n, 86400 * 7, [schoolCafeteria]);

  // Unauthorized payee reverts
  assert.throws(() => {
    wallet.executeViaSessionKey(kidKey, arcade, 10n);
  }, /PayeeNotAllowedForSession/);
});

test('SPEC 15: Kid session key revocation & expiry', () => {
  const wallet = new GuardianWalletModel('0xOwner', ['0xG1'], 1);
  const kidKey = '0xKidKey';
  const bookstore = '0xBookstore';

  wallet.authorizeSessionKey('0xOwner', kidKey, 50n, 3600, [bookstore]);

  // Guardian revokes session key
  wallet.revokeSessionKey('0xG1', kidKey);

  assert.throws(() => {
    wallet.executeViaSessionKey(kidKey, bookstore, 10n);
  }, /InvalidOrRevokedSessionKey/);
});
