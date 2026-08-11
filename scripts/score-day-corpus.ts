// #85: scores the day-extraction corpus against a real model. Run by
// hand, never in CI: it needs credentials CI does not have and makes one
// network call per case.
//
//   RUNNER_AGENT_COMMAND=npx \
//   RUNNER_AGENT_ARGS='["-y","@zed-industries/claude-code-acp"]' \
//   RUNNER_AGENT_ENV="{\"CLAUDE_CODE_OAUTH_TOKEN\":\"$CLAUDE_CODE_OAUTH_TOKEN\",\"PATH\":\"$PATH\",\"HOME\":\"$HOME\"}" \
//   node scripts/score-day-corpus.ts
//
// It reports a number and the failures. A corpus run that only prints a
// pass rate hides the thing worth reading, which is what the model got
// wrong and how.

import { readFileSync } from 'node:fs';
import {
	dayExtractionInstructions,
	parseExtractedDays
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
const failures: string[] = [];

for (const testCase of corpus) {
	const started = Date.now();
	try {
		const { text } = await model.call({
			instructions: dayExtractionInstructions(testCase.messageDate),
			content: testCase.content
		});
		const parsed = JSON.parse(stripCodeFence(text)) as { proposedFields: Record<string, unknown> };
		const days = parseExtractedDays(parsed.proposedFields).map((day) => ({
			date: day.date,
			quantity: day.quantity
		}));
		const got = JSON.stringify(days);
		const want = JSON.stringify(testCase.expected);
		const seconds = ((Date.now() - started) / 1000).toFixed(1);
		if (got === want) {
			passed += 1;
			console.log(`PASS  ${testCase.name}  (${seconds}s)`);
		} else {
			failures.push(`${testCase.name}\n    want ${want}\n    got  ${got}`);
			console.log(`FAIL  ${testCase.name}  (${seconds}s)`);
		}
	} catch (error) {
		failures.push(`${testCase.name}\n    threw ${(error as Error).message}`);
		console.log(`ERROR ${testCase.name}`);
	}
}

console.log(`\n${passed}/${corpus.length} cases exact`);
if (failures.length > 0) console.log(`\n${failures.join('\n\n')}`);
