import {
	type Locale,
	translate,
} from "@/infra/i18n"

export function getErrorMessage(
	error: unknown,
	locale: Locale,
): string {
	if (error instanceof Error)
		return error.message

	if (typeof error === "string") {
		if (locale === "en") {
			return translate(
				locale,
				"workspace.backendError",
			)
		}

		return error
	}

	return translate(
		locale,
		"workspace.unexpectedError",
	)
}

export function isGitPatchPath(path: string): boolean {
	const normalized = path.toLowerCase()

	return normalized.endsWith(".patch") || normalized.endsWith(".diff")
}
