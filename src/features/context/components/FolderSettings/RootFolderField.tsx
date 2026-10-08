import { styles } from "./style"
import {
	type Locale,
	translate,
} from "@/infra/i18n"
import { Input } from "@/shared/components/Input"
import { ShieldCheck } from "lucide-react"

interface Props {
	id: string
	rootFolder: string | null
	locale: Locale
	disabled: boolean
	projectIgnoreExists: boolean | null
	onDevIgnore: () => void
}

export function RootFolderField(props: Props) {
	return (
		<Input
			id={props.id}
			label={translate(
				props.locale,
				"folder.path",
			)}
			value={props.rootFolder ?? ""}
			placeholder={translate(
				props.locale,
				"folder.none",
			)}
			className={styles.pathInput}
			suffix={props.rootFolder === null ?
				undefined :
				(
					<button
						type="button"
						className={styles.devIgnoreButton}
						disabled={props.disabled || props.projectIgnoreExists === null}
						title={translate(
							props.locale,
							props.projectIgnoreExists === null ?
								"folder.devIgnore.loading" :
								props.projectIgnoreExists ?
									"folder.devIgnore.open" :
									"folder.devIgnore.create",
						)}
						onClick={props.onDevIgnore}
					>
						<ShieldCheck size={14} strokeWidth={2} aria-hidden="true" />
						<span>{translate(
							props.locale,
							"folder.devIgnore.label",
						)}</span>
					</button>
				)}
			readOnly
		/>
	)
}
