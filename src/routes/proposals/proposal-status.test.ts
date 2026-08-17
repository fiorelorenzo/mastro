import { describe, expect, test } from 'vitest';
import {
	proposalConfidenceBadge,
	proposalConfidenceTier,
	PROPOSAL_CONFIDENCE_HIGH_THRESHOLD,
	PROPOSAL_CONFIDENCE_LOW_THRESHOLD
} from './proposal-status';

describe('proposalConfidenceTier', () => {
	test('the seeded review’s own two real values land on the tiers the mockup draws them on', () => {
		expect(proposalConfidenceTier(0.9)).toBe('high');
		expect(proposalConfidenceTier(0.72)).toBe('medium');
	});

	test('boundaries are inclusive on the high side, exclusive on the low side', () => {
		expect(proposalConfidenceTier(PROPOSAL_CONFIDENCE_LOW_THRESHOLD)).toBe('medium');
		expect(proposalConfidenceTier(PROPOSAL_CONFIDENCE_LOW_THRESHOLD - 0.01)).toBe('low');
		expect(proposalConfidenceTier(PROPOSAL_CONFIDENCE_HIGH_THRESHOLD)).toBe('high');
		expect(proposalConfidenceTier(PROPOSAL_CONFIDENCE_HIGH_THRESHOLD - 0.01)).toBe('medium');
	});
});

describe('proposalConfidenceBadge', () => {
	test('every tier gets a distinct variant, never colour alone', () => {
		const variants = [
			proposalConfidenceBadge(0.95),
			proposalConfidenceBadge(0.6),
			proposalConfidenceBadge(0.2)
		].map((badge) => badge.variant);
		expect(new Set(variants).size).toBe(3);
	});

	test('a low-confidence badge is never the same variant Badge uses for "good"', () => {
		expect(proposalConfidenceBadge(0.1).variant).toBe('critical');
	});
});
