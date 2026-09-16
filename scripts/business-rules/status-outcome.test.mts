import {
	deriveOperationOutcomeStatus,
	filesApplyOutcomeFromResult,
	getRoutedApplyMessageKey,
	isContextualUndoEligible,
} from "../../src/features/context/operationOutcome.ts"
import { en } from "../../src/infra/i18n/locales/en.ts"
import { ptBR } from "../../src/infra/i18n/locales/pt-BR.ts"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

void test("BR-STATUS-001 backend result fixture maps to exact Files Apply counters and identity", () => {
	const outcome = filesApplyOutcomeFromResult(
		"C:/repo",
		{
			operationId: "files-apply:exact",
			appliedAtUnixMs: 1234,
			addedFiles: 2,
			replacedFiles: 3,
			deletedFiles: 1,
			unchangedFiles: 4,
			addedDirectories: 1,
			replacedDirectories: 2,
			deletedDirectories: 1,
			unchangedDirectories: 3,
		},
	)

	assert.equal(
		outcome.operationId,
		"files-apply:exact",
	)
	assert.equal(
		outcome.status,
		"success",
	)
	assert.deepEqual(outcome.counters, [
		{ kind: "created", files: 2, directories: 1 },
		{ kind: "edited", files: 3, directories: 2 },
		{ kind: "deleted", files: 1, directories: 1 },
		{ kind: "unchanged", files: 4, directories: 3 },
	])
	assert.deepEqual(outcome.undoReference, {
		operationId: "files-apply:exact",
		projectRoot: "C:/repo",
		appliedAtUnixMs: 1234,
	})
})

void test("BR-STATUS-002 mixed changed/unchanged/failed work is partial rather than unconditional success", () => {
	assert.equal(deriveOperationOutcomeStatus({
		changed: 2,
		unchanged: 3,
		failures: 1,
	}), "partial")
	assert.equal(deriveOperationOutcomeStatus({
		changed: 0,
		unchanged: 0,
		failures: 1,
	}), "failed")
})

void test("BR-STATUS-003 Files Apply no-op never exposes contextual Undo", () => {
	const outcome = filesApplyOutcomeFromResult(
		"C:/repo",
		{
			operationId: "files-apply:no-op",
			appliedAtUnixMs: null,
			addedFiles: 0,
			replacedFiles: 0,
			deletedFiles: 0,
			unchangedFiles: 7,
			addedDirectories: 0,
			replacedDirectories: 0,
			deletedDirectories: 0,
			unchangedDirectories: 2,
		},
	)

	assert.equal(
		outcome.status,
		"no_op",
	)
	assert.equal(
		outcome.undoReference,
		null,
	)
})

void test("BR-STATUS-004 contextual Undo requires the exact newest operation identity", () => {
	const reference = {
		operationId: "files-apply:newest",
		projectRoot: "C:/repo",
		appliedAtUnixMs: 10,
	}

	assert.equal(isContextualUndoEligible(reference, {
		operationId: "files-apply:newest",
	}), true)
	assert.equal(isContextualUndoEligible(reference, {
		operationId: "files-apply:later",
	}), false)
	assert.equal(
		isContextualUndoEligible(
			reference,
			null,
		),
		false,
	)
})

void test("BR-STATUS-005 apply folder wording is affected hierarchy and 0/1/many grammar exists in both locales", async () => {
	for (const messages of [ptBR, en]) {
		assert.ok(messages["status.affectedDirectories.one"].includes("{count}"))
		assert.ok(messages["status.affectedDirectories.other"].includes("{count}"))
		assert.notEqual(
			messages["status.affectedDirectories.one"],
			messages["status.directories.one"],
		)
		assert.notEqual(
			messages["status.affectedDirectories.other"],
			messages["status.directories.other"],
		)
	}

	assert.match(
		en["status.affectedDirectories.one"],
		/affected folder/,
	)
	assert.match(
		en["status.affectedDirectories.other"],
		/affected folders/,
	)
	assert.match(
		ptBR["status.affectedDirectories.one"],
		/pasta afetada/,
	)
	assert.match(
		ptBR["status.affectedDirectories.other"],
		/pastas afetadas/,
	)

	for (const count of [0, 1, 2]) {
		const key = count === 1 ?
			"status.affectedDirectories.one" :
			"status.affectedDirectories.other"
		assert.ok(en[key].replace(
			"{count}",
			String(count),
		).includes(String(count)))
		assert.ok(ptBR[key].replace(
			"{count}",
			String(count),
		).includes(String(count)))
	}

	const noticeSource = await readFile(
		"src/features/context/operationOutcomeNotice.ts",
		"utf8",
	)
	assert.match(
		noticeSource,
		/outcome\.operationType === "files_apply"/,
	)
	assert.match(
		noticeSource,
		/"status\.affectedDirectories\.one"/,
	)
	assert.match(
		noticeSource,
		/"status\.affectedDirectories\.other"/,
	)
})

void test("BR-STATUS-006 routed preview/decision states never use the applied-success message", () => {
	assert.equal(
		getRoutedApplyMessageKey("resolve"),
		"projectRoute.switchedResolve",
	)
	assert.equal(
		getRoutedApplyMessageKey("git_preview"),
		"projectRoute.switchedGitPreview",
	)
	assert.equal(
		getRoutedApplyMessageKey("already_applied"),
		"projectRoute.switchedAlreadyApplied",
	)
	assert.equal(
		getRoutedApplyMessageKey("applied"),
		"projectRoute.switchedApplied",
	)

	for (const messages of [ptBR, en]) {
		assert.ok(messages["projectRoute.switchedResolve"].length > 0)
		assert.ok(messages["projectRoute.switchedGitPreview"].length > 0)
		assert.ok(messages["projectRoute.switchedApplied"].length > 0)
		assert.ok(messages["status.apply.rejectedLabel"].length > 0)
		assert.ok(messages["status.apply.skippedLabel"].length > 0)
		assert.ok(messages["status.undo.restored"].length > 0)
		assert.ok(messages["status.undo.removed"].length > 0)
	}
})
