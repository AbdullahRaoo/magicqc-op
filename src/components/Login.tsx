import React, { useState, useRef, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'

export const Login: React.FC = () => {
    const [pin, setPin] = useState(['', '', '', ''])
    const [isShaking, setIsShaking] = useState(false)
    const [isLoggingIn, setIsLoggingIn] = useState(false)
    const [isSuccess, setIsSuccess] = useState(false)
    const inputRefs = [
        useRef<HTMLInputElement>(null),
        useRef<HTMLInputElement>(null),
        useRef<HTMLInputElement>(null),
        useRef<HTMLInputElement>(null)
    ]
    const { login, error, serviceStatus } = useAuth()

    useEffect(() => {
        // Focus first box on mount
        inputRefs[0].current?.focus()
    }, [])

    const handleChange = (index: number, value: string) => {
        if (!/^\d*$/.test(value)) return // Numeric only

        const newPin = [...pin]
        // Take only the last character if multiple are entered
        newPin[index] = value.slice(-1)
        setPin(newPin)

        // Auto-focus move next
        if (value && index < 3) {
            inputRefs[index + 1].current?.focus()
        }
    }

    const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace' && !pin[index] && index > 0) {
            // Move to previous box on backspace if current is empty
            inputRefs[index - 1].current?.focus()
        }
    }

    const handleLogin = async (e?: React.FormEvent) => {
        e?.preventDefault()
        const pinString = pin.join('')
        if (pinString.length !== 4) return

        setIsLoggingIn(true)
        const success = await login(pinString)
        setIsLoggingIn(false)

        if (!success) {
            setIsShaking(true)
            setTimeout(() => setIsShaking(false), 500)
        } else {
            setIsSuccess(true)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-white p-4 font-sans animate-fade-in overflow-hidden">
            <div className={`w-full max-w-sm card p-10 flex flex-col items-center transition-all duration-500 ${isShaking ? 'animate-shake' : ''} ${isSuccess ? 'animate-success-exit' : ''}`}>
                {/* MAGIC QC LOGO — centered, no duplicate text */}
                <div className="mb-10 flex justify-center">
                    <img src="./MagicQC logo.png" alt="MagicQC" className="h-16 w-auto object-contain" />
                </div>

                <h2 className="text-sm font-bold text-secondary uppercase tracking-widest mb-4">Operator PIN Login</h2>

                {/* Service connectivity indicator */}
                <div className="mb-6 flex items-center gap-2 text-xs font-medium">
                    {serviceStatus === 'checking' && (
                        <>
                            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></div>
                            <span className="text-amber-500">Connecting to server...</span>
                        </>
                    )}
                    {serviceStatus === 'available' && (
                        <>
                            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                            <span className="text-emerald-600">Server connected</span>
                        </>
                    )}
                    {serviceStatus === 'unavailable' && (
                        <>
                            <div className="w-2 h-2 rounded-full bg-red-500"></div>
                            <span className="text-red-500">Server unreachable — check connection</span>
                        </>
                    )}
                </div>

                <form onSubmit={handleLogin} className="w-full flex flex-col items-center">
                    {/* PIN Input Boxes */}
                    <div className="flex justify-center gap-3 mb-8">
                        {pin.map((digit, index) => (
                            <input
                                key={index}
                                ref={inputRefs[index]}
                                type="password"
                                maxLength={1}
                                inputMode="numeric"
                                value={digit}
                                onChange={(e) => handleChange(index, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(index, e)}
                                className="w-14 h-14 border-2 border-slate-200 rounded-lg text-center text-2xl font-bold text-primary bg-white focus:outline-none focus:border-accent-active focus:ring-4 focus:ring-accent-active/10 transition-all"
                                disabled={isLoggingIn || isSuccess}
                            />
                        ))}
                    </div>

                    {/* Error Message */}
                    {error && !isSuccess && (
                        <div className="mb-6 text-error text-xs font-bold flex items-center gap-2 bg-error/5 px-4 py-2 rounded border border-error/10">
                            <span className="w-1.5 h-1.5 rounded-full bg-error"></span>
                            {error}
                        </div>
                    )}

                    {/* Login Button */}
                    <button
                        type="submit"
                        disabled={pin.join('').length !== 4 || isLoggingIn || isSuccess}
                        className={`w-full btn-industrial flex items-center justify-center py-4 text-sm shadow-md transition-all duration-300 ${isSuccess
                            ? 'bg-success text-white scale-95 opacity-50'
                            : 'bg-primary text-white hover:bg-slate-800 active:scale-[0.98] disabled:bg-slate-100 disabled:text-slate-400'
                            }`}
                    >
                        {isLoggingIn ? (
                            <div className="flex items-center">
                                <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin mr-3"></div>
                                <span className="tracking-widest">VALIDATING...</span>
                            </div>
                        ) : isSuccess ? (
                            <div className="flex items-center animate-pulse">
                                <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                                <span className="tracking-widest">ACCESS GRANTED</span>
                            </div>
                        ) : (
                            <span className="tracking-widest">ENTER SYSTEM</span>
                        )}
                    </button>
                </form>

                <p className="mt-8 text-[11px] text-slate-400 font-medium tracking-tight">
                    Authorized Quality Operations Only
                </p>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-8px); }
          75% { transform: translateX(8px); }
        }
        @keyframes success-exit {
          0% { transform: scale(1); opacity: 1; }
          30% { transform: scale(1.02); opacity: 1; }
          100% { transform: scale(0.95); opacity: 0; filter: blur(10px); }
        }
        .animate-fade-in { animation: fade-in 0.6s ease-out forwards; }
        .animate-shake { animation: shake 0.2s ease-in-out infinite; animation-iteration-count: 2; }
        .animate-success-exit { animation: success-exit 0.6s ease-in-out forwards; }
      `}} />
        </div>
    )
}
