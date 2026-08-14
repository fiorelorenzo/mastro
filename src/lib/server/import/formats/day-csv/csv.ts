// A minimal, dependency-free CSV reader for the day importer (#224). No
// package in this repo parses CSV or a spreadsheet's binary format (see
// `package.json`) and the day register's own writer
// (`server/register/csv.ts`) only ever produces RFC 4180 output, never
// reads it back — so this is the one place bytes typed in a spreadsheet
// become rows. "CSV or spreadsheet" is read as "whatever a spreadsheet
// program exports as text": RFC 4180 comma-delimited CSV, and the
// semicolon-delimited variant every spreadsheet app emits by default under
// a locale (Italian included) that uses a comma as the decimal separator,
// so a quantity typed as `1,5` still lands in one cell rather than being
// cut in half by the delimiter.
//
// Character-by-character, not line-split-then-parse: a quoted field is
// legal RFC 4180 for embedding the delimiter, a literal quote (doubled) or
// a line break, and a naive `text.split('\n')` would cut such a field in
// two.

/** Whichever of `,`/`;` appears more often in `headerLine`, outside any
 * quoted field — comma on a tie, RFC 4180's own delimiter and the more
 * common export default. A file cannot be read correctly without knowing
 * this before the first row is split, so it is inferred from the header
 * alone rather than asked of the person picking columns next. */
export function detectDelimiter(headerLine: string): ',' | ';' {
	let commas = 0;
	let semicolons = 0;
	let inQuotes = false;
	for (let i = 0; i < headerLine.length; i++) {
		const char = headerLine[i];
		if (char === '"') {
			inQuotes = !inQuotes;
		} else if (!inQuotes && char === ',') {
			commas++;
		} else if (!inQuotes && char === ';') {
			semicolons++;
		}
	}
	return semicolons > commas ? ';' : ',';
}

/**
 * Parses `text` into rows of raw string cells, RFC 4180: a field quoted
 * with `"` may contain the delimiter, a line break, or a literal `"`
 * (written doubled, `""`); `\r\n`, `\n` and a bare `\r` all end a row (a
 * spreadsheet export's line ending is never assumed). A leading UTF-8 BOM
 * — Excel writes one — is stripped first so it never becomes part of the
 * first header's name. Every physical row becomes one array entry,
 * including a genuinely blank one; the caller decides what a blank row
 * means for row numbering, since that is a policy the parser itself has
 * no opinion on.
 */
export function parseCsv(text: string, delimiter: ',' | ';' = ','): string[][] {
	const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;

	function endField(): void {
		row.push(field);
		field = '';
	}
	function endRow(): void {
		endField();
		rows.push(row);
		row = [];
	}

	let i = 0;
	while (i < source.length) {
		const char = source[i];
		if (inQuotes) {
			if (char === '"') {
				if (source[i + 1] === '"') {
					field += '"';
					i += 2;
					continue;
				}
				inQuotes = false;
				i += 1;
				continue;
			}
			field += char;
			i += 1;
			continue;
		}

		if (char === '"' && field === '') {
			inQuotes = true;
			i += 1;
			continue;
		}
		if (char === delimiter) {
			endField();
			i += 1;
			continue;
		}
		if (char === '\r' || char === '\n') {
			endRow();
			if (char === '\r' && source[i + 1] === '\n') i += 2;
			else i += 1;
			continue;
		}
		field += char;
		i += 1;
	}

	// A trailing newline leaves nothing after it — not a genuinely blank
	// final row — so the last, empty accumulator is only flushed when it
	// actually holds something (a field in progress, or cells already
	// pushed onto `row` before the final delimiter).
	if (field !== '' || row.length > 0) endRow();

	return rows;
}
