import type { WorkspaceConfirmationRequest } from "../types"
import {
	type Locale,
	translate,
} from "@/infra/i18n"

export function requestPermanentDeletionApproval(
	locale: Locale,
	requestConfirmation: (request: WorkspaceConfirmationRequest) => Promise<boolean>,
	paths: readonly string[],
): Promise<boolean> {
	const displayedPaths = paths.slice(
		0,
		4,
	).join(", ")
	const more = Math.max(
		0,
		paths.length - 4,
	)
	return requestConfirmation({
		title: translate(
			locale,
			"workspace.permanentDeletionConfirmTitle",
		),
		message: translate(locale, "workspace.permanentDeletionConfirmMessage", {
			count: paths.length,
			paths: displayedPaths,
			more,
		}),
		confirmLabel: translate(
			locale,
			"workspace.permanentDeletionConfirmButton",
		),
		cancelLabel: translate(
			locale,
			"workspace.permanentDeletionCancelButton",
		),
	})
}
