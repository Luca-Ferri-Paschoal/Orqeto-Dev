export function getGeneratedContentByteCount(content: string): number {
	return new TextEncoder().encode(content).length
}

export function formatByteSize(bytes: number): string {
	if (bytes < 1024)
		return `${bytes} B`
	const kilobytes = bytes / 1024
	if (kilobytes < 1024)
		return `${kilobytes.toFixed(1)} KB`
	return `${(kilobytes / 1024).toFixed(1)} MB`
}

export function getGeneratedContentSize(content: string): string {
	return formatByteSize(getGeneratedContentByteCount(content))
}
