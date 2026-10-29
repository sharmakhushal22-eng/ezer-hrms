// src/features/auth/LoginScreen.tsx — the website's /ess-login, step for step.
//
//   email     "Employee Sign In"   → POST /api/ess-auth/status
//   login     "Enter Password"     → POST /api/ess-auth/login
//   setpw     "Create Password"    → POST /api/ess-auth/set-password  (first time)
//   changepw  "New Password"       → POST /api/ess-auth/change-password (HR-issued temp password)
//
// Same fields, same validation order, same messages (app/ess-login/page.tsx).
// set-password returns the signed token like login does (b9d6455), so it signs in
// straight away; an older server that answers without one falls back to a login.
import * as React from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, ApiError } from '@/core/api'
import { useSession } from '@/core/session'
import { useTheme } from '@/ui/ThemeProvider'
import { elevation, F, R, S } from '@/ui/theme'
import { Button, Gap, Input, Notice, Txt } from '@/ui/primitives'
import { Logo } from '@/ui/Logo'
import { IconEye, IconEyeOff } from '@/ui/icons'

type Step = 'email' | 'login' | 'setpw' | 'changepw'
const TITLE: Record<Step, string> = { email: 'Employee Sign In', login: 'Enter Password', setpw: 'Create Password', changepw: 'New Password' }
const FAIL = 'Something went wrong. Try again.'

function EyeToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onToggle} hitSlop={8} style={{ paddingHorizontal: S.md, height: 46, justifyContent: 'center' }}
      accessibilityLabel={shown ? 'Hide password' : 'Show password'}>
      {shown ? <IconEyeOff size={18} color={C.faint} /> : <IconEye size={18} color={C.faint} />}
    </Pressable>
  )
}

function PasswordInput(p: { label: string; value: string; onChangeText: (v: string) => void; placeholder: string; autoFocus?: boolean; onSubmitEditing?: () => void }) {
  const [shown, setShown] = React.useState(false)
  return (
    <Input label={p.label} value={p.value} onChangeText={p.onChangeText} placeholder={p.placeholder} autoFocus={p.autoFocus}
      secureTextEntry={!shown} autoCapitalize="none" autoCorrect={false} textContentType="password" autoComplete="password"
      returnKeyType="go" onSubmitEditing={p.onSubmitEditing} right={<EyeToggle shown={shown} onToggle={() => setShown(v => !v)} />} />
  )
}

const msg = (e: unknown, fallback: string) => e instanceof ApiError ? (e.status === 0 ? e.message : (e.body?.error || fallback)) : FAIL

export default function LoginScreen() {
  const { C } = useTheme()
  const insets = useSafeAreaInsets()
  const { adopt, notice } = useSession()
  const [step, setStep] = React.useState<Step>('email')
  const [identifier, setIdentifier] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [newPw, setNewPw] = React.useState('')
  const [name, setName] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const id = identifier.trim()
  const first = name.split(' ')[0]
  const subtitle = {
    email: 'Sign in with your email or employee code',
    login: name ? `Welcome back, ${first} 👋` : 'Enter your password',
    setpw: name ? `Hi ${first}, create your password` : 'Create your password',
    changepw: name ? `Hi ${first}, set a new password` : 'Set a new password',
  }[step]
  const finish = (r: any) => adopt(r, id.toLowerCase())
  const back = () => { setStep('email'); setError(null); setPassword(''); setConfirm('') }

  const run = async (fn: () => Promise<void>) => {
    setError(null); setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  const checkEmail = () => run(async () => {
    if (!id) { setError('Please enter your email or employee code.'); return }
    try {
      const d = await api<{ found: boolean; name?: string; has_password?: boolean }>('/api/ess-auth/status', { method: 'POST', body: { identifier: id }, anonymous: true })
      if (!d.found) { setError('No employee found. Check your email / code or contact HR.'); return }
      setName(d.name || '')
      setStep(d.has_password ? 'login' : 'setpw')
    } catch (e) {
      // A 400 from the route still means "not found" to the person, as on the web.
      setError(e instanceof ApiError && e.status === 400 ? 'No employee found. Check your email / code or contact HR.' : msg(e, FAIL))
    }
  })

  const login = () => run(async () => {
    if (!password) { setError('Please enter your password.'); return }
    try {
      const d = await api<any>('/api/ess-auth/login', { method: 'POST', body: { identifier: id, password }, anonymous: true })
      if (d.must_change_password) { setName(d.name || name); setStep('changepw'); return }
      await finish(d)
    } catch (e) { setError(msg(e, 'Login failed.')) }
  })

  const setPw = () => run(async () => {
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    try {
      const r = await api<any>('/api/ess-auth/set-password', { method: 'POST', body: { identifier: id, password }, anonymous: true })
      const d = r?.token ? r : await api<any>('/api/ess-auth/login', { method: 'POST', body: { identifier: id, password }, anonymous: true })
      await finish(d)
    } catch (e) { setError(msg(e, 'Could not set password.')) }
  })

  const changePw = () => run(async () => {
    if (newPw.length < 6) { setError('New password must be at least 6 characters.'); return }
    if (newPw !== confirm) { setError('Passwords do not match.'); return }
    try {
      const d = await api<any>('/api/ess-auth/change-password', { method: 'POST', body: { identifier: id, current_password: password, new_password: newPw }, anonymous: true })
      await finish(d)
    } catch (e) { setError(msg(e, 'Could not change password.')) }
  })

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.canvas }} keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: S.lg, paddingTop: insets.top + S.xl, paddingBottom: insets.bottom + S.xl }}>
      <View style={{ alignItems: 'center', marginBottom: S.xl }}><Logo height={30} tagline /></View>

      <View style={{ backgroundColor: C.surface, borderRadius: R.xl, padding: S.xl, borderWidth: 1, borderColor: C.hair, ...elevation(C, 2) }}>
        {/* Two-segment progress, as on the web: the first step, then everything after it. */}
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: S.lg }}>
          {[0, 1].map(i => <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= (step === 'email' ? 0 : 1) ? C.brand : C.brandTint }} />)}
        </View>
        <Txt size={21} w={800}>{TITLE[step]}</Txt>
        <Txt size={F.body} tone="muted" style={{ marginTop: 4, marginBottom: S.lg }}>{subtitle}</Txt>

        {!!notice && step === 'email' && !error && <Notice tone="warning" style={{ marginBottom: S.md }}>{notice}</Notice>}

        {step === 'email' && (
          <>
            <Input label="Email or Employee Code" value={identifier} onChangeText={setIdentifier} placeholder="you@company.com · SRS0001"
              autoFocus autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="username" returnKeyType="next" onSubmitEditing={checkEmail} />
            <Button title={busy ? 'Checking…' : 'Continue →'} loading={busy} onPress={checkEmail} full />
          </>
        )}

        {step === 'login' && (
          <>
            <PasswordInput label="Password" value={password} onChangeText={setPassword} placeholder="Enter your password" autoFocus onSubmitEditing={login} />
            <Button title={busy ? 'Signing in…' : 'Log in →'} loading={busy} onPress={login} full />
          </>
        )}

        {step === 'setpw' && (
          <>
            <Notice tone="info" style={{ marginBottom: S.md }}>First time here? Create a password (min 6 characters) for your ESS account.</Notice>
            <PasswordInput label="New Password" value={password} onChangeText={setPassword} placeholder="At least 6 characters" autoFocus />
            <PasswordInput label="Confirm Password" value={confirm} onChangeText={setConfirm} placeholder="Re-enter password" onSubmitEditing={setPw} />
            <Button title={busy ? 'Saving…' : 'Set password & continue →'} loading={busy} onPress={setPw} full />
          </>
        )}

        {step === 'changepw' && (
          <>
            <Notice tone="warning" style={{ marginBottom: S.md }}>You logged in with a temporary password. Set your own password to continue.</Notice>
            <PasswordInput label="New Password" value={newPw} onChangeText={setNewPw} placeholder="At least 6 characters" autoFocus />
            <PasswordInput label="Confirm New Password" value={confirm} onChangeText={setConfirm} placeholder="Re-enter password" onSubmitEditing={changePw} />
            <Button title={busy ? 'Saving…' : 'Set new password & continue →'} loading={busy} onPress={changePw} full />
          </>
        )}

        {!!error && <Notice tone="critical" style={{ marginTop: S.md }}>{error}</Notice>}

        {(step === 'login' || step === 'setpw') && (
          <Pressable onPress={back} style={{ marginTop: S.lg, alignSelf: 'center', padding: 6 }}>
            <Txt size={F.small} w={600} tone="brand">Use a different email / code</Txt>
          </Pressable>
        )}
      </View>
      <Gap h={S.lg} />
      <Txt size={F.tiny} tone="faint" center>Need help? Contact your HR team.</Txt>
    </ScrollView>
  )
}
