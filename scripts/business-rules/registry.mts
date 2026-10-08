import { rules as architectureRules } from "./registry/architecture.mts"
import { rules as contextHistoryRules } from "./registry/context_history.mts"
import { rules as routingStatusRules } from "./registry/routing_status.mts"
import { rules as storageSafetyRules } from "./registry/storage_safety.mts"
import type { BusinessRuleDefinition } from "./registry/types.mts"
import { rules as validationUiRules } from "./registry/validation_ui.mts"

export type { BusinessRuleDefinition, BusinessRuleOwner } from "./registry/types.mts"

export const businessRules: readonly BusinessRuleDefinition[] = [
	...architectureRules,
	...contextHistoryRules,
	...storageSafetyRules,
	...routingStatusRules,
	...validationUiRules,
]
