import { useState } from 'react'
import { ArrowRight, BookOpen, LockKeyhole, Mail, UserRound } from 'lucide-react'
import { login, register, TOKEN_KEY, type LearnerUser } from './learnerApi'

export default function LearnerAuth({ onAuthenticated, onOffline }: { onAuthenticated: (token: string, user: LearnerUser) => void; onOffline?: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = mode === 'register' ? await register(email, name, password) : await login(email, password)
      localStorage.setItem(TOKEN_KEY, result.token)
      onAuthenticated(result.token, result.user)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return <main className="learner-auth">
    <section className="learner-auth-card">
      <div className="learner-auth-brand"><span><BookOpen/></span><div><b>EchoLoop</b><small>把每一次聆听，变成看得见的进步</small></div></div>
      <div className="learner-auth-tabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError('') }}>登录</button><button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError('') }}>注册</button></div>
      <form onSubmit={submit}>
        {mode === 'register' && <label><span><UserRound/>用户名</span><input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={40} autoComplete="name" placeholder="你的称呼" required/></label>}
        <label><span><Mail/>邮箱</span><input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" placeholder="name@example.com" required/></label>
        <label><span><LockKeyhole/>密码</span><input type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={8} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} placeholder="至少 8 个字符" required/></label>
        {error && <p className="learner-auth-error">{error}</p>}
        <button className="learner-auth-submit" disabled={busy}>{busy ? '请稍候…' : mode === 'register' ? '创建账户并开始学习' : '登录并继续学习'}<ArrowRight/></button>
      </form>
      {onOffline && <><div className="learner-auth-divider"><span>或</span></div><button className="learner-offline-enter" onClick={onOffline}>离线进入本机素材</button></>}
      <p className="learner-auth-note">学习记录会安全地保存在服务器，可在不同设备继续。</p>
    </section>
  </main>
}
