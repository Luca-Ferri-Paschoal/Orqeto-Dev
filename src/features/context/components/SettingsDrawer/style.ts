import { controlStyles } from "./style/controls"
import { integrationStyles } from "./style/integration"
import { layoutStyles } from "./style/layout"

export const styles = {
	...layoutStyles,
	...controlStyles,
	...integrationStyles,
} as const
