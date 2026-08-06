import React from "react"
import type { ReactNode } from "react"

// Top-level error boundary: catches render/lifecycle exceptions anywhere below it so a single
// broken component doesn't blank the whole native window. Class component because componentDidCatch /
// getDerivedStateFromError have no hooks equivalent.
type Props = { children: ReactNode }
type State = { hasError: boolean }

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, info: unknown) {
    // Keep it simple: surface to the console for now. A real crash reporter can hook in here.
    console.error("ErrorBoundary caught an error:", error, info)
  }

  handleRetry = () => {
    this.setState({ hasError: false })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div
        role="alert"
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: 24,
          textAlign: "center",
          background: "var(--panel2, #f5f6f9)",
          color: "var(--ink, #1e2030)",
          fontFamily: '-apple-system, "Inter", "Segoe UI", system-ui, sans-serif',
        }}
      >
        <div style={{ fontSize: 32 }}>⚠️</div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Algo salió mal</div>
        <div style={{ fontSize: 13, color: "var(--muted, #7c8398)", maxWidth: 360 }}>
          Ocurrió un error inesperado en la aplicación. Podés reintentar.
        </div>
        <button
          onClick={this.handleRetry}
          style={{
            marginTop: 6,
            background: "var(--accent, #6366f1)",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            padding: "9px 18px",
            fontWeight: 600,
            fontSize: 13.5,
            cursor: "pointer",
          }}
        >
          Reintentar
        </button>
      </div>
    )
  }
}
