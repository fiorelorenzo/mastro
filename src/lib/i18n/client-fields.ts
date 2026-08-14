/**
 * The client fields an invoice can be missing, in the words the client
 * form already uses for them.
 *
 * Deliberately the *same* message keys rather than a second set: a screen
 * saying "missing tax id" while the field it sends you to is labelled
 * something else is how two vocabularies for one concept start. Adding a
 * field to `CLIENT_INVOICING_FIELDS` without a case here fails the build,
 * which is the point — the exhaustive switch is the reminder.
 */
import * as m from '$lib/paraglide/messages';
import type { ClientInvoicingField } from '$lib/server/fiscal/client-invoicing-gaps';

export function clientFieldLabel(field: ClientInvoicingField): string {
	switch (field) {
		case 'taxId':
			return m.client_form_tax_id_label();
		case 'addressLine1':
			return m.client_form_address_line1_label();
		case 'addressCity':
			return m.client_form_city_label();
		case 'addressPostalCode':
			return m.client_form_postal_code_label();
	}
}
