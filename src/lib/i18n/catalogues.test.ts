import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * The guard `AGENTS.md` promised and did not have.
 *
 * Paraglide does fail the build for a key that is in no catalogue at all,
 * so a typo in `m.someKey()` is caught. It does not fail for a key that is
 * in `en.json` and missing from `it.json`: it compiles the missing locale
 * to an alias of the one that exists —
 *
 *     const it_probe_key = en_probe_key;
 *
 * — and ships English to an Italian reader with `pnpm check` green.
 * Measured, not assumed, and the reason this file exists: adding a message
 * in one language is the single easiest way to ship an untranslated
 * string, and nothing else in the toolchain notices.
 */

const MESSAGES = fileURLToPath(new URL('../../../messages/', import.meta.url));

function catalogue(locale: string): Record<string, unknown> {
	const parsed = JSON.parse(readFileSync(`${MESSAGES}${locale}.json`, 'utf8')) as Record<
		string,
		unknown
	>;
	// inlang's own bookkeeping, not a message.
	delete parsed.$schema;
	return parsed;
}

const en = catalogue('en');
const it = catalogue('it');

test('every message exists in both languages', () => {
	const missingFromItalian = Object.keys(en)
		.filter((key) => !(key in it))
		.sort();
	const missingFromEnglish = Object.keys(it)
		.filter((key) => !(key in en))
		.sort();

	expect({ missingFromItalian, missingFromEnglish }).toEqual({
		missingFromItalian: [],
		missingFromEnglish: []
	});
});

test('every message is a string, so a nested object cannot hide an untranslated branch', () => {
	const notStrings = [...Object.entries(en), ...Object.entries(it)]
		.filter(([, value]) => typeof value !== 'string')
		.map(([key]) => key);

	expect(notStrings).toEqual([]);
});

/*
 * A message whose Italian is byte-identical to its English is usually
 * fine — an interpolation-only string like `{month}`, a symbol like `—`,
 * or a word that is the same in both languages (Email, IBAN, OK). It is
 * occasionally a copy-paste that was never translated, and the two cases
 * are indistinguishable to a machine.
 *
 * So this asserts the *set* rather than a count: a new identical pair has
 * to be added here deliberately, which is a decision somebody reads, and
 * the alternative — a threshold on how many are allowed — would let the
 * next untranslated string in as long as somebody else's was removed.
 */
const IDENTICAL_ON_PURPOSE = new Set([
	// Interpolation or punctuation only: there is nothing to translate.
	'client_detail_page_title',
	'contract_detail_page_title',
	'day_calendar_amount_unpriced',
	'day_calendar_heading',
	'day_calendar_more_entries',
	'day_calendar_page_title',
	'day_detail_heading',
	'day_detail_history_change',
	'day_detail_page_title',
	'invoice_form_line_days_description_range',
	'invoice_form_line_days_description_single',
	'offline_page_title',
	'proposal_detail_change_row',
	'settings_backup_ok_meta',
	'settings_practice_summary',
	// The same word in both languages.
	'alerts_settings_preferences_push_column',
	'client_form_contact_email_label',
	'client_form_notice_channel_email',
	'contract_boolean_no',
	'import_column_file',
	'invoice_form_iban_label',
	'mail_template_column_trigger',
	'mail_template_form_trigger_legend',
	'nav_import',
	'settings_health_status_ok'
]);

test('a message that reads the same in both languages is on the list of ones that should', () => {
	const identical = Object.keys(en)
		.filter((key) => typeof en[key] === 'string' && en[key] === it[key])
		.filter((key) => !IDENTICAL_ON_PURPOSE.has(key))
		.sort();

	expect(identical).toEqual([]);
});

test('the allowlist itself stays honest: every entry is still identical', () => {
	const noLongerIdentical = [...IDENTICAL_ON_PURPOSE].filter((key) => en[key] !== it[key]).sort();

	expect(noLongerIdentical).toEqual([]);
});
