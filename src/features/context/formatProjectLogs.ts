import type { Locale } from "../../domain/locale.js"

interface ProjectLogEntryForFormat {
	timestampMs: number
	stream: "stdout" | "stderr" | "system"
	message: string
}

function timestamp(locale: Locale, value: number): string {
	return new Intl.DateTimeFormat(
		locale,
		{
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		},
	).format(new Date(value))
}

export function formatProjectLogs(
	locale: Locale,
	command: string,
	startedAtMs: number | null,
	entries: ProjectLogEntryForFormat[],
	truncated: boolean,
): string {
	const heading = locale === "pt-BR" ?
		"Logs do projeto" :
		"Project logs"
	const commandLabel = locale === "pt-BR" ?
		"Comando" :
		"Command"
	const startedLabel = locale === "pt-BR" ?
		"Início" :
		"Started"
	const truncatedLabel = locale === "pt-BR" ?
		"Observação: os logs mais antigos foram descartados pelo limite de segurança." :
		"Note: older logs were discarded by the safety buffer limit."
	const endLabel = locale === "pt-BR" ?
		"FIM DOS LOGS" :
		"END LOGS"
	const lines = [
		`# ${heading}`,
		"",
		`${commandLabel}: ${command}`,
	]
	if (startedAtMs !== null) {
		lines.push(`${startedLabel}: ${timestamp(
			locale,
			startedAtMs,
		)}`)
	}
	if (truncated)
		lines.push(truncatedLabel)
	lines.push(
		"",
		"===== LOGS =====",
		"",
	)
	for (const entry of entries) {
		lines.push(`[${timestamp(
			locale,
			entry.timestampMs,
		)}] [${entry.stream.toUpperCase()}] ${entry.message}`)
	}
	lines.push(
		"",
		`===== ${endLabel} =====`,
	)
	return `${lines.join("\n")}\n`
}
