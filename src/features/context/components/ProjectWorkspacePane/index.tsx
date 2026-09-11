import type { ProjectSection } from "../../types"
import {
	type ContextWorkspacePreferences,
	useContextWorkspace,
} from "../../useContextWorkspace"
import { ApplyDropZone } from "../ApplyDropZone"
import { ContentSummary } from "../ContentSummary"
import { DropZone } from "../DropZone"
import { FolderSettings } from "../FolderSettings"
import { OverlayDestinationDialog } from "../OverlayDestinationDialog"
import { styles } from "./style"
import { cleanupNativeDrop } from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { Notice } from "@/shared/components/Notice"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import {
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react"

type DropTarget = "contextAdd" | "contextRemove" | "apply"

interface DropPosition {
	x: number
	y: number
}

interface NativeDropPayload {
	type: "enter" | "over" | "leave" | "drop"
	position?: DropPosition
	paths?: string[]
	temporaryRoot?: string | null
}

export interface ProjectWorkspaceHandle {
	addExternalContext: (paths: string[]) => Promise<void>
	removeExternalContext: (paths: string[]) => Promise<void>
	openExternalRoot: (path: string) => Promise<boolean>
	prepareForTabClose: () => Promise<boolean>
}

interface ProjectWorkspacePaneProps {
	tabId: string
	active: boolean
	interactionBlocked: boolean
	initialRootFolder: string | null
	folderSectionExpanded: boolean
	contextSectionExpanded: boolean
	applySectionExpanded: boolean
	folderPickerReferenceRoot: string | null
	preferences: ContextWorkspacePreferences
	onRootFolderChange: (rootFolder: string | null) => Promise<boolean>
	onSectionExpandedChange: (
		section: ProjectSection,
		expanded: boolean,
	) => void
	onRegister: (
		tabId: string,
		handle: ProjectWorkspaceHandle | null,
	) => void
}

const DRAG_AUTO_SCROLL_EDGE_PX = 72
const DRAG_AUTO_SCROLL_MAX_STEP_PX = 18

function getDragAutoScrollStep(position: DropPosition): number {
	const scaleFactor = window.devicePixelRatio || 1
	const clientY = position.y / scaleFactor
	const viewportHeight = window.innerHeight
	const edgeSize = Math.min(
		DRAG_AUTO_SCROLL_EDGE_PX,
		viewportHeight / 3,
	)

	if (edgeSize <= 0)
		return 0

	if (clientY < edgeSize) {
		const intensity = Math.min(
			1,
			Math.max(
				0,
				1 - clientY / edgeSize,
			),
		)

		return -Math.max(
			1,
			Math.round(DRAG_AUTO_SCROLL_MAX_STEP_PX * intensity * intensity),
		)
	}

	const bottomEdgeStart = viewportHeight - edgeSize

	if (clientY > bottomEdgeStart) {
		const intensity = Math.min(
			1,
			Math.max(
				0,
				(clientY - bottomEdgeStart) / edgeSize,
			),
		)

		return Math.max(
			1,
			Math.round(DRAG_AUTO_SCROLL_MAX_STEP_PX * intensity * intensity),
		)
	}

	return 0
}

function containsPhysicalPosition(
	element: HTMLElement | null,
	position: DropPosition,
): boolean {
	if (element === null)
		return false

	const rect = element.getBoundingClientRect()
	const scaleFactor = window.devicePixelRatio || 1
	const left = rect.left * scaleFactor
	const right = rect.right * scaleFactor
	const top = rect.top * scaleFactor
	const bottom = rect.bottom * scaleFactor

	return position.x >= left &&
		position.x <= right &&
		position.y >= top &&
		position.y <= bottom
}

export function ProjectWorkspacePane({
	tabId,
	active,
	interactionBlocked,
	initialRootFolder,
	folderSectionExpanded,
	contextSectionExpanded,
	applySectionExpanded,
	folderPickerReferenceRoot,
	preferences,
	onRootFolderChange,
	onSectionExpandedChange,
	onRegister,
}: ProjectWorkspacePaneProps) {
	const onRootFolderChangeRef = useRef(onRootFolderChange)

	useEffect(
		() => {
			onRootFolderChangeRef.current = onRootFolderChange
		},
		[onRootFolderChange],
	)

	const changeRootFolder = useCallback(
		(rootFolder: string | null) => onRootFolderChangeRef.current(rootFolder),
		[],
	)
	const workspace = useContextWorkspace({
		initialRootFolder,
		folderPickerReferenceRoot,
		preferences,
		onRootFolderChange: changeRootFolder,
	})
	const addDroppedPaths = workspace.addDroppedPaths
	const removeDroppedPaths = workspace.removeDroppedPaths
	const applyDroppedPaths = workspace.applyDroppedPaths
	const pendingOverlay = workspace.pendingOverlay
	const [dragTarget, setDragTarget] = useState<DropTarget | null>(null)
	const visibleDragTarget = active ?
		dragTarget :
		null
	const contextAddDropZoneRef = useRef<HTMLElement | null>(null)
	const contextRemoveDropZoneRef = useRef<HTMLElement | null>(null)
	const applyDropZoneRef = useRef<HTMLElement | null>(null)
	const isBusy = !workspace.isReady ||
		workspace.isProcessing ||
		workspace.isApplying
	const contextAddDropEnabled = workspace.rootFolder !== null &&
		workspace.isReady &&
		!workspace.isProcessing &&
		!workspace.isApplying &&
		workspace.contextPathFilterError === null
	const contextRemoveDropEnabled = workspace.rootFolder !== null &&
		workspace.isReady &&
		!workspace.isProcessing &&
		!workspace.isApplying &&
		workspace.contextPathFilterError === null
	const applyDropEnabled = workspace.rootFolder !== null &&
		workspace.isReady &&
		!workspace.isProcessing &&
		pendingOverlay === null

	useEffect(
		() => {
			onRegister(
				tabId,
				{
					addExternalContext: addDroppedPaths,
					removeExternalContext: removeDroppedPaths,
					openExternalRoot: path => workspace.configureRootFolder(
						path,
						translate(
							workspace.locale,
							"workspace.openedExternally",
						),
					),
					prepareForTabClose: workspace.prepareForTabClose,
				},
			)

			return () => {
				onRegister(
					tabId,
					null,
				)
			}
		},
		[
			addDroppedPaths,
			onRegister,
			removeDroppedPaths,
			tabId,
			workspace,
			workspace.configureRootFolder,
			workspace.locale,
			workspace.prepareForTabClose,
		],
	)

	useEffect(
		() => {
			if (!active)
				return

			let unlistenTauri: (() => void) | undefined
			let unlistenNative: (() => void) | undefined
			let cancelled = false
			let dragPosition: DropPosition | null = null
			let autoScrollFrame: number | null = null

			function getDropTarget(position: DropPosition): DropTarget | null {
				if (
					interactionBlocked ||
					pendingOverlay !== null
				)
					return null

				if (
					contextAddDropEnabled &&
					containsPhysicalPosition(
						contextAddDropZoneRef.current,
						position,
					)
				)
					return "contextAdd"

				if (
					contextRemoveDropEnabled &&
					containsPhysicalPosition(
						contextRemoveDropZoneRef.current,
						position,
					)
				)
					return "contextRemove"

				if (
					applyDropEnabled &&
					containsPhysicalPosition(
						applyDropZoneRef.current,
						position,
					)
				)
					return "apply"

				return null
			}

			function stopAutoScroll(): void {
				dragPosition = null

				if (autoScrollFrame !== null) {
					window.cancelAnimationFrame(autoScrollFrame)
					autoScrollFrame = null
				}
			}

			function runAutoScroll(): void {
				autoScrollFrame = null

				if (dragPosition === null)
					return

				const scrollStep = getDragAutoScrollStep(dragPosition)

				if (scrollStep === 0)
					return

				const previousScrollY = window.scrollY

				window.scrollBy(
					0,
					scrollStep,
				)
				setDragTarget(getDropTarget(dragPosition))

				if (window.scrollY !== previousScrollY)
					autoScrollFrame = window.requestAnimationFrame(runAutoScroll)
			}

			function updateAutoScroll(position: DropPosition): void {
				if (
					interactionBlocked ||
					pendingOverlay !== null ||
					(!contextAddDropEnabled && !contextRemoveDropEnabled && !applyDropEnabled)
				) {
					stopAutoScroll()
					return
				}

				dragPosition = position

				if (autoScrollFrame === null)
					autoScrollFrame = window.requestAnimationFrame(runAutoScroll)
			}

			function handleDrop(
				target: DropTarget | null,
				paths: string[],
				temporaryRoot: string | null,
			): void {
				if (target === "contextAdd") {
					void addDroppedPaths(paths)
						.finally(() => temporaryRoot === null ?
							undefined :
							cleanupNativeDrop(temporaryRoot)
								.catch(() => undefined))
					return
				}

				if (target === "contextRemove") {
					void removeDroppedPaths(paths)
						.finally(() => temporaryRoot === null ?
							undefined :
							cleanupNativeDrop(temporaryRoot)
								.catch(() => undefined))
					return
				}

				if (target === "apply") {
					void applyDroppedPaths(
						paths,
						temporaryRoot,
					)
					return
				}

				if (temporaryRoot !== null)
					void cleanupNativeDrop(temporaryRoot)
			}

			async function subscribe(): Promise<void> {
				const tauriDisposer = await getCurrentWindow().onDragDropEvent(event => {
					if (event.payload.type === "leave") {
						stopAutoScroll()
						setDragTarget(null)
						return
					}

					const target = getDropTarget(event.payload.position)

					if (
						event.payload.type === "enter" ||
						event.payload.type === "over"
					) {
						updateAutoScroll(event.payload.position)
						setDragTarget(target)
						return
					}

					stopAutoScroll()
					setDragTarget(null)
					handleDrop(
						target,
						event.payload.paths,
						null,
					)
				})
				const nativeDisposer = await listen<NativeDropPayload>(
					"native-drag-drop",
					event => {
						const payload = event.payload

						if (payload.type === "leave") {
							stopAutoScroll()
							setDragTarget(null)
							return
						}

						if (payload.position === undefined)
							return

						const target = getDropTarget(payload.position)

						if (
							payload.type === "enter" ||
							payload.type === "over"
						) {
							updateAutoScroll(payload.position)
							setDragTarget(target)
							return
						}

						stopAutoScroll()
						setDragTarget(null)
						handleDrop(
							target,
							payload.paths ?? [],
							payload.temporaryRoot ?? null,
						)
					},
				)

				if (cancelled) {
					tauriDisposer()
					nativeDisposer()
					return
				}

				unlistenTauri = tauriDisposer
				unlistenNative = nativeDisposer
			}

			void subscribe()

			return () => {
				cancelled = true
				stopAutoScroll()
				unlistenTauri?.()
				unlistenNative?.()
			}
		},
		[
			active,
			addDroppedPaths,
			applyDropEnabled,
			applyDroppedPaths,
			contextAddDropEnabled,
			contextRemoveDropEnabled,
			interactionBlocked,
			pendingOverlay,
			removeDroppedPaths,
		],
	)

	return (
		<div
			hidden={!active}
			className={styles.root}
		>
			{workspace.notice && (
				<Notice
					kind={workspace.notice.kind}
					message={workspace.notice.message}
				/>
			)}

			<section className={styles.workspaceCard}>
				<FolderSettings
					rootFolder={workspace.rootFolder}
					locale={workspace.locale}
					disabled={isBusy}
					expanded={folderSectionExpanded}
					onExpandedChange={expanded => onSectionExpandedChange(
						"folder",
						expanded,
					)}
					onSelectFolder={() => void workspace.selectRootFolder()}
					onOpenFolder={() => void workspace.openConfiguredFolder()}
					onCloseFolder={() => void workspace.closeRootFolder()}
				/>

				<ContentSummary
					files={workspace.files}
					contentSize={workspace.generatedContentSize}
					history={workspace.contextHistory}
					locale={workspace.locale}
					disabled={isBusy}
					onCopy={() => void workspace.copyGeneratedContent()}
					onDownload={() => void workspace.downloadGeneratedContent()}
					onClear={() => void workspace.clearGeneratedContent()}
					onHistoryCopy={entry => void workspace.copyContextHistory(entry)}
					onHistoryDownload={entry => void workspace.downloadContextHistory(entry)}
					onHistoryDelete={entry => void workspace.deleteContextHistory(entry)}
				/>
			</section>

			<DropZone
				addElementRef={contextAddDropZoneRef}
				removeElementRef={contextRemoveDropZoneRef}
				addEnabled={contextAddDropEnabled}
				removeEnabled={contextRemoveDropEnabled}
				isAddDragging={visibleDragTarget === "contextAdd"}
				isRemoveDragging={visibleDragTarget === "contextRemove"}
				isProcessing={workspace.isProcessing}
				locale={workspace.locale}
				filterPattern={workspace.contextPathFilter}
				filterTarget={workspace.contextFilterTarget}
				filterMode={workspace.contextFilterMode}
				filterError={workspace.contextPathFilterError}
				filterHistory={workspace.contextFilterHistory}
				pathsOnly={workspace.pathsOnly}
				detailsExpanded={contextSectionExpanded}
				onFilterPatternChange={workspace.updateContextPathFilter}
				onFilterTargetChange={workspace.updateContextFilterTarget}
				onFilterModeChange={workspace.updateContextFilterMode}
				onFilterClear={workspace.clearContextFilter}
				onPathsOnlyChange={workspace.updatePathsOnly}
				onFilterHistorySelect={workspace.selectContextFilterHistory}
				onFilterHistoryDelete={entry => void workspace.deleteContextFilterHistory(entry)}
				onDetailsExpandedChange={expanded => onSectionExpandedChange(
					"context",
					expanded,
				)}
			/>

			<ApplyDropZone
				elementRef={applyDropZoneRef}
				enabled={applyDropEnabled}
				isDragging={visibleDragTarget === "apply"}
				isApplying={workspace.isApplying}
				undoHistory={pendingOverlay === null ?
					workspace.overlayUndoHistory :
					[]}
				locale={workspace.locale}
				detailsExpanded={applySectionExpanded}
				onDetailsExpandedChange={expanded => onSectionExpandedChange(
					"apply",
					expanded,
				)}
				onUndo={steps => void workspace.undoOverlay(steps)}
			/>

			{active && pendingOverlay !== null && (
				<OverlayDestinationDialog
					key={`${pendingOverlay.queuePosition}:${pendingOverlay.paths.join("|")}`}
					pendingOverlay={pendingOverlay}
					disabled={workspace.isApplying}
					locale={workspace.locale}
					onCancel={workspace.cancelPendingOverlay}
					onConfirm={candidate => void workspace.confirmPendingOverlay(candidate)}
				/>
			)}
		</div>
	)
}
