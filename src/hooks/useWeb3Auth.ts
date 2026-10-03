'use client'
import { useState, useEffect, useCallback } from 'react'
import { Web3Auth, WEB3AUTH_NETWORK } from '@web3auth/modal'
import { createUser } from '@/utils/db/actions'

const clientId = process.env.NEXT_PUBLIC_WEB3_AUTH_CLIENT_ID

if (!clientId) {
  throw new Error('Missing Web3Auth client ID. Please set NEXT_PUBLIC_WEB3_AUTH_CLIENT_ID in your environment variables.')
}

const web3auth = new Web3Auth({
  clientId,
  web3AuthNetwork: WEB3AUTH_NETWORK.SAPPHIRE_DEVNET,
})

export function useWeb3Auth() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [loading, setLoading] = useState(true)
  const [userInfo, setUserInfo] = useState<any>(null)

  useEffect(() => {
    const init = async () => {
      try {
        await web3auth.init()
        if (web3auth.connected) {
          setLoggedIn(true)
          const user = await web3auth.getUserInfo()
          setUserInfo(user)
          if (user.email) {
            localStorage.setItem('userEmail', user.email)
            try {
              await createUser(user.email, user.name || 'Anonymous User')
            } catch (error) {
              console.error('Error creating user:', error)
            }
          }
        }
      } catch (error) {
        console.error('Error initializing Web3Auth:', error)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

 const login = useCallback(async () => {
    try {
      await web3auth.connect()
      setLoggedIn(true)
      const user = await web3auth.getUserInfo()
      setUserInfo(user)
      if (user.email) {
        localStorage.setItem('userEmail', user.email)
        try {
          await createUser(user.email, user.name || 'Anonymous User')
        } catch (error) {
          console.error('Error creating user:', error)
        }
      }
      return user
    } catch (error: any) {
      // User closing the modal isn't a real error — just a cancelled login
      if (error?.message?.includes('User closed the modal')) {
        console.log('Login cancelled by user')
        return
      }
      console.error('Error during login:', error)
      // swallow other errors too, so a rejected login never bubbles up
      // as an unhandled promise rejection to whatever called login()
    }
}, [])
  const logout = useCallback(async () => {
    try {
      await web3auth.logout()
      setLoggedIn(false)
      setUserInfo(null)
      const email = localStorage.getItem('userEmail')
      if (email) sessionStorage.removeItem(`ecobot_chat_${email}`)
      localStorage.removeItem('userEmail')
    } catch (error) {
      console.error('Error during logout:', error)
    }
  }, [])

  return { web3auth, loggedIn, loading, userInfo, login, logout }
}