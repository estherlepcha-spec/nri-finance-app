import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  state = { error: null, info: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { this.setState({ info }) }
  render() {
    if (this.state.error) {
      const errText = (this.state.error?.stack || String(this.state.error))
      const compStack = this.state.info?.componentStack || ''
      const copyAll = () => {
        try { navigator.clipboard.writeText('ERROR:\n' + errText + '\n\nCOMPONENT STACK:\n' + compStack) }
        catch { alert('Error details (copy manually):\n\n' + errText) }
      }
      return (
        <div style={{ padding: 24, fontFamily: 'monospace', background: '#0d1520', color: '#ef4444', minHeight: '100vh', boxSizing: 'border-box' }}>
          <h2 style={{ marginBottom: 8, fontSize: 18, color: '#f87171' }}>Runtime Error</h2>
          <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16 }}>
            Screenshot this page and share with support, or tap "Copy" to copy the error details.
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button onClick={copyAll}
              style={{ background: '#1a3050', color: '#60a5fa', border: '1px solid #254565', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              📋 Copy Error Details
            </button>
            <button onClick={() => window.location.reload()}
              style={{ background: '#1e3a5f', color: '#f0f6ff', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              🔄 Reload App
            </button>
          </div>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#0c1929', border: '1px solid #1a3050', padding: 14, borderRadius: 8, marginBottom: 12, overflowX: 'auto', color: '#fca5a5' }}>{errText}</pre>
          {compStack ? (
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, background: '#0c1929', border: '1px solid #1a3050', padding: 14, borderRadius: 8, color: '#fcd34d', overflowX: 'auto' }}>{compStack}</pre>
          ) : null}
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
