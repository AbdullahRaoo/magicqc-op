

import React, { createContext, useContext, useState, useEffect } from 'react'
import { Operator } from '../types/database'

interface AuthContextType {
    operator: Operator | null
    isLoading: boolean
    error: string | null
    login: (pin: string) => Promise<boolean>
    logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [operator, setOperator] = useState<Operator | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

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
                setError(result.error || 'Invalid PIN. Please contact supervisor.')
                return false
            }
        } catch (err) {
            setError('System authentication error.')
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
        <AuthContext.Provider value={{ operator, isLoading, error, login, logout }}>
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
