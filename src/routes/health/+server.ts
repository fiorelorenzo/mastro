import { json } from '@sveltejs/kit';
import { checkDatabase, checkDocumentStorage } from '$lib/server/health-checks';

/** Liveness plus two real round trips, for compose, the reverse proxy and
 * `scripts/deploy-prod.sh`'s deploy gate/rollback trigger. The checks
 * themselves live in `$lib/server/health-checks` (see its own comment for
 * why); any failing check answers 503, which `scripts/deploy-prod.sh`'s
 * existing `curl -fsS` health loop already treats as "not yet healthy"
 * with no change needed there. The healthy shape
 * (`{"status":"ok","database":"ok",...}`) is unchanged — CI
 * (`.github/workflows/ci.yml`) and `docs/deploy.md` both assert on those
 * exact two keys. */
export async function GET() {
	const [database, storage] = await Promise.all([checkDatabase(), checkDocumentStorage()]);
	const healthy = database === 'ok' && storage === 'ok';
	return json(
		{ status: healthy ? 'ok' : 'error', database, storage },
		{ status: healthy ? 200 : 503 }
	);
}
