// The schema barrel. One file per area under this folder (`client.ts`,
// `contract.ts`, `work-unit.ts`, ...), re-exported here so that
// `import * as schema from '$lib/server/db/schema'` sees every table and
// drizzle-kit picks them all up.
//
// Adding a table: create its own file, re-export it below, run
// `pnpm db:generate`, then hand-write the constraints the generator cannot
// express in a `pnpm db:generate:custom` migration.

export * from './alert';
export * from './approval';
export * from './auth';
export * from './backup';
export * from './ceiling';
export * from './clause-note';
export * from './client';
export * from './contract';
export * from './contract-renewal-assumption';
export * from './document';
export * from './document-mirror';
export * from './email-template';
export * from './expense';
export * from './fiscal';
export * from './inbound-thread';
export * from './invoice';
export * from './mailbox-poll-run';
export * from './proposal';
export * from './push';
export * from './rate-card';
export * from './work-unit';
