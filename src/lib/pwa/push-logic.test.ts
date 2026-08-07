import { expect, test } from 'vitest';
import { pushSupportStatus } from './push-logic';

const supported = {
	hasServiceWorker: true,
	hasPushManager: true,
	hasNotification: true,
	isIos: false,
	isStandalone: false
};

test('supported when every API exists and the device is not iOS', () => {
	expect(pushSupportStatus(supported)).toBe('supported');
});

test('unsupported when any required API is missing, iOS or not', () => {
	expect(pushSupportStatus({ ...supported, hasPushManager: false })).toBe('unsupported');
	expect(pushSupportStatus({ ...supported, hasServiceWorker: false })).toBe('unsupported');
	expect(pushSupportStatus({ ...supported, hasNotification: false })).toBe('unsupported');
});

test('iOS with every API present but not installed to the home screen needs install first', () => {
	expect(pushSupportStatus({ ...supported, isIos: true, isStandalone: false })).toBe(
		'ios-needs-install'
	);
});

test('iOS installed to the home screen (standalone) is supported', () => {
	expect(pushSupportStatus({ ...supported, isIos: true, isStandalone: true })).toBe('supported');
});
