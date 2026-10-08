import { applyEdits } from "./edits.mts"
import path from "node:path"
import ts from "typescript"

function isSimpleJsxAttributeExpression(expression: ts.Expression): boolean {
	if (
		ts.isIdentifier(expression) ||
		ts.isPropertyAccessExpression(expression) ||
		ts.isElementAccessExpression(expression) ||
		ts.isStringLiteralLike(expression) ||
		ts.isNumericLiteral(expression) ||
		expression.kind === ts.SyntaxKind.TrueKeyword ||
		expression.kind === ts.SyntaxKind.FalseKeyword ||
		expression.kind === ts.SyntaxKind.NullKeyword ||
		expression.kind === ts.SyntaxKind.ThisKeyword
	)
		return true
	if (
		ts.isParenthesizedExpression(expression) ||
		ts.isNonNullExpression(expression) ||
		ts.isAsExpression(expression) ||
		ts.isSatisfiesExpression(expression)
	)
		return isSimpleJsxAttributeExpression(expression.expression)
	return false
}

export function formatSimpleJsxAttributeExpressions(
	fileName: string,
	source: string,
): string {
	if (path.extname(fileName) !== ".tsx")
		return source
	const sourceFile = ts.createSourceFile(
		fileName,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	)
	const edits: ts.TextChange[] = []
	function visit(node: ts.Node): void {
		if (ts.isJsxAttribute(node)) {
			const initializer = node.initializer
			if (initializer !== undefined && ts.isJsxExpression(initializer)) {
				const expression = initializer.expression
				if (expression !== undefined && isSimpleJsxAttributeExpression(expression)) {
					const initializerStart = initializer.getStart(sourceFile)
					const initializerEnd = initializer.end
					const expressionStart = expression.getStart(sourceFile)
					const expressionEnd = expression.end
					const beforeExpression = source.slice(
						initializerStart + 1,
						expressionStart,
					)
					const afterExpression = source.slice(
						expressionEnd,
						initializerEnd - 1,
					)
					const expressionText = source.slice(
						expressionStart,
						expressionEnd,
					)
					if (!expressionText.includes("\n") && /^\s*$/.test(beforeExpression) && /^\s*$/.test(afterExpression) && (beforeExpression.includes("\n") || afterExpression.includes("\n"))) {
						edits.push({
							span: { start: initializerStart, length: initializerEnd - initializerStart },
							newText: `{${expressionText}}`,
						})
					}
				}
			}
		}
		ts.forEachChild(
			node,
			visit,
		)
	}
	visit(sourceFile)
	return applyEdits(
		source,
		edits,
	)
}
