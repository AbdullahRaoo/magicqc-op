import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Silence console in production builds — keeps DevTools clean for end users
// Errors are still logged so critical issues surface during support
if (import.meta.env.PROD) {
  const noop = () => {}
  console.log = noop
  console.debug = noop
  console.info = noop
  console.warn = noop
  // console.error is intentionally kept
}

// Error boundary to catch render crashes — shows a message instead of white screen
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, fontFamily: 'system-ui', color: '#1e293b' }}>
          <h1 style={{ color: '#dc2626' }}>Something went wrong</h1>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#64748b', fontSize: 14 }}>
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 16, padding: '8px 24px', fontSize: 16, cursor: 'pointer' }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
