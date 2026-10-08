export type BusinessRuleOwner = "node" | "rust"

export interface BusinessRuleDefinition {
	id: string
	description: string
	owner: BusinessRuleOwner
	evidenceFile: string
	evidenceToken: string
}
