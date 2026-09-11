import { en } from "./locales/en"
import { ptBR } from "./locales/pt-BR"

export type Locale = "pt-BR" | "en"
export type TranslationKey = keyof typeof ptBR

export interface TranslationVariables {
	[key: string]: string | number
}

const messages: Record<Locale, Record<TranslationKey, string>> = {
	"pt-BR": ptBR,
	en,
}

export const localeOptions: readonly {
	value: Locale
	label: string
}[] = [
		{
			value: "pt-BR",
			label: "Português (Brasil)",
		},
		{
			value: "en",
			label: "English",
		},
	]

export function isLocale(value: string): value is Locale {
	return value === "pt-BR" || value === "en"
}

export function translate(
	locale: Locale,
	key: TranslationKey,
	variables: TranslationVariables = {},
): string {
	let result = messages[locale][key]

	for (const [name, value] of Object.entries(variables)) {
		result = result.replaceAll(
			`{${name}}`,
			String(value),
		)
	}

	return result
}

export function translateCount(
	locale: Locale,
	count: number,
	oneKey: TranslationKey,
	otherKey: TranslationKey,
	variables: TranslationVariables = {},
): string {
	return translate(
		locale,
		count === 1 ?
			oneKey :
			otherKey,
		{
			...variables,
			count,
		},
	)
}
