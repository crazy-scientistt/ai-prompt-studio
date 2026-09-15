import React, { useState } from 'react'
import { useStore } from '../store'
import { Btn, Panel, TextInput } from './ui'
import { IconLogo } from './Icons'

/* Sign in / create account.
   Shown as the whole page whenever the deployment has a billing backend and
   nobody is signed in — the studio, models and credits all live behind it. */

export default function Auth() {
  const { signIn, signUp, toast } = useStore()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    try {
      const problem = mode === 'signin' ? await signIn(email.trim(), password) : await signUp(email.trim(), password)
      if (problem) {
        setError(problem)
        return
      }
      toast(mode === 'signin' ? 'Signed in' : 'Account created — welcome', '👋')
    } finally {
      setBusy(false)
    }
  }

  const swap = (next: 'signin' | 'signup') => {
    setMode(next)
    setError('')
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="flex items-center gap-3 mb-5 justify-center">
          <IconLogo className="w-9 h-9" />
          <div>
            <div className="text-[15px] font-bold leading-tight">AI Prompt Studio</div>
            <div className="text-[11px] text-muted leading-tight">Video → prompt kits</div>
          </div>
        </div>

        <Panel className="p-6">
          <div className="grid grid-cols-2 gap-1" role="tablist" aria-label="Sign in or create an account">
            {(['signin', 'signup'] as const).map((m) => (
              <Btn
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                variant={mode === m ? 'secondary' : 'ghost'}
                size="sm"
                className="w-full"
                onClick={() => swap(m)}
              >
                {m === 'signin' ? 'Sign in' : 'Create account'}
              </Btn>
            ))}
          </div>

          <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
            <div className="control-section glass gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold tracking-[.12em] text-muted uppercase">Email</span>
                <TextInput
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold tracking-[.12em] text-muted uppercase">Password</span>
                <TextInput
                  type="password"
                  required
                  minLength={8}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
                  className="w-full"
                />
              </label>
            </div>

            {error && (
              <p role="alert" className="text-[12.5px] text-red-300">
                {error}
              </p>
            )}

            <Btn type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </Btn>
          </form>

          <p className="mt-4 text-[11.5px] text-muted leading-relaxed">
            {mode === 'signup'
              ? 'New accounts start with a few free credits — one credit runs one full video analysis. Recompiling an analysis for another model is always free.'
              : 'Your credits, plan and saved work follow your account, on any device.'}
          </p>
        </Panel>
      </div>
    </div>
  )
}
