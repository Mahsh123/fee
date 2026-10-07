import { Money } from '@fee/money';
import type { GatewayRouteCandidate, GatewayRouteContext, GatewayRouteDecision } from './types';

/**
 * Gateway routing.
 *
 * Tenants choose how a payment is routed: UPI through one provider, cards
 * through another, international cards through a third. Rather than a single
 * global "active gateway", this returns an ordered plan - a primary plus
 * fallbacks - so a provider outage degrades the payment page instead of blocking
 * the collection counter.
 *
 * Selection is deterministic: the same context always produces the same plan, and
 * the reason is returned as prose so the settings screen can explain a routing
 * decision rather than leaving an administrator to guess.
 *
 * Scoring is tiered, and the tiers are deliberately far apart so a routing rule
 * can never be outvoted by an accumulation of small bonuses:
 *
 *   explicit routing rule for the method    +1000
 *   international card handling              +500
 *   explicit amount band                     +100
 *   generic support for the method           +100
 *   tenant's default gateway                  +50
 *   backup gateway                            -10
 *   priority (thousands of a point)           -(priority / 1000)
 */

const ROUTING_METHOD_SCORE = 1000;
const INTERNATIONAL_SCORE = 500;
const AMOUNT_BAND_SCORE = 100;
const METHOD_SUPPORT_SCORE = 100;
const DEFAULT_SCORE = 50;
const BACKUP_PENALTY = 10;

export interface GatewayRoutePlan {
  primary?: GatewayRouteCandidate;
  /** Ordered alternatives, tried when the primary fails in a retryable way. */
  fallbacks: GatewayRouteCandidate[];
  reason: string;
  rejected: Array<{ id: string; reason: string }>;
}

interface Scored {
  candidate: GatewayRouteCandidate;
  score: number;
  reasons: string[];
}

export function routeGateways(candidates: readonly GatewayRouteCandidate[], context: GatewayRouteContext): GatewayRoutePlan {
  const rejected: Array<{ id: string; reason: string }> = [];
  const scored: Scored[] = [];

  for (const candidate of candidates) {
    const eligibility = checkEligibility(candidate, context);
    if (!eligibility.eligible) {
      rejected.push({ id: candidate.id, reason: eligibility.reason });
      continue;
    }
    const { score, reasons } = scoreCandidate(candidate, context);
    scored.push({ candidate, score, reasons });
  }

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (left.candidate.priority !== right.candidate.priority) {
      return left.candidate.priority - right.candidate.priority;
    }
    return left.candidate.id < right.candidate.id ? -1 : 1;
  });

  if (scored.length === 0) {
    const detail =
      rejected.length > 0
        ? ` Rejected: ${rejected.map((entry) => `${entry.id} (${entry.reason})`).join('; ')}.`
        : ' No payment gateway is configured for this tenant.';
    return { fallbacks: [], reason: `No enabled gateway can process this payment.${detail}`, rejected };
  }

  const best = scored[0]!;
  return {
    primary: best.candidate,
    fallbacks: scored.slice(1).map((entry) => entry.candidate),
    reason: `Routed to ${best.candidate.provider} (${best.candidate.id}): it ${best.reasons.join(', ')}.`,
    rejected,
  };
}

export function selectGateway(
  candidates: readonly GatewayRouteCandidate[],
  context: GatewayRouteContext,
): GatewayRouteDecision {
  const plan = routeGateways(candidates, context);
  return { selected: plan.primary, reason: plan.reason, rejected: plan.rejected };
}

function checkEligibility(
  candidate: GatewayRouteCandidate,
  context: GatewayRouteContext,
): { eligible: true } | { eligible: false; reason: string } {
  if (!candidate.enabled) return { eligible: false, reason: 'gateway is disabled' };

  if (candidate.minAmount && context.amount.lessThan(candidate.minAmount)) {
    return { eligible: false, reason: `amount is below the minimum of ${candidate.minAmount.format()}` };
  }
  if (candidate.maxAmount && context.amount.greaterThan(candidate.maxAmount)) {
    return { eligible: false, reason: `amount is above the maximum of ${candidate.maxAmount.format()}` };
  }

  const methodSupported = context.methodKind ? candidate.supportedMethods.includes(context.methodKind) : false;
  const routingRuleMatches = context.methodKind
    ? (candidate.routingRules ?? []).some((rule) => rule.method === context.methodKind)
    : false;

  // A routing rule is itself a statement that this gateway handles the method,
  // so it can enable a method the generic list omits.
  if (context.methodKind && !methodSupported && !routingRuleMatches) {
    return { eligible: false, reason: `does not support ${context.methodKind}` };
  }

  if (context.isInternational && !candidate.supportedMethods.includes('INTERNATIONAL_CARD') && candidate.provider !== 'STRIPE') {
    return { eligible: false, reason: 'does not support international cards' };
  }

  return { eligible: true };
}

function scoreCandidate(
  candidate: GatewayRouteCandidate,
  context: GatewayRouteContext,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  for (const rule of candidate.routingRules ?? []) {
    if (context.methodKind && rule.method === context.methodKind) {
      score += ROUTING_METHOD_SCORE;
      reasons.push(`is configured for ${context.methodKind}`);
      if (withinAmountBand(rule, context.amount)) {
        score += AMOUNT_BAND_SCORE;
        reasons.push('matches the configured amount band for that method');
      }
      continue;
    }
    // A rule with no method is an amount-band rule that applies to any method.
    if (rule.method === undefined && withinAmountBand(rule, context.amount)) {
      score += AMOUNT_BAND_SCORE;
      reasons.push('matches the configured amount band');
    }
  }

  if (context.isInternational && candidate.provider === 'STRIPE') {
    score += INTERNATIONAL_SCORE;
    reasons.push('handles international cards');
  }

  if (context.methodKind && candidate.supportedMethods.includes(context.methodKind) && !reasons.some((r) => r.includes('is configured for'))) {
    score += METHOD_SUPPORT_SCORE;
    reasons.push(`supports ${context.methodKind}`);
  }

  if (candidate.isDefault) {
    score += DEFAULT_SCORE;
    reasons.push('is the default gateway');
  }
  if (candidate.isBackup) {
    score -= BACKUP_PENALTY;
    reasons.push('is a backup gateway');
  }

  score -= candidate.priority / 1000;

  if (reasons.length === 0 && candidate.isDefault === false && candidate.isBackup === false) {
    reasons.push('is the only enabled gateway');
  }

  return { score, reasons };
}

function withinAmountBand(rule: { upTo?: string; from?: string }, amount: Money): boolean {
  if (rule.upTo === undefined && rule.from === undefined) return false;
  if (rule.from !== undefined && amount.lessThan(Money.fromString(rule.from, amount.currency.code))) return false;
  if (rule.upTo !== undefined && amount.greaterThan(Money.fromString(rule.upTo, amount.currency.code))) return false;
  return true;
}
