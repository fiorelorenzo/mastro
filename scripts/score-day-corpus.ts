// #85/#244: scores the day-extraction corpus against a real model. Run by
// hand, never in CI: it needs credentials CI does not have and makes one
// network call per case.
//
//   RUNNER_AGENT_COMMAND=npx \
//   RUNNER_AGENT_ARGS='["-y","@zed-industries/claude-code-acp"]' \
//   RUNNER_AGENT_ENV="{\"CLAUDE_CODE_OAUTH_TOKEN\":\"$CLAUDE_CODE_OAUTH_TOKEN\",\"PATH\":\"$PATH\",\"HOME\":\"$HOME\"}" \
//   node --env-file-if-exists=.env scripts/score-day-corpus.ts
//
// `--env-file-if-exists=.env` is what supplies `RUNNER_DATABASE_URL`
// (`loadRunnerConfig` reads it from `process.env`, same as the runner
// proper) — without it this throws `RUNNER_DATABASE_URL is not set`
// before ever calling the model.
//
// It reports a number and the failures. A corpus run that only prints a
// pass rate hides the thing worth reading, which is what the model got
// wrong and how.
//
// #244 adds a second column to that report: whether a case ends up
// flagged for review — a day the year-rollover guard caught, or an
// overall confidence below the product's own threshold — computed with
// exactly the same `dayConfidence`/`yearRolloverFlag` a real proposal
// would go through (`day-producer.ts`), not a re-implementation of it.
// Exact-match scoring and flagging are reported separately: a flagged
// case can still be an exact match (the guard flags a correct rollover
// too), and an exact match can still be flagged.

import { readFileSync } from 'node:fs';
import {
	CONFIDENCE_NEEDS_REVIEW_THRESHOLD,
	dayConfidence,
	dayExtractionInstructions,
	parseExtractedDays,
	yearRolloverFlag,
	type AcceptedDay
} from '../src/lib/server/agent/day-extraction.ts';
import { loadRunnerConfig } from '../src/lib/server/runner/config.ts';
import { stripCodeFence } from '../src/lib/server/runner/job.ts';
import { AcpAgentModel } from '../src/lib/server/runner/model.ts';

interface Case {
	name: string;
	language: string;
	messageDate: string;
	content: string;
	expected: { date: string; quantity: number }[];
}

const corpus: Case[] = JSON.parse(
	readFileSync(
		new URL('../src/lib/server/agent/__fixtures__/day-corpus.json', import.meta.url),
		'utf8'
	)
);

const config = loadRunnerConfig(process.env);
const model = new AcpAgentModel(config.agent, config.modelTimeoutMs);

let passed = 0;
let flagged = 0;
const failures: string[] = [];
const flaggedCases: string[] = [];

for (const testCase of corpus) {
	const started = Date.now();
	try {
		const { text } = await model.call({
			instructions: dayExtractionInstructions(testCase.messageDate),
			content: testCase.content
		});
		const parsed = JSON.parse(stripCodeFence(text)) as {
			proposedFields: Record<string, unknown>;
			confidence: number;
			confidenceReason?: string;
		};
		const extracted = parseExtractedDays(parsed.proposedFields);
		const days = extracted.map((day) => ({ date: day.date, quantity: day.quantity }));

		// The same fold `writeDayProposals` applies to every accepted day: the
		// guard only ever lowers what the model itself reported.
		const accepted: AcceptedDay[] = extracted.map((day) => ({
			...day,
			flagReason: yearRolloverFlag(day.date, testCase.messageDate)
		}));
		const perDay = accepted.map((day) =>
			dayConfidence(day, parsed.confidence, parsed.confidenceReason)
		);
		const worstConfidence = perDay.length > 0 ? Math.min(...perDay.map((c) => c.confidence)) : 1;
		const reasons = [...new Set(perDay.map((c) => c.confidenceReason).filter((r) => r !== null))];
		const isFlagged =
			worstConfidence < CONFIDENCE_NEEDS_REVIEW_THRESHOLD || accepted.some((d) => d.flagReason);

		const got = JSON.stringify(days);
		const want = JSON.stringify(testCase.expected);
		const seconds = ((Date.now() - started) / 1000).toFixed(1);
		const flag = isFlagged ? `  [FLAGGED conf=${worstConfidence.toFixed(2)}]` : '';
		if (isFlagged) {
			flagged += 1;
			flaggedCases.push(
				`${testCase.name}\n    confidence ${worstConfidence.toFixed(2)}${reasons.length > 0 ? `\n    reason ${reasons.join(' | ')}` : ''}`
			);
		}

		if (got === want) {
			passed += 1;
			console.log(`PASS  ${testCase.name}  (${seconds}s)${flag}`);
		} else {
			failures.push(`${testCase.name}\n    want ${want}\n    got  ${got}`);
			console.log(`FAIL  ${testCase.name}  (${seconds}s)${flag}`);
		}
	} catch (error) {
		failures.push(`${testCase.name}\n    threw ${(error as Error).message}`);
		console.log(`ERROR ${testCase.name}`);
	}
}

console.log(`\n${passed}/${corpus.length} cases exact`);
console.log(`${flagged}/${corpus.length} cases flagged for review`);
if (failures.length > 0) console.log(`\n${failures.join('\n\n')}`);
if (flaggedCases.length > 0) console.log(`\nFlagged:\n\n${flaggedCases.join('\n\n')}`);
