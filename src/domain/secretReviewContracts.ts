export interface SecretReviewFile {
	path: string
	operation: "create" | "replace" | "delete"
	sourceDetections: number
	destinationDetections: number
	approvable: boolean
}

export interface SecretReviewResult {
	files: SecretReviewFile[]
	fingerprint: string
}
