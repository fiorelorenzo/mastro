/**
 * Whether a form on this page is currently being submitted, for driving
 * `Button`'s own `loading` prop.
 *
 * Every mutation in this app is a plain `method="POST"` form that
 * navigates — deliberately, and stated where it matters: a submit
 * re-mounts the component with the server's own values, which is why
 * several forms can initialise local `$state` from a prop and be right
 * (`clients/ClientForm.svelte`). Nothing here changes that. The flag is
 * raised on submit and never lowered, because it does not need to be: the
 * navigation replaces the page, and a rejected submit re-renders it, which
 * resets the flag by construction.
 *
 * That is also why this is not `use:enhance`. Enhancing 46 forms to learn
 * when a submission ends would keep the component mounted across a submit
 * and turn every one of those `$state` initialisers into a stale value —
 * a real hazard, for a spinner that needs no such thing.
 *
 * `onsubmit` fires only once the browser's own validation has passed, so a
 * form the browser refuses to send never shows a spinner for a request
 * that was never made.
 */
export function submitting(): { readonly busy: boolean; onsubmit: () => void } {
	let busy = $state(false);
	return {
		get busy() {
			return busy;
		},
		onsubmit: () => {
			busy = true;
		}
	};
}
