import { expect, test } from 'vitest';
import { resolveDownloadContentType } from './response-content-type';

test('a document stored with mime text/html is never served as text/html', () => {
	expect(resolveDownloadContentType('text/html')).toBe('application/octet-stream');
});

test('image/svg+xml matches the image/* allowlist and passes through — safe here only because Content-Disposition: attachment forces a download rather than inline rendering', () => {
	expect(resolveDownloadContentType('image/svg+xml')).toBe('image/svg+xml');
});

test('the documented inline-safe allowlist passes through unchanged', () => {
	expect(resolveDownloadContentType('application/pdf')).toBe('application/pdf');
	expect(resolveDownloadContentType('message/rfc822')).toBe('message/rfc822');
	expect(resolveDownloadContentType('image/png')).toBe('image/png');
	expect(resolveDownloadContentType('image/jpeg')).toBe('image/jpeg');
});

test('anything outside the allowlist downgrades to application/octet-stream', () => {
	expect(resolveDownloadContentType('application/javascript')).toBe('application/octet-stream');
	expect(resolveDownloadContentType('text/plain')).toBe('application/octet-stream');
	expect(resolveDownloadContentType('application/xml')).toBe('application/octet-stream');
});

test('matching is case-insensitive, so casing alone cannot slip a type past the allowlist', () => {
	expect(resolveDownloadContentType('TEXT/HTML')).toBe('application/octet-stream');
	expect(resolveDownloadContentType('Image/PNG')).toBe('image/png');
	expect(resolveDownloadContentType('APPLICATION/PDF')).toBe('application/pdf');
});
