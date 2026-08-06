// Better Auth's own tables. They live here like any other area so they go
// through the normal migration flow (see AGENTS.md). Column and field names
// follow what the Drizzle adapter expects: https://better-auth.com/docs/adapters/drizzle
//
// Every table also carries the set_updated_at trigger, hand-written into a
// custom migration since drizzle-kit cannot generate it.
import { boolean, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';

export const user = pgTable('user', {
	id: id(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('email_verified').notNull().default(false),
	image: text('image'),
	...timestamps()
});

export const session = pgTable('session', {
	id: id(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	token: text('token').notNull().unique(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	userId: uuid('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	...timestamps()
});

export const account = pgTable(
	'account',
	{
		id: id(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
		refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
		scope: text('scope'),
		// Only ever populated by the credential provider, which this instance
		// does not enable. Present because Better Auth's schema requires it.
		password: text('password'),
		...timestamps()
	},
	(table) => [unique('account_provider_account_id_unique').on(table.providerId, table.accountId)]
);

export const verification = pgTable('verification', {
	id: id(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	...timestamps()
});
