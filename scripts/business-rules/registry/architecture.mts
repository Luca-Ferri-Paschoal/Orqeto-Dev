import type { BusinessRuleDefinition } from "./types.mts"

export const rules: readonly BusinessRuleDefinition[] = [
	{
		id: "BR-ARCH-001",
		description: "Production and maintenance source modules remain specialized and bounded to 300 lines so orchestration facades do not regress into giant files.",
		owner: "node",
		evidenceFile: "scripts/business-rules/architecture-size.test.mts",
		evidenceToken: "BR-ARCH-001",
	},
	{
		id: "BR-ARCH-002",
		description: "Domain and infrastructure modules remain independent of React feature/application modules so dependency direction stays stable.",
		owner: "node",
		evidenceFile: "scripts/business-rules/architecture-size.test.mts",
		evidenceToken: "BR-ARCH-002",
	},
	{
		id: "BR-ARCH-003",
		description: "Rust crate-level modules remain declared at the crate root so split implementation includes cannot change module resolution paths.",
		owner: "node",
		evidenceFile: "scripts/business-rules/architecture-size.test.mts",
		evidenceToken: "BR-ARCH-003",
	},
]
