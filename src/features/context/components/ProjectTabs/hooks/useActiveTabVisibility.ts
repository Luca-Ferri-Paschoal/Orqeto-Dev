import {
	type MutableRefObject,
	useEffect,
} from "react"

function bindHorizontalWheelScrolling(scrollContainer: HTMLDivElement): () => void {
	function handleWheel(event: WheelEvent): void {
		const maximum = scrollContainer.scrollWidth - scrollContainer.clientWidth

		if (maximum <= 1)
			return

		event.preventDefault()
		event.stopPropagation()

		const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ?
			event.deltaY :
			event.deltaX

		if (delta !== 0) {
			scrollContainer.scrollLeft = Math.max(
				0,
				Math.min(
					maximum,
					scrollContainer.scrollLeft + delta,
				),
			)
		}
	}

	scrollContainer.addEventListener(
		"wheel",
		handleWheel,
		{ passive: false },
	)

	return () => scrollContainer.removeEventListener(
		"wheel",
		handleWheel,
	)
}

export function useActiveTabVisibility(
	activeTabId: string,
	listRef: MutableRefObject<HTMLDivElement | null>,
	tabRefs: MutableRefObject<Map<string, HTMLDivElement>>,
): void {
	useEffect(() => {
		const list = listRef.current
		const tab = tabRefs.current.get(activeTabId)

		if (list === null || tab === undefined)
			return

		const listBounds = list.getBoundingClientRect()
		const tabBounds = tab.getBoundingClientRect()
		const hiddenOnLeft = tabBounds.left - listBounds.left
		const hiddenOnRight = tabBounds.right - listBounds.right

		if (hiddenOnLeft < 0)
			list.scrollLeft += hiddenOnLeft
		else if (hiddenOnRight > 0)
			list.scrollLeft += hiddenOnRight
	}, [activeTabId, listRef, tabRefs])

	useEffect(() => {
		const scrollContainer = listRef.current

		if (scrollContainer === null)
			return

		return bindHorizontalWheelScrolling(scrollContainer)
	}, [listRef])
}
