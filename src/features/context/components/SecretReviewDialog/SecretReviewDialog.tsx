import type {
	SecretReviewFile,
	SecretReviewResult,
} from "@/domain/contextContracts"
import type { Locale } from "@/infra/i18n"
import { Button } from "@/shared/components/Button"
import { ShieldAlert } from "lucide-react"
import {
	type KeyboardEvent,
	useRef,
	useState,
} from "react"

interface SecretReviewDialogProps {
	review: SecretReviewResult
	locale: Locale
	onSettle: (selection: string[] | null) => void
}

export function SecretReviewDialog({ review, locale, onSettle }: SecretReviewDialogProps) {
	const [selected, setSelected] = useState<string[]>([])
	const dialogRef = useRef<HTMLElement | null>(null)
	const english = locale === "en"
	const approvable = review.files.filter(file => file.approvable)
	const selectedCount = selected.length
	const actionName = (file: SecretReviewFile) => {
		if (file.operation === "delete") {
			return english ?
				"Delete" :
				"Excluir"
		}
		if (file.operation === "create") {
			return english ?
				"Create" :
				"Criar"
		}
		return english ?
			"Replace" :
			"Substituir"
	}
	function toggle(path: string, checked: boolean): void {
		setSelected(previous => checked ?
			[...previous, path] :
			previous.filter(item => item !== path))
	}
	function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
		// A destination dialog may remain mounted behind this preflight modal.
		// Keep keyboard focus in the review rather than the underlying dialog.
		if (event.key === "Escape") {
			event.stopPropagation()
			onSettle(null)
			return
		}
		if (event.key !== "Tab" || dialogRef.current === null)
			return
		event.stopPropagation()
		const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'))
		if (focusable.length === 0)
			return
		const first = focusable[0]
		const last = focusable.at(-1)
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault()
			last?.focus()
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault()
			first?.focus()
		}
	}
	return (
		<div className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--overlay-background)] p-3 backdrop-blur-[1px]">
			<section
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="secret-review-title"
				className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-xl border border-[var(--border-color)] bg-[var(--background-2)] p-4 shadow-2xl"
				onKeyDown={handleKeyDown}
			>
				<div className="flex items-start gap-3">
					<ShieldAlert size={22} className="shrink-0 text-amber-500" aria-hidden="true" />
					<div>
						<h2 id="secret-review-title" className="text-sm font-bold text-[var(--font-color)]">
							{english ?
								"Review protected files" :
								"Revisar arquivos protegidos"}
						</h2>
						<p className="mt-1 text-xs leading-5 text-[var(--font-color-muted)]">
							{english ?
								"Choose which sensitive files to apply. Unselected files remain protected. Other safe changes will be applied normally." :
								"Escolha quais arquivos sensíveis deseja aplicar. Arquivos não selecionados continuam protegidos. As demais alterações seguras serão aplicadas normalmente."}
						</p>
					</div>
				</div>
				<div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border-color)] pt-3">
					<span className="text-xs text-[var(--font-color-secondary)]">
						{review.files.length} {english ?
							"protected files" :
							"arquivos protegidos"}
					</span>
					<div className="flex gap-2">
						<Button variant="secondary" onClick={() => setSelected(approvable.map(file => file.path))}>
							{english ?
								"All" :
								"Todos"}
						</Button>
						<Button variant="ghost" onClick={() => setSelected([])}>
							{english ?
								"None" :
								"Nenhum"}
						</Button>
					</div>
				</div>
				<div className="orqeto-scroll-area mt-3 min-h-0 space-y-2 overflow-y-auto">
					{review.files.map(file => (
						<label key={`${file.operation}:${file.path}`} className={`flex gap-3 rounded-lg border border-[var(--border-color)] p-3 ${file.approvable ?
							"cursor-pointer" :
							"opacity-70"}`}>
							<input
								type="checkbox"
								className="mt-1 shrink-0 accent-[var(--accent-color)]"
								checked={selected.includes(file.path)}
								disabled={!file.approvable}
								onChange={event => toggle(
									file.path,
									event.target.checked,
								)}
							/>
							<span className="min-w-0 flex-1">
								<span className="block break-all text-xs font-semibold text-[var(--font-color)]">{file.path}</span>
								<span className="mt-1 block text-xs text-[var(--font-color-muted)]">
									{actionName(file)} · {english ?
										"ZIP/source detections" :
										"Detecções na origem"}: {file.sourceDetections} · {english ?
											"Current file detections" :
											"No arquivo atual"}: {file.destinationDetections}
								</span>
								{!file.approvable && <span className="mt-1 block text-xs text-amber-500">
									{english ?
										"Mandatory protection: redacted, unreadable or oversized content." :
										"Proteção obrigatória: conteúdo redigido, ilegível ou grande demais."}
								</span>}
							</span>
						</label>
					))}
				</div>
				<p className="mt-3 text-xs leading-5 text-amber-500">
					{english ?
						"This authorization may overwrite or delete credentials. Secret values are never shown. Review the file in your editor before approving." :
						"A autorização pode sobrescrever ou excluir credenciais. Valores secretos não são exibidos. Revise o arquivo em seu editor antes de autorizar."}
				</p>
				<div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-color)] pt-3">
					<span className="text-xs text-[var(--font-color-muted)]">{selectedCount} / {review.files.length} {english ?
						"selected" :
						"selecionados"}</span>
					<div className="flex gap-2">
						<Button variant="ghost" onClick={() => onSettle(null)}>{english ?
							"Cancel ZIP" :
							"Cancelar ZIP"}</Button>
						<Button autoFocus onClick={() => onSettle(selected)}>{english ?
							"Apply selection" :
							"Aplicar seleção"}</Button>
					</div>
				</div>
			</section>
		</div>
	)
}
