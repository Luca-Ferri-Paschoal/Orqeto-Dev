import { DropTargets } from "./DropTargets"
import { FilterPanel } from "./FilterPanel"
import { styles } from "./style"
import type { DropZoneProps } from "./types"
import { translate } from "@/infra/i18n"
import { CollapseToggle } from "@/shared/components/CollapseToggle"
import { CollapsibleRegion } from "@/shared/components/CollapsibleRegion"
import { FileCode2 } from "lucide-react"
import { useId } from "react"

export type { DropZoneProps } from "./types"

export function DropZone(props: DropZoneProps) {
	const embedded = props.embedded ?? false
	const showDropTargets = props.showDropTargets ?? true
	const showFilters = props.showFilters ?? true
	const detailsId = useId()
	if (embedded && !showFilters && !showDropTargets)
		return null
	const filterPanel = showFilters ?
		<FilterPanel {...props} filterId={`${detailsId}-filter`} /> :
		null
	const dropTargets = showDropTargets ?
		<DropTargets {...props} /> :
		null
	if (embedded)
		return <div className={styles.embedded}>{filterPanel}{dropTargets}</div>
	const filterSectionName = translate(
		props.locale,
		"context.filter.label",
	)
	const toggleLabel = translate(
		props.locale,
		props.detailsExpanded ?
			"section.collapse" :
			"section.expand",
		{ section: filterSectionName },
	)
	return (
		<section className={styles.container}>
			{showDropTargets && (
				<>
					<CollapseToggle controlsId={detailsId} expanded={props.detailsExpanded} label={toggleLabel} className={styles.toggleButton} onToggle={() => props.onDetailsExpandedChange(!props.detailsExpanded)} />
					<header className={styles.header}>
						<div className={styles.headerIcon}><FileCode2 size={15} strokeWidth={2} aria-hidden="true" /></div>
						<div>
							<h2 className={styles.sectionTitle}>{translate(
								props.locale,
								"context.create.title",
							)}</h2>
							<p className={styles.sectionDescription}>{translate(
								props.locale,
								"context.create.description",
							)}</p>
						</div>
					</header>
				</>
			)}
			{showDropTargets ?
				(
					<CollapsibleRegion id={detailsId} expanded={props.detailsExpanded} className={styles.collapseRegion} innerClassName={styles.collapseInner({ expanded: props.detailsExpanded })}>
						{filterPanel}
					</CollapsibleRegion>
				) :
				filterPanel}
			{dropTargets}
		</section>
	)
}
