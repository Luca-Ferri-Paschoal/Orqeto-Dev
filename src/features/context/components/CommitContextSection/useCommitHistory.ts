import type { GitCommitSummary } from "@/domain/contextContracts"
import { getErrorMessage } from "@/features/context/utils"
import { listGitCommits } from "@/infra/desktop"
import type { Locale } from "@/infra/i18n"
import {
	useEffect,
	useRef,
	useState,
} from "react"

export function useCommitHistory(rootFolder: string, locale: Locale, active: boolean) {
	const [commits, setCommits] = useState<GitCommitSummary[]>([])
	const [fetchedCount, setFetchedCount] = useState(0)
	const [loaded, setLoaded] = useState(false)
	const [loading, setLoading] = useState(false)
	const [hasMore, setHasMore] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const epochRef = useRef(0)

	useEffect(() => {
		if (!active || loaded)
			return
		let cancelled = false
		const epoch = epochRef.current
		void listGitCommits(
			rootFolder,
			0,
		).then(page => {
			if (cancelled || epoch !== epochRef.current)
				return
			setCommits(page.commits)
			setFetchedCount(page.commits.length)
			setHasMore(page.hasMore)
			setError(null)
		}).catch((reason: unknown) => {
			if (!cancelled && epoch === epochRef.current) {
				setError(getErrorMessage(
					reason,
					locale,
				))
			}
		}).finally(() => {
			if (!cancelled && epoch === epochRef.current)
				setLoaded(true)
		})
		return () => { cancelled = true }
	}, [active, loaded, locale, rootFolder])

	async function loadMore(): Promise<void> {
		if (loading || !loaded || !hasMore)
			return
		setLoading(true)
		const epoch = epochRef.current
		try {
			const page = await listGitCommits(
				rootFolder,
				fetchedCount,
			)
			if (epoch !== epochRef.current)
				return
			setCommits(current => {
				const seen = new Set(current.map(commit => commit.hash))
				return [...current, ...page.commits.filter(commit => !seen.has(commit.hash))]
			})
			setFetchedCount(fetchedCount + page.commits.length)
			setHasMore(page.hasMore)
			setError(null)
		} catch (reason) {
			if (epoch === epochRef.current) {
				setError(getErrorMessage(
					reason,
					locale,
				))
			}
		} finally {
			if (epoch === epochRef.current)
				setLoading(false)
		}
	}

	function refresh(): void {
		if (loading)
			return
		epochRef.current += 1
		setCommits([])
		setFetchedCount(0)
		setHasMore(false)
		setError(null)
		setLoaded(false)
	}

	return { commits, error, hasMore, loaded, loading, loadMore, refresh }
}
