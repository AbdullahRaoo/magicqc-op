import { AuthProvider, useAuth } from './context/AuthContext'
import { Login } from './components/Login'
import { ArticlesList } from './components/ArticlesList'
import { useState, useEffect } from 'react'
import './App.css'

function AppContent() {
  const { operator, logout, isLoading } = useAuth()
  const [showSettings, setShowSettings] = useState(false)
  const [isCalibrating, setIsCalibrating] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)

  // Calibration modal state
  const [showCalibrationModal, setShowCalibrationModal] = useState(false)
  const [calibrationStep, setCalibrationStep] = useState<'check' | 'input' | 'upload' | 'running' | 'success'>('check')
  const [existingCalibration, setExistingCalibration] = useState<{ calibrated: boolean, pixels_per_cm?: number, calibration_date?: string } | null>(null)
  const [distanceValue, setDistanceValue] = useState('')

  // Upload calibration state
  const [uploadedCalibration, setUploadedCalibration] = useState<{ pixels_per_cm: number, reference_length_cm: number, is_calibrated: boolean } | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)

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

  // Open calibration modal and check existing calibration
  const openCalibrationModal = async () => {
    setShowSettings(false)
    setShowCalibrationModal(true)
    setCalibrationStep('check')
    setDistanceValue('')

    // Check if calibration exists
    try {
      const result = await window.measurement.getCalibrationStatus()
      if (result.status === 'success' && result.data) {
        setExistingCalibration(result.data)
      } else {
        setExistingCalibration(null)
      }
    } catch (err) {
      console.error('[CALIBRATION] Failed to check status:', err)
      setExistingCalibration(null)
    }
  }

  // Start the actual calibration process
  const handleStartCalibration = async () => {
    try {
      setCalibrationStep('running')
      setIsCalibrating(true)
      console.log('[CALIBRATION] Starting calibration process...')

      const result = await window.measurement.startCalibration()
      if (result.status === 'success') {
        console.log('[CALIBRATION] Calibration window opened')
        // Poll for completion
        const pollInterval = setInterval(async () => {
          const statusResult = await window.measurement.getCalibrationStatus()
          if (statusResult.status === 'success' && statusResult.data?.calibrated) {
            console.log('[CALIBRATION] Calibration completed!')
            setIsCalibrating(false)
            setCalibrationStep('success')
            clearInterval(pollInterval)
          }
        }, 2000)
        // Stop polling after 5 minutes (timeout)
        setTimeout(() => {
          clearInterval(pollInterval)
          setIsCalibrating(false)
        }, 300000)
      } else {
        console.error('[CALIBRATION] Failed:', result.message)
        setIsCalibrating(false)
        setCalibrationStep('check')
      }
    } catch (err) {
      console.error('[CALIBRATION] Error:', err)
      setIsCalibrating(false)
      setCalibrationStep('check')
    }
  }

  // Handle file selection for JSON upload
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setUploadError(null)

    // Validate file type
    if (!file.name.endsWith('.json')) {
      setUploadError('Please select a JSON file')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string
        const data = JSON.parse(content)

        // Validate required fields
        if (!data.pixels_per_cm || data.pixels_per_cm <= 0) {
          setUploadError('Invalid calibration file: pixels_per_cm must be a positive number')
          return
        }

        setUploadedCalibration({
          pixels_per_cm: data.pixels_per_cm,
          reference_length_cm: data.reference_length_cm || 0,
          is_calibrated: data.is_calibrated !== false
        })
      } catch (err) {
        setUploadError('Invalid JSON file format')
      }
    }
    reader.readAsText(file)
  }

  // Upload calibration JSON to server
  const handleUploadCalibration = async () => {
    if (!uploadedCalibration) return

    try {
      setIsUploading(true)
      setUploadError(null)
      console.log('[CALIBRATION] Uploading calibration:', uploadedCalibration)

      const result = await window.measurement.uploadCalibration(uploadedCalibration)

      if (result.status === 'success') {
        console.log('[CALIBRATION] Upload successful!')
        setCalibrationStep('success')
        // Update existing calibration display
        setExistingCalibration({
          calibrated: true,
          pixels_per_cm: uploadedCalibration.pixels_per_cm,
          calibration_date: new Date().toISOString()
        })
      } else {
        setUploadError(result.message || 'Failed to upload calibration')
      }
    } catch (err) {
      console.error('[CALIBRATION] Upload error:', err)
      setUploadError('Failed to upload calibration. Please ensure the server is running.')
    } finally {
      setIsUploading(false)
    }
  }

  // Handle Python core status changes (auto-restart)
  useEffect(() => {
    if (!window.measurement?.onStatusChanged) return

    const cleanup = window.measurement.onStatusChanged((_event, data: any) => {
      if (data.status === 'reconnecting') {
        setIsReconnecting(true)
        console.warn('[SYSTEM] Python core disconnected — auto-restart initiated')
      } else if (data.status === 'connected') {
        setIsReconnecting(false)
        console.log('[SYSTEM] Python core reconnected successfully')
      }
    })

    return () => cleanup()
  }, [])

  // Clear reconnecting state when server becomes responsive again
  useEffect(() => {
    if (!isReconnecting) return

    const poll = async () => {
      try {
        const result = await window.measurement.getStatus()
        if (result.status !== 'error' && result.running !== undefined) {
          setIsReconnecting(false)
          console.log('[SYSTEM] Python core reconnected successfully')
        }
      } catch {
        // Still offline
      }
    }

    const interval = setInterval(poll, 3000)
    return () => clearInterval(interval)
  }, [isReconnecting])

  // Close calibration modal and return to main UI
  const closeCalibrationModal = () => {
    setShowCalibrationModal(false)
    setCalibrationStep('check')
    setDistanceValue('')
    setUploadedCalibration(null)
    setUploadError(null)
    setIsUploading(false)
  }

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
      <header className="bg-white border-b-2 border-slate-100 shrink-0 z-50 shadow-sm relative">
        {/* Reconnecting Banner */}
        {isReconnecting && (
          <div className="absolute top-0 left-0 right-0 bg-orange-500 text-white text-[11px] font-bold py-1 px-4 flex items-center justify-center gap-2 animate-pulse z-[60]">
            <div className="w-2 h-2 bg-white rounded-full animate-ping"></div>
            <span>RECONNECTING TO MEASUREMENT ENGINE... PLEASE WAIT</span>
          </div>
        )}

        <div className="w-full px-6 py-1 flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <img src="./MagicQC logo.png" alt="MagicQC" className="h-16 bg-white brand-logo-bg rounded-xl px-3 py-1" />
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

            <div className="flex items-center space-x-3">
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
                <button
                  onClick={openCalibrationModal}
                  className="w-full py-3 font-bold rounded-xl transition-colors bg-primary text-white hover:bg-primary-dark"
                >
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
                <p>MagicQC Operator Panel v1.2.2</p>
                <p>© 2026 MagicQC. All rights reserved.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Calibration Modal */}
      {showCalibrationModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-[550px] max-h-[85vh] overflow-y-auto">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-primary to-primary-dark rounded-t-2xl">
              <div className="flex items-center gap-3 text-white">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <h2 className="text-touch-xl font-bold">Camera Calibration</h2>
              </div>
              <button
                onClick={closeCalibrationModal}
                className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/20 text-white/80 hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content based on step */}
            <div className="p-6">
              {/* Step: Check existing calibration */}
              {calibrationStep === 'check' && (
                <div className="space-y-6">
                  {existingCalibration?.calibrated ? (
                    <>
                      <div className="bg-success/10 border-2 border-success/30 rounded-xl p-4">
                        <div className="flex items-center gap-3 mb-2">
                          <svg className="w-6 h-6 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="text-touch-lg font-bold text-success">Calibration Found</span>
                        </div>
                        <p className="text-slate-600 text-touch-sm mb-2">
                          Scale: <strong>{existingCalibration.pixels_per_cm?.toFixed(2)} px/cm</strong>
                        </p>
                        {existingCalibration.calibration_date && (
                          <p className="text-slate-400 text-touch-xs">
                            Last calibrated: {new Date(existingCalibration.calibration_date).toLocaleString()}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-4">
                        <button
                          onClick={closeCalibrationModal}
                          className="flex-1 py-3 bg-success text-white font-bold rounded-xl hover:bg-success/90 transition-colors"
                        >
                          Use Existing
                        </button>
                        <button
                          onClick={() => setCalibrationStep('upload')}
                          className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                        >
                          📁 Upload JSON
                        </button>
                        <button
                          onClick={() => setCalibrationStep('input')}
                          className="flex-1 py-3 bg-primary text-white font-bold rounded-xl hover:bg-primary-dark transition-colors"
                        >
                          📷 Run Camera
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="bg-orange-50 border-2 border-orange-200 rounded-xl p-4">
                        <div className="flex items-center gap-3 mb-2">
                          <svg className="w-6 h-6 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <span className="text-touch-lg font-bold text-orange-600">No Calibration Found</span>
                        </div>
                        <p className="text-slate-600 text-touch-sm">Please calibrate the camera before taking measurements.</p>
                      </div>

                      {/* Two options for creating calibration */}
                      <div className="space-y-3">
                        <p className="text-slate-500 text-touch-sm font-medium text-center">Choose a calibration method:</p>
                        <div className="grid grid-cols-2 gap-4">
                          <button
                            onClick={() => setCalibrationStep('upload')}
                            className="flex flex-col items-center gap-3 p-5 bg-slate-50 border-2 border-slate-200 rounded-xl hover:border-primary hover:bg-primary/5 transition-all"
                          >
                            <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center">
                              <svg className="w-7 h-7 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                              </svg>
                            </div>
                            <span className="text-touch-base font-bold text-slate-700">Upload JSON File</span>
                            <span className="text-touch-xs text-slate-500 text-center">Use an existing calibration file</span>
                          </button>

                          <button
                            onClick={() => setCalibrationStep('input')}
                            className="flex flex-col items-center gap-3 p-5 bg-slate-50 border-2 border-slate-200 rounded-xl hover:border-primary hover:bg-primary/5 transition-all"
                          >
                            <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center">
                              <svg className="w-7 h-7 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            </div>
                            <span className="text-touch-base font-bold text-slate-700">Run Camera Calibration</span>
                            <span className="text-touch-xs text-slate-500 text-center">Calibrate using live camera</span>
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Step: Upload JSON file */}
              {calibrationStep === 'upload' && (
                <div className="space-y-5">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <label className="block text-touch-base font-bold text-slate-700">
                        Select Calibration JSON File
                      </label>
                      <button
                        onClick={() => setCalibrationStep('check')}
                        className="text-touch-xs text-slate-500 hover:text-primary"
                      >
                        ← Back
                      </button>
                    </div>

                    <input
                      type="file"
                      accept=".json"
                      onChange={handleFileSelect}
                      className="w-full px-4 py-3 text-touch-base border-2 border-dashed border-slate-300 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none bg-slate-50 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-touch-sm file:font-bold file:bg-primary file:text-white hover:file:bg-primary-dark file:cursor-pointer"
                    />

                    <p className="text-touch-xs text-slate-400 mt-2">
                      File must contain: <code className="bg-slate-100 px-1 rounded">pixels_per_cm</code>,
                      <code className="bg-slate-100 px-1 rounded ml-1">reference_length_cm</code>,
                      <code className="bg-slate-100 px-1 rounded ml-1">is_calibrated</code>
                    </p>
                  </div>

                  {/* Error display */}
                  {uploadError && (
                    <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4">
                      <div className="flex items-center gap-3">
                        <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-touch-sm font-medium text-red-600">{uploadError}</span>
                      </div>
                    </div>
                  )}

                  {/* Preview parsed calibration */}
                  {uploadedCalibration && (
                    <div className="bg-success/10 border-2 border-success/30 rounded-xl p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <svg className="w-6 h-6 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-touch-base font-bold text-success">Valid Calibration File</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-touch-sm">
                        <div className="bg-white rounded-lg p-3">
                          <p className="text-slate-500 text-touch-xs mb-1">Scale Factor</p>
                          <p className="font-bold text-slate-700">{uploadedCalibration.pixels_per_cm.toFixed(2)} px/cm</p>
                        </div>
                        <div className="bg-white rounded-lg p-3">
                          <p className="text-slate-500 text-touch-xs mb-1">Reference Length</p>
                          <p className="font-bold text-slate-700">{uploadedCalibration.reference_length_cm} cm</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleUploadCalibration}
                    disabled={!uploadedCalibration || isUploading}
                    className={`w-full py-4 font-bold text-touch-lg rounded-xl transition-colors flex items-center justify-center gap-3 ${uploadedCalibration && !isUploading
                      ? 'bg-primary text-white hover:bg-primary-dark'
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      }`}
                  >
                    {isUploading ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        Uploading...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                        Upload Calibration
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Step: Input distance value */}
              {calibrationStep === 'input' && (
                <div className="space-y-5">
                  <div>
                    <label className="block text-touch-base font-bold text-slate-700 mb-2">
                      Reference Distance (cm)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="1"
                      value={distanceValue}
                      onChange={(e) => setDistanceValue(e.target.value)}
                      placeholder="e.g. 18"
                      className="w-full px-4 py-3 text-touch-lg font-bold border-2 border-slate-200 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                    />
                    <p className="text-touch-xs text-slate-400 mt-2">Enter the length of your reference object (ruler, etc.)</p>
                  </div>

                  {/* Instructions Box */}
                  <div className="bg-slate-50 rounded-xl p-4">
                    <h4 className="text-touch-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Keyboard Controls
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-touch-xs">
                      <div className="flex items-center gap-2">
                        <kbd className="px-2 py-1 bg-white border rounded font-mono">S</kbd>
                        <span className="text-slate-600">Save calibration (after 2 points)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <kbd className="px-2 py-1 bg-white border rounded font-mono">Q</kbd>
                        <span className="text-slate-600">Quit without saving</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <kbd className="px-2 py-1 bg-white border rounded font-mono">Z</kbd>
                        <span className="text-slate-600">Zoom in</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <kbd className="px-2 py-1 bg-white border rounded font-mono">X</kbd>
                        <span className="text-slate-600">Zoom out</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <kbd className="px-2 py-1 bg-white border rounded font-mono">R</kbd>
                        <span className="text-slate-600">Reset zoom</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <kbd className="px-2 py-1 bg-white border rounded font-mono">C</kbd>
                        <span className="text-slate-600">Clear points</span>
                      </div>
                    </div>
                    <p className="text-touch-xs text-primary font-medium mt-3 border-t pt-3">
                      📍 Click two points on your reference object, then press <strong>S</strong> and enter the distance.
                    </p>
                  </div>

                  <button
                    onClick={handleStartCalibration}
                    className="w-full py-4 bg-primary text-white font-bold text-touch-lg rounded-xl hover:bg-primary-dark transition-colors flex items-center justify-center gap-3"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    Open Camera Window
                  </button>
                </div>
              )}

              {/* Step: Running */}
              {calibrationStep === 'running' && (
                <div className="text-center py-8 space-y-6">
                  <div className="w-16 h-16 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto"></div>
                  <div>
                    <h3 className="text-touch-xl font-bold text-primary mb-2">Camera Window Open</h3>
                    <p className="text-touch-sm text-slate-500">Click two points on your reference object, then press <strong>S</strong> to save.</p>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-4 text-left text-touch-xs text-slate-600">
                    <p>• Left-click to place calibration points</p>
                    <p>• Right-click to remove nearest point</p>
                    <p>• Press S when 2 points are marked</p>
                    <p>• Enter distance value when prompted</p>
                  </div>
                </div>
              )}

              {/* Step: Success */}
              {calibrationStep === 'success' && (
                <div className="text-center py-8 space-y-6">
                  <div className="w-20 h-20 bg-success/10 rounded-full flex items-center justify-center mx-auto">
                    <svg className="w-10 h-10 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-touch-2xl font-bold text-success mb-2">Calibration Complete!</h3>
                    <p className="text-touch-sm text-slate-500">The camera has been calibrated successfully.</p>
                  </div>
                  <button
                    onClick={closeCalibrationModal}
                    className="w-full py-4 bg-success text-white font-bold text-touch-lg rounded-xl hover:bg-success/90 transition-colors"
                  >
                    Done
                  </button>
                </div>
              )}
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
