import {
	hasValidationExecutionTrust,
	recordValidationExecutionTrust,
} from "../../src/features/context/workspace/validationTrust.ts"
import { readProjectFile } from "./testSupport/source.mts"
import assert from "node:assert/strict"
import test from "node:test"

async function read(path: string): Promise<string> {
	return readProjectFile(path)
}

// BR-DIAG-002
void test(
	"BR-DIAG-005 execution trust and historical reapply confirmations use the in-app dialog",
	async () => {
		const [
			workspace,
			diagnosticGenerate,
			validationTrust,
			overlayBatch,
			pane,
			confirmationDialog,
		] = await Promise.all([
			read("src/features/context/useContextWorkspace.ts"),
			read("src/features/context/workspace/actions/useDiagnosticGenerateActions.ts"),
			read("src/features/context/workspace/actions/useValidationTrustActions.ts"),
			read("src/features/context/workspace/actions/useOverlayBatchActions.ts"),
			read("src/features/context/components/ProjectWorkspacePane/index.tsx"),
			read("src/features/context/components/WorkspaceConfirmationDialog/index.tsx"),
		])

		assert.doesNotMatch(
			workspace,
			/import\s*\{[^}]*\bconfirm\b[^}]*\}\s*from "@tauri-apps\/plugin-dialog"/s,
		)
		assert.match(
			overlayBatch,
			/const confirmHistoricalReapply = useCallback\([\s\S]*requestConfirmation\(\{[\s\S]*workspace\.reapplyWarningTitle/,
		)
		assert.match(
			validationTrust,
			/const requestProjectExecutionTrust = useCallback\([\s\S]*requestConfirmation\(\{[\s\S]*workspace\.diagnosticTrustTypecheckTitle/,
		)
		assert.match(
			validationTrust,
			/hasValidationExecutionTrust\([\s\S]*recordValidationExecutionTrust\(/,
		)

		const roots = new Set<string>()
		const commands = new Set<string>()
		assert.equal(
			hasValidationExecutionTrust(
				"C:/repo",
				null,
				roots,
				commands,
			),
			false,
		)
		recordValidationExecutionTrust(
			"C:/repo",
			null,
			roots,
			commands,
		)
		assert.equal(
			hasValidationExecutionTrust(
				"C:/repo",
				null,
				roots,
				commands,
			),
			true,
		)
		assert.equal(
			hasValidationExecutionTrust(
				"C:/repo",
				{ kind: "test", command: "npm test" },
				roots,
				commands,
			),
			false,
		)
		assert.match(
			diagnosticGenerate,
			/const loadDiagnosticContext = useCallback\([\s\S]*requestProjectExecutionTrust\(\s*configuredRootFolder,\s*null,\s*kind,?\s*\)/,
		)
		assert.match(
			pane,
			/requestConfirmation,[\s\S]*<WorkspaceConfirmationDialog[\s\S]*request=\{pendingConfirmation\}/,
		)
		assert.match(
			confirmationDialog,
			/<Dialog[\s\S]*aria-hidden="true"[\s\S]*request\.message[\s\S]*request\.confirmLabel/,
		)
	},
)

// BR-DIAG-004
void test(
	"BR-DIAG-004 Lint Fix and Test can cancel active execution and discard the pending report",
	async () => {
		const [
			workspace,
			desktop,
			rust,
			lib,
			ptBr,
			en,
		] = await Promise.all([
			read("src/features/context/useContextWorkspace.ts"),
			read("src/infra/desktop.ts"),
			read("src-tauri/src/diagnostics.rs"),
			read("src-tauri/src/lib.rs"),
			read("src/infra/i18n/locales/pt-BR.ts"),
			read("src/infra/i18n/locales/en.ts"),
		])

		assert.match(
			workspace,
			/type CancellableContextOperationKind =[\s\S]*"lintfix"[\s\S]*"test"/,
		)
		assert.match(
			workspace,
			/beginCancellableContextOperation\("lintfix"\)[\s\S]*runProjectValidationCommand\([\s\S]*cancellationToken\.backendOperationId/,
		)
		assert.match(
			workspace,
			/beginCancellableContextOperation\("test"\)[\s\S]*runProjectValidationCommand\([\s\S]*cancellationToken\.backendOperationId/,
		)
		assert.match(
			workspace,
			/cancelProjectValidationOperation\([\s\S]*token\.kind[\s\S]*token\.backendOperationId/,
		)
		assert.match(
			workspace,
			/setPreparedValidationCommandContexts\(current => \(\{[\s\S]*\[token\.kind\]: null/,
		)
		assert.match(
			workspace,
			/if \(!commitCancellableContextOperation\(cancellationToken\)\)[\s\S]*formatProjectValidationCommandContext/,
		)

		assert.match(
			desktop,
			/export const cancelProjectValidationOperation = \([\s\S]*"cancel_project_validation_operation"/,
		)
		assert.match(
			rust,
			/pub struct ValidationOperationState[\s\S]*fn cancel\([\s\S]*token\.store\(true, Ordering::Release\)/,
		)
		assert.match(
			rust,
			/pub fn cancel_project_validation_operation\([\s\S]*kind != "lintfix" && kind != "test"/,
		)
		assert.match(
			rust,
			/cancellation[\s\S]*process_tree::terminate_process_tree\(&mut child\)[\s\S]*was cancelled/,
		)
		assert.match(
			rust,
			/fn apply_eslint_fix_plan\([\s\S]*cancellation\.load\(Ordering::Acquire\)[\s\S]*rollback_eslint_fix_plan/,
		)
		assert.match(
			lib,
			/\.manage\(diagnostics::ValidationOperationState::new\(\)\)/,
		)
		assert.match(
			lib,
			/diagnostics::cancel_project_validation_operation/,
		)
		assert.match(
			ptBr,
			/"app\.loading\.cancel": "Cancelar"/,
		)
		assert.match(
			en,
			/"app\.loading\.cancel": "Cancel"/,
		)
	},
)
