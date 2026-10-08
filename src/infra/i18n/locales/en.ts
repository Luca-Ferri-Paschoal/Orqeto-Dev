import { apply } from "./en/apply.ts"
import { context } from "./en/context.ts"
import { core } from "./en/core.ts"
import { diagnostics } from "./en/diagnostics.ts"
import { protocol } from "./en/protocol.ts"
import { workspaceA } from "./en/workspaceA.ts"
import { workspaceB } from "./en/workspaceB.ts"
import type { ptBR } from "./pt-BR.ts"

export const en = {
	...core,
	...context,
	...apply,
	...diagnostics,
	...workspaceA,
	...workspaceB,
	...protocol,
} satisfies Record<keyof typeof ptBR, string>
