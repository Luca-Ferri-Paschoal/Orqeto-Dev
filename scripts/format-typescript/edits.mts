import type ts from "typescript"

export function applyEdits(
	source: string,
	edits: readonly ts.TextChange[],
): string {
	let formatted = source
	for (const edit of [...edits].sort((
		left,
		right,
	) => right.span.start - left.span.start)) {
		const start = edit.span.start
		const end = start + edit.span.length
		formatted = formatted.slice(
			0,
			start,
		) + edit.newText + formatted.slice(end)
	}
	return formatted
}
