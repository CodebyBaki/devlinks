// src/App.jsx
import { useState } from 'react'
import { Toaster, toast } from 'react-hot-toast'
import { Link, Copy, ExternalLink, Zap, BarChart2 } from 'lucide-react'
import { shortenUrl } from './services/api'
import './index.css'

const LINKS_STORAGE_KEY = 'devlinks:links'
const MAX_LOCAL_LINKS = 50

const loadLocalLinks = () => {
  try {
    const savedLinks = window.localStorage.getItem(LINKS_STORAGE_KEY)
    const parsedLinks = savedLinks ? JSON.parse(savedLinks) : []
    return Array.isArray(parsedLinks) ? parsedLinks : []
  } catch {
    return []
  }
}

const saveLocalLinks = (links) => {
  try {
    window.localStorage.setItem(LINKS_STORAGE_KEY, JSON.stringify(links))
  } catch {
    toast.error('Could not save this link to your browser history')
  }
}

export default function App() {
  const [url, setUrl] = useState('')
  const [links, setLinks] = useState(loadLocalLinks)
  const [loading, setLoading] = useState(false)

  const handleShorten = async (e) => {
    e.preventDefault()
    if (!url.trim()) return toast.error('Please enter a URL')
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return toast.error('URL must start with http:// or https://')
    }

    setLoading(true)
    try {
      const newLink = await shortenUrl(url)
      setLinks(prev => {
        const nextLinks = [newLink, ...prev].slice(0, MAX_LOCAL_LINKS)
        saveLocalLinks(nextLinks)
        return nextLinks
      })
      setUrl('')
      toast.success('Short link created!')
    } catch {
      toast.error('Failed to shorten URL')
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard!')
  }

  return (
    <div style={styles.page}>
      <Toaster position="top-right" toastOptions={{ style: { background: '#1a1d27', color: '#f1f5f9', border: '1px solid #2a2d3a' }}} />

      {/* Header */}
      <header style={styles.header}>
        <div style={styles.logo}>
          <Zap size={22} color="#6366f1" />
          <span style={styles.logoText}>DevLinks</span>
        </div>
        <span style={styles.badge}>URL Shortener</span>
      </header>

      <main style={styles.main}>
        {/* Hero */}
        <div style={styles.hero}>
          <h1 style={styles.title}>Shorten any URL<br />in one click</h1>
          <p style={styles.subtitle}>Paste your long URL below and get a clean, shareable short link instantly.</p>
        </div>

        {/* Input Form */}
        <form onSubmit={handleShorten} style={styles.form}>
          <div style={styles.inputRow}>
            <div style={styles.inputWrapper}>
              <Link size={16} color="#64748b" style={styles.inputIcon} />
              <input
                style={styles.input}
                type="text"
                placeholder="https://your-very-long-url.com/goes/here"
                value={url}
                onChange={e => setUrl(e.target.value)}
              />
            </div>
            <button type="submit" style={styles.button} disabled={loading}>
              {loading ? 'Shortening...' : 'Shorten'}
            </button>
          </div>
        </form>

        {/* Links Table */}
        <div style={styles.tableCard}>
          <div style={styles.tableHeader}>
            <BarChart2 size={16} color="#6366f1" />
            <span style={styles.tableTitle}>Your Links</span>
            <span style={styles.tableCount}>{links.length} total</span>
          </div>

          {links.length === 0 ? (
            <p style={styles.empty}>No links yet. Shorten your first URL above.</p>
          ) : (
            <div style={styles.linkList}>
              {links.map(link => (
                <div key={link.short_code} style={styles.linkRow}>
                  <div style={styles.linkInfo}>
                    <a href={link.short_url} target="_blank" rel="noreferrer" style={styles.shortUrl}>
                      {link.short_url}
                    </a>
                    <span style={styles.originalUrl}>{link.original_url}</span>
                  </div>
                  <div style={styles.linkActions}>
                    <span style={styles.clicks}>{link.click_count} clicks</span>
                    <button style={styles.iconBtn} onClick={() => copyToClipboard(link.short_url)} title="Copy">
                      <Copy size={14} color="#64748b" />
                    </button>
                    <a href={link.short_url} target="_blank" rel="noreferrer" style={styles.iconBtn} title="Open">
                      <ExternalLink size={14} color="#64748b" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Stack badge — shows what's running */}
        <div style={styles.stackInfo}>
          <span style={styles.stackBadge}>React + Vite</span>
          <span style={styles.stackDivider}>→</span>
          <span style={styles.stackBadge}>Python FastAPI</span>
          <span style={styles.stackDivider}>→</span>
          <span style={styles.stackBadge}>PostgreSQL</span>
        </div>
      </main>
    </div>
  )
}

const styles = {
  page: { minHeight: '100vh', background: '#0f1117' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 2rem', borderBottom: '1px solid #2a2d3a' },
  logo: { display: 'flex', alignItems: 'center', gap: '8px' },
  logoText: { fontSize: '18px', fontWeight: '600', color: '#f1f5f9' },
  badge: { fontSize: '11px', padding: '3px 10px', borderRadius: '99px', background: '#1a1d27', border: '1px solid #2a2d3a', color: '#64748b' },
  main: { maxWidth: '720px', margin: '0 auto', padding: '3rem 1.5rem' },
  hero: { textAlign: 'center', marginBottom: '2.5rem' },
  title: { fontSize: '2.5rem', fontWeight: '700', lineHeight: '1.2', marginBottom: '1rem', background: 'linear-gradient(135deg, #f1f5f9, #6366f1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' },
  subtitle: { color: '#64748b', fontSize: '1rem', lineHeight: '1.6' },
  form: { marginBottom: '2rem' },
  inputRow: { display: 'flex', gap: '10px' },
  inputWrapper: { flex: 1, position: 'relative', display: 'flex', alignItems: 'center' },
  inputIcon: { position: 'absolute', left: '14px', pointerEvents: 'none' },
  input: { width: '100%', padding: '12px 14px 12px 40px', background: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: '10px', color: '#f1f5f9', fontSize: '14px', transition: 'border-color .2s' },
  button: { padding: '12px 24px', background: '#6366f1', color: '#fff', borderRadius: '10px', fontSize: '14px', fontWeight: '500', whiteSpace: 'nowrap', transition: 'background .2s' },
  tableCard: { background: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: '12px', overflow: 'hidden', marginBottom: '2rem' },
  tableHeader: { display: 'flex', alignItems: 'center', gap: '8px', padding: '1rem 1.25rem', borderBottom: '1px solid #2a2d3a' },
  tableTitle: { fontSize: '14px', fontWeight: '500', flex: 1 },
  tableCount: { fontSize: '12px', color: '#64748b' },
  linkList: { display: 'flex', flexDirection: 'column' },
  linkRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1.25rem', borderBottom: '1px solid #2a2d3a', gap: '12px' },
  linkInfo: { display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 },
  shortUrl: { fontSize: '13px', fontWeight: '500', color: '#6366f1', textDecoration: 'none' },
  originalUrl: { fontSize: '11px', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '380px' },
  linkActions: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 },
  clicks: { fontSize: '11px', color: '#64748b', whiteSpace: 'nowrap' },
  iconBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '6px', background: '#0f1117', border: '1px solid #2a2d3a', textDecoration: 'none', transition: 'border-color .2s' },
  stackInfo: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' },
  stackBadge: { fontSize: '11px', padding: '3px 10px', borderRadius: '99px', background: '#1a1d27', border: '1px solid #2a2d3a', color: '#64748b' },
  stackDivider: { fontSize: '11px', color: '#2a2d3a' },
}
