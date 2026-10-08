export type ExtensionLocale = "pt-BR" | "en"

type ExtensionMessageKey = | "appUnavailable" | "projectBusy" | "ignoreUnavailable" | "ignoreCopyUnavailable" | "deliveryFailed" | "openFailed"

const EXTENSION_MESSAGES: Record<ExtensionLocale, Record<ExtensionMessageKey, string>> = {
	"pt-BR": {
		appUnavailable: "O Orqeto Dev não está disponível para receber esta ação.",
		projectBusy: "O projeto está ocupado no Orqeto Dev. Aguarde a operação atual terminar e tente novamente.",
		ignoreUnavailable: "O Dev Ignore não está mais aberto para este projeto. Atualize o menu e tente novamente.",
		ignoreCopyUnavailable: "O Dev Ignore está aberto para este projeto. Use as ações do Dev Ignore.",
		deliveryFailed: "A ação não foi entregue porque o Orqeto Dev fechou ou parou de responder durante o envio.",
		openFailed: "Não foi possível localizar ou iniciar o Orqeto Dev.",
	},
	en: {
		appUnavailable: "Orqeto Dev is not available to receive this action.",
		projectBusy: "This project is busy in Orqeto Dev. Wait for the current operation to finish and try again.",
		ignoreUnavailable: "Dev Ignore is no longer open for this project. Refresh the menu and try again.",
		ignoreCopyUnavailable: "Dev Ignore is open for this project. Use the Dev Ignore actions.",
		deliveryFailed: "The action was not delivered because Orqeto Dev closed or stopped responding while it was being sent.",
		openFailed: "Could not locate or start Orqeto Dev.",
	},
}

export function extensionMessage(
	locale: ExtensionLocale,
	key: ExtensionMessageKey,
): string {
	return EXTENSION_MESSAGES[locale][key]
}
