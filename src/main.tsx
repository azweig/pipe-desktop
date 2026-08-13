import React from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import ErrorBoundary from "./components/ErrorBoundary"
import { initI18n } from "./i18n"
import "./styles.css"

function mount() {
  createRoot(document.getElementById("root")!).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  )
}

// El diccionario se carga ANTES de montar para que la primera pintada ya salga traducida (nada de parpadeo en español).
// Si falla la carga, montamos igual: la app queda en español, que es la fuente y es legible.
initI18n().finally(mount)
