import * as m from '$lib/paraglide/messages';

/**
 * The channel values a client's notice preference can take. Mirrors the
 * `notice_channel` Postgres enum (`$lib/server/db/schema`), duplicated here
 * as a plain literal list rather than imported: this file is used from
 * `ClientForm.svelte`, a client component, and `$lib/server/db/schema`
 * cannot be bundled into client code.
 */
export const noticeChannels = [
	'email',
	'certified_mail',
	'registered_mail',
	'courier',
	'other'
] as const;

export type NoticeChannelValue = (typeof noticeChannels)[number];

/**
 * Human-readable label for a notice channel in the active locale. Shared
 * between the client list and the create/edit form so the two never drift
 * apart on wording.
 */
export function noticeChannelLabel(channel: NoticeChannelValue): string {
	switch (channel) {
		case 'email':
			return m.client_form_notice_channel_email();
		case 'certified_mail':
			return m.client_form_notice_channel_certified_mail();
		case 'registered_mail':
			return m.client_form_notice_channel_registered_mail();
		case 'courier':
			return m.client_form_notice_channel_courier();
		case 'other':
			return m.client_form_notice_channel_other();
	}
}
