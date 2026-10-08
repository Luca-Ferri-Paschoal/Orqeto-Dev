import type { OperationOutcome } from "./operationOutcome"
import type {
	GitPatchPreview,
	OverlayDestinationCandidate,
} from "@/domain/contextContracts"

export * from "@/domain/appSettings"
export * from "@/domain/contextContracts"

export type ContextMode = "project" | "commit" | "typecheck" | "lintfix" | "eslint" | "test" | "logs" | "create"

export interface FullProjectContextSummary {
	fileCount: number
	byteCount: number
}

export interface PendingGitPatch extends GitPatchPreview {
	patchPath: string
}

export interface PendingProjectOverlay {
	paths: string[]
	sourceLabel: string
	sourceFingerprint: string
	routingFingerprint: string
	fileCount: number
	deleteCount: number
	permanentDeletePaths: string[]
	candidates: OverlayDestinationCandidate[]
	queuePosition: number
	queueTotal: number
}

export interface AppNotice {
	kind: "info" | "success" | "warning" | "error"
	message: string
	details?: string[]
	outcome?: OperationOutcome
}
