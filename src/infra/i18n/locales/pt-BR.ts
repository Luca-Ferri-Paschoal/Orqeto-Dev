import { apply } from "./ptBR/apply.ts"
import { context } from "./ptBR/context.ts"
import { core } from "./ptBR/core.ts"
import { diagnostics } from "./ptBR/diagnostics.ts"
import { protocol } from "./ptBR/protocol.ts"
import { workspaceA } from "./ptBR/workspaceA.ts"
import { workspaceB } from "./ptBR/workspaceB.ts"

export const ptBR = {
	...core,
	...context,
	...apply,
	...diagnostics,
	...workspaceA,
	...workspaceB,
	...protocol,
} as const
