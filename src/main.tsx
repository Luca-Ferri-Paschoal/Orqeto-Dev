import "@/styles/global.css"
import { App } from "@/App"
import { createRoot } from "react-dom/client"

const rootElement = document.getElementById("root")

if (rootElement === null)
	throw new Error("Root element was not found.")

createRoot(rootElement).render(<App />)
