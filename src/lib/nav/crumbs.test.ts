import { expect, test } from 'vitest';
import {
	alertsCrumbs,
	calendarCrumbs,
	clientCrumbs,
	clientsCrumbs,
	contractCrumbs,
	factLine,
	invoiceCrumbs,
	invoicesCrumbs,
	mailContractCrumbs,
	mailCrumbs,
	proposalsCrumbs
} from './crumbs';

const client = { id: 'c1', legalName: 'Acme SpA' };
const contract = { id: 'k1', clientId: 'c1', title: 'Retainer 2026', client };
const invoice = { id: 'i1', number: '2026/014' };

test('a subtitle drops the facts a record does not have', () => {
	// A contract with no notice period and an open-ended validity supplies
	// nulls, and must not render " \u00b7  \u00b7 " where the facts are missing.
	expect(factLine(['From 1 Jan 2026', null, undefined, '30 days notice'])).toBe(
		'From 1 Jan 2026 \u00b7 30 days notice'
	);
	expect(factLine([null, undefined])).toBe('');
	expect(factLine(['  ', 'tacit renewal'])).toBe('tacit renewal');
});

test('a subtitle keeps the order it was given', () => {
	expect(factLine(['a', 'b', 'c'])).toBe('a \u00b7 b \u00b7 c');
});

test('a trail names ancestors nearest last, and never the page it sits on', () => {
	// The contract page passes clientCrumbs, not contractCrumbs: its own
	// title is the contract, and a trail that repeated it would say nothing.
	expect(clientCrumbs(client).map((crumb) => crumb.href)).toEqual(['/clients', '/clients/c1']);
	expect(contractCrumbs(contract).map((crumb) => crumb.href)).toEqual([
		'/clients',
		'/clients/c1',
		'/clients/c1/contracts/k1'
	]);
});

test('a record crumb is labelled with the record it names', () => {
	expect(clientCrumbs(client).at(-1)?.label).toBe('Acme SpA');
	expect(contractCrumbs(contract).at(-1)?.label).toBe('Retainer 2026');
	expect(invoiceCrumbs(invoice).at(-1)?.label).toBe('2026/014');
});

test('a mail template trail stops at the contract', () => {
	// A template has no page of its own to link to, and its name is already
	// the heading the edit and send pages render, so it is not an ancestor.
	// The third crumb this used to carry pointed at the contract page with a
	// `?template=` suffix nothing reads, which existed only to keep the keyed
	// each block from seeing two identical hrefs.
	expect(mailContractCrumbs(contract).map((crumb) => crumb.href)).toEqual([
		'/mail',
		'/mail/contracts/k1'
	]);
});

test('no builder produces two crumbs with the same href', () => {
	// PageHeader keys the trail on href, so a duplicate is not a cosmetic
	// repeat: Svelte throws on the duplicate key during hydration and the page
	// blanks after the server's correct HTML has already painted, with an
	// empty console. It has happened twice. This pins every builder at once.
	const trails = [
		clientsCrumbs(),
		clientCrumbs(client),
		contractCrumbs(contract),
		mailCrumbs(),
		mailContractCrumbs(contract),
		invoicesCrumbs(),
		invoiceCrumbs(invoice),
		calendarCrumbs(),
		alertsCrumbs(),
		proposalsCrumbs()
	];
	for (const crumbs of trails) {
		const hrefs = crumbs.map((crumb) => crumb.href);
		expect(new Set(hrefs).size).toBe(hrefs.length);
	}
});
