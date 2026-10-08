import { dropTargetStyles } from "./style/dropTargets"
import { filterStyles } from "./style/filter"
import { layoutStyles } from "./style/layout"

export const styles = {
	...layoutStyles,
	...filterStyles,
	...dropTargetStyles,
} as const
