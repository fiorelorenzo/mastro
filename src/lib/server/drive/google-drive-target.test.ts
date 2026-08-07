import { expect, test } from 'vitest';
import { createGoogleDriveMirrorTarget } from './google-drive-target';

const config = {
	clientId: 'client-id',
	clientSecret: 'client-secret',
	refreshToken: 'refresh-token'
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

/** A fake `fetch` that answers the token endpoint, an empty folder
 * lookup (so every folder is created fresh), folder creation and the
 * upload, in call order, and records every request it saw. */
function createFakeFetch(overrides: Partial<Record<string, Response>> = {}) {
	const calls: { url: string; init: RequestInit | undefined }[] = [];
	let folderCounter = 0;

	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : input.toString();
		calls.push({ url, init });

		if (url === 'https://oauth2.googleapis.com/token') {
			return overrides.token ?? jsonResponse({ access_token: 'access-token-1', expires_in: 3600 });
		}
		if (url.startsWith('https://www.googleapis.com/drive/v3/files?q=')) {
			return overrides.list ?? jsonResponse({ files: [] });
		}
		if (url === 'https://www.googleapis.com/drive/v3/files?fields=id' && init?.method === 'POST') {
			folderCounter += 1;
			return overrides.createFolder ?? jsonResponse({ id: `folder-${folderCounter}` });
		}
		if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
			return overrides.upload ?? jsonResponse({ id: 'uploaded-file-1' });
		}
		throw new Error(`unexpected fetch to ${url}`);
	}) as typeof fetch;

	return { fetchImpl, calls };
}

test('publishing refreshes a token, creates the folder chain and uploads the file', async () => {
	const { fetchImpl, calls } = createFakeFetch();
	const target = createGoogleDriveMirrorTarget(config, fetchImpl);

	const result = await target.publish({
		documentId: 'doc-1',
		bytes: new TextEncoder().encode('a signed contract'),
		mime: 'application/pdf',
		fileName: 'contract.pdf',
		folder: { segments: ['Contracts', 'Acme SRL'] }
	});

	expect(result).toEqual({ remoteFileId: 'uploaded-file-1' });

	const tokenCall = calls.find((call) => call.url === 'https://oauth2.googleapis.com/token');
	expect(tokenCall?.init?.method).toBe('POST');
	expect(String(tokenCall?.init?.body)).toContain('grant_type=refresh_token');
	expect(String(tokenCall?.init?.body)).toContain('refresh_token=refresh-token');

	const folderCreations = calls.filter(
		(call) =>
			call.url === 'https://www.googleapis.com/drive/v3/files?fields=id' &&
			call.init?.method === 'POST'
	);
	expect(folderCreations).toHaveLength(2);
	expect(JSON.parse(String(folderCreations[0].init?.body))).toEqual({
		name: 'Contracts',
		mimeType: 'application/vnd.google-apps.folder',
		parents: ['root']
	});
	expect(JSON.parse(String(folderCreations[1].init?.body))).toEqual({
		name: 'Acme SRL',
		mimeType: 'application/vnd.google-apps.folder',
		parents: ['folder-1']
	});

	const uploadCall = calls.find((call) =>
		call.url.startsWith('https://www.googleapis.com/upload/')
	);
	expect(uploadCall?.url).toContain('uploadType=multipart');
	expect((uploadCall?.init?.headers as Record<string, string>)['Content-Type']).toMatch(
		/^multipart\/related; boundary=/
	);
});

test('an existing folder is reused instead of created again', async () => {
	const { fetchImpl, calls } = createFakeFetch({
		list: jsonResponse({ files: [{ id: 'existing-folder' }] })
	});
	const target = createGoogleDriveMirrorTarget(config, fetchImpl);

	await target.publish({
		documentId: 'doc-1',
		bytes: new TextEncoder().encode('x'),
		mime: 'text/plain',
		fileName: 'note.txt',
		folder: { segments: ['Contracts'] }
	});

	const folderCreations = calls.filter(
		(call) =>
			call.url === 'https://www.googleapis.com/drive/v3/files?fields=id' &&
			call.init?.method === 'POST'
	);
	expect(folderCreations).toHaveLength(0);
});

test('a failed token refresh surfaces as a rejected publish, not a silent no-op', async () => {
	const { fetchImpl } = createFakeFetch({
		token: new Response('invalid_grant', { status: 400 })
	});
	const target = createGoogleDriveMirrorTarget(config, fetchImpl);

	await expect(
		target.publish({
			documentId: 'doc-1',
			bytes: new TextEncoder().encode('x'),
			mime: 'text/plain',
			fileName: 'note.txt',
			folder: { segments: ['Contracts'] }
		})
	).rejects.toThrow(/Drive token refresh failed/);
});

test('every request is a write or a metadata-only lookup — nothing ever asks Drive for file content', async () => {
	const { fetchImpl, calls } = createFakeFetch();
	const target = createGoogleDriveMirrorTarget(config, fetchImpl);

	await target.publish({
		documentId: 'doc-1',
		bytes: new TextEncoder().encode('a signed contract'),
		mime: 'application/pdf',
		fileName: 'contract.pdf',
		folder: { segments: ['Contracts', 'Acme SRL'] }
	});

	for (const call of calls) {
		expect(call.url).not.toMatch(/alt=media/);
		expect(call.url).not.toMatch(/\/export/);
	}
});
