import type { AppState } from "./useAppState"
import type { useAppSettings } from "@/features/context/useAppSettings"
import { getErrorMessage } from "@/features/context/utils"
import {
	discardOverlayRecoveryState,
	getOverlayRecoveryStatus,
} from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import {
	useCallback,
	useEffect,
} from "react"

type AppSettings = ReturnType<typeof useAppSettings>

export function useAppRecovery(
	state: AppState,
	appSettings: AppSettings,
) {
	const {
		isDiscardingRecovery,
		setGlobalNotice,
		setIsDiscardingRecovery,
		setRecoveryBlocked,
	} = state

	useEffect(() => {
		if (!appSettings.isReady)
			return
		let cancelled = false
		void getOverlayRecoveryStatus()
			.then(status => {
				if (!cancelled)
					setRecoveryBlocked(status.blocked)
			})
			.catch(error => {
				if (!cancelled) {
					setGlobalNotice({
						kind: "error",
						message: getErrorMessage(
							error,
							appSettings.locale,
						),
					})
				}
			})
		return () => { cancelled = true }
	}, [
		appSettings.isReady,
		appSettings.locale,
		setGlobalNotice,
		setRecoveryBlocked,
	])

	const discardBlockedRecovery = useCallback(async (): Promise<boolean> => {
		if (isDiscardingRecovery)
			return false
		setIsDiscardingRecovery(true)
		try {
			const status = await discardOverlayRecoveryState()
			setRecoveryBlocked(status.blocked)
			if (status.blocked)
				return false
			setGlobalNotice({
				kind: "success",
				message: translate(
					appSettings.locale,
					"app.recoveryDiscardSuccess",
				),
			})
			return true
		} catch (error) {
			setGlobalNotice({
				kind: "error",
				message: getErrorMessage(
					error,
					appSettings.locale,
				),
			})
			return false
		} finally {
			setIsDiscardingRecovery(false)
		}
	}, [
		appSettings.locale,
		isDiscardingRecovery,
		setGlobalNotice,
		setIsDiscardingRecovery,
		setRecoveryBlocked,
	])

	return { discardBlockedRecovery }
}
