import { AuthProvider, useAuth } from './context/AuthContext'
import { Login } from './components/Login'
import { ArticlesList } from './components/ArticlesList'
import { useState, useEffect } from 'react'
import './App.css'

function AppContent() {
  const { operator, logout, isLoading } = useAuth()
  const [showSettings, setShowSettings] = useState(false)
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('theme')
    return saved === 'dark'
  })

  // Apply theme to HTML element
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light')
  }, [isDarkMode])

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-white">
        <div className="w-8 h-8 border-4 border-slate-100 border-t-primary rounded-full animate-spin"></div>
      </div>
    )
  }

  if (!operator) {
    return <Login />
  }

  return (
    <div className="h-screen flex flex-col bg-surface overflow-hidden text-primary font-sans">
      {/* MagicQC Brand Header */}
      <header className="bg-white border-b-2 border-slate-100 shrink-0 z-50 shadow-sm">
        <div className="w-full px-6 py-1 flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <img src="/MagicQC logo.png" alt="MagicQC" className="h-16 bg-white brand-logo-bg rounded-xl px-3 py-1" />
          </div>

          <div className="flex items-center gap-6">
            {/* Operator Info Card */}
            <div className="flex items-center bg-surface-teal px-4 py-2 rounded-xl border border-primary/10">
              <div className="w-8 h-8 bg-white rounded-lg border border-primary/20 flex items-center justify-center mr-3 shadow-sm">
                <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div>
                <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wider leading-none mb-1">Active Operator</p>
                <div className="flex items-baseline">
                  <p className="text-touch-sm font-bold text-primary leading-none uppercase">{operator?.full_name || 'System'}</p>
                  <span className="ml-2 text-touch-xs text-primary/70 font-medium">({operator?.employee_id})</span>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <div className="flex items-center text-touch-sm font-bold text-primary uppercase tracking-wide">
                <span className="w-3 h-3 rounded-full bg-success mr-2 shadow-sm"></span>
                Shift Active
              </div>
              <div className="h-5 w-px bg-slate-200"></div>

              {/* Settings Button */}
              <button
                onClick={() => setShowSettings(true)}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-surface-teal text-primary hover:bg-primary hover:text-white transition-all"
                title="Settings"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>

              <button
                onClick={logout}
                className="text-primary hover:text-error transition-colors flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-error/10 text-touch-sm font-bold uppercase tracking-wide"
              >
                Logout
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-hidden">
        <ArticlesList />
      </main>

      {/* Settings Popup Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-[600px] max-h-[80vh] overflow-y-auto">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <h2 className="text-touch-xl font-bold text-primary">Settings</h2>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Settings Content */}
            <div className="p-6 space-y-6">
              {/* Calibration Section */}
              <div className="bg-surface-teal rounded-xl p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h3 className="text-touch-lg font-bold text-primary">Calibration</h3>
                </div>
                <p className="text-touch-sm text-slate-500 mb-4">Calibrate the measurement system for accurate readings.</p>
                <button className="w-full py-3 bg-primary text-white font-bold rounded-xl hover:bg-primary-dark transition-colors">
                  Start Calibration
                </button>
              </div>

              {/* Display Options */}
              <div className="bg-slate-50 rounded-xl p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-secondary rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h3 className="text-touch-lg font-bold text-primary">Display Options</h3>
                </div>
                <div className="space-y-3">
                  <label className="flex items-center justify-between">
                    <span className="text-touch-sm text-slate-600">Show Tolerance Warnings</span>
                    <input type="checkbox" defaultChecked className="w-5 h-5 rounded accent-primary" />
                  </label>
                  <label className="flex items-center justify-between">
                    <span className="text-touch-sm text-slate-600">Auto-save Measurements</span>
                    <input type="checkbox" defaultChecked className="w-5 h-5 rounded accent-primary" />
                  </label>
                  <label className="flex items-center justify-between">
                    <span className="text-touch-sm text-slate-600">Sound Effects</span>
                    <input type="checkbox" className="w-5 h-5 rounded accent-primary" />
                  </label>
                </div>
              </div>

              {/* Theme */}
              <div className="bg-slate-50 rounded-xl p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-slate-600 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                    </svg>
                  </div>
                  <h3 className="text-touch-lg font-bold text-primary">Theme</h3>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setIsDarkMode(false)}
                    className={`flex-1 py-3 rounded-xl font-bold transition-all ${!isDarkMode ? 'bg-primary text-white shadow-lg' : 'bg-white border-2 border-slate-200 text-slate-600 hover:border-primary'}`}
                  >
                    ☀️ Light
                  </button>
                  <button
                    onClick={() => setIsDarkMode(true)}
                    className={`flex-1 py-3 rounded-xl font-bold transition-all ${isDarkMode ? 'bg-slate-800 text-white shadow-lg' : 'bg-slate-200 border-2 border-slate-300 text-slate-600 hover:border-slate-500'}`}
                  >
                    🌙 Dark
                  </button>
                </div>
              </div>

              {/* About */}
              <div className="text-center text-touch-sm text-slate-400">
                <p>MagicQC Operator Panel v4.0</p>
                <p>© 2026 MagicQC. All rights reserved.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App
