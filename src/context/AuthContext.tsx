

import React, { createContext, useContext, useState, useEffect } from 'react'
import { Operator } from '../types/database'

interface AuthContextType {
    operator: Operator | null
    isLoading: boolean
    error: string | null
    serviceStatus: 'checking' | 'available' | 'unavailable'
    login: (pin: string) => Promise<boolean>
    logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [operator, setOperator] = useState<Operator | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [serviceStatus, setServiceStatus] = useState<'checking' | 'available' | 'unavailable'>('checking')

    useEffect(() => {
        // Check for persisted session on mount
        const savedOperator = localStorage.getItem('magicqc_operator')
        if (savedOperator) {
            try {
                setOperator(JSON.parse(savedOperator))
            } catch (e) {
                localStorage.removeItem('magicqc_operator')
            }
        }
        setIsLoading(false)

        // ── Connectivity: listen for heartbeat status from main process ──
        const handleConnectivityChange = (_event: any, data: { status: string; lastCheck: string }) => {
            const s = data.status as 'connected' | 'reconnecting' | 'disconnected'
            setServiceStatus(s === 'connected' ? 'available' : s === 'reconnecting' ? 'checking' : 'unavailable')
            if (s !== 'connected') {
                setError(s === 'reconnecting' ? 'Reconnecting to server...' : 'Server unreachable')
            } else {
                setError(null) // clear error when reconnected
            }
        }

        // Subscribe to heartbeat events from main process
        let unsubscribe: (() => void) | undefined
        if (window.api?.onConnectivityChanged) {
            unsubscribe = window.api.onConnectivityChanged(handleConnectivityChange)
        }

        // Also get initial connectivity status
        window.api?.getConnectivity?.().then((data) => {
            const s = data.status
            setServiceStatus(s === 'connected' ? 'available' : s === 'reconnecting' ? 'checking' : 'unavailable')
        }).catch(() => {
            // Fallback: try ping
            window.api?.ping?.().then((result) => {
                setServiceStatus(result.success ? 'available' : 'unavailable')
            }).catch(() => setServiceStatus('unavailable'))
        })

        // ── Browser online/offline events ──
        const handleOnline = () => {
            console.log('[AUTH] Browser went online — checking API...')
            setServiceStatus('checking')
            window.api?.ping?.().then((result) => {
                setServiceStatus(result.success ? 'available' : 'checking')
            }).catch(() => setServiceStatus('checking'))
        }
        const handleOffline = () => {
            console.log('[AUTH] Browser went offline')
            setServiceStatus('unavailable')
            setError('Network connection lost')
        }
        window.addEventListener('online', handleOnline)
        window.addEventListener('offline', handleOffline)

        return () => {
            unsubscribe?.()
            window.removeEventListener('online', handleOnline)
            window.removeEventListener('offline', handleOffline)
        }
    }, [])

    const login = async (pin: string): Promise<boolean> => {
        setIsLoading(true)
        setError(null)
        try {
            const result = await window.api.verifyPin(pin)

            if (result.success && result.data) {
                const opData = result.data
                // Add a small delay for visual feedback in the UI
                await new Promise(resolve => setTimeout(resolve, 800))
                setOperator(opData as Operator)
                localStorage.setItem('magicqc_operator', JSON.stringify(opData))
                return true
            } else {
                // Pass through the detailed error from the IPC handler
                setError(result.error || 'Invalid PIN. Please contact supervisor.')
                return false
            }
        } catch (err: any) {
            setError(err?.message || 'System authentication error.')
            return false
        } finally {
            setIsLoading(false)
        }
    }

    const logout = () => {
        setOperator(null)
        localStorage.removeItem('magicqc_operator')
    }

    return (
        <AuthContext.Provider value={{ operator, isLoading, error, serviceStatus, login, logout }}>
            {children}
        </AuthContext.Provider>
    )
}

export const useAuth = () => {
    const context = useContext(AuthContext)
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider')
    }
    return context
}
