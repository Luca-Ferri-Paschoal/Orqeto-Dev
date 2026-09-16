export interface PhysicalPosition {
	x: number
	y: number
}

export function containsPhysicalPosition(
	element: HTMLElement | null,
	position: PhysicalPosition,
): boolean {
	if (element === null)
		return false

	const rect = element.getBoundingClientRect()
	const scaleFactor = window.devicePixelRatio || 1

	return position.x >= rect.left * scaleFactor &&
		position.x <= rect.right * scaleFactor &&
		position.y >= rect.top * scaleFactor &&
		position.y <= rect.bottom * scaleFactor
}
