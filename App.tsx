import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, AlertTriangle, ShieldAlert, Siren, UserX, Mic, MicOff } from 'lucide-react';
import { MessageBubble } from './components/MessageBubble';
import { Message } from './types';
import { INITIAL_MESSAGE, QUICK_ACTIONS } from './constants';
import { sendMessage, initializeChat } from './services/mistralService';
import { fetchWbUrl, logDemoToWb, transcribeAudio, DemoType } from './services/wbService';

const SESSION_ID = `securebank-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

const getDemoScore = (tag?: string): number => {
  const scores: Record<string, number> = {
    hallucination: 0.23, pii: 0.09, prompt_injection: 0.35, input_pii: 0.45,
  };
  return tag ? (scores[tag] ?? 0.97) : 0.97;
};

const getTraceStyle = (tag?: string) => {
  if (tag === 'pii' || tag === 'input_pii')
    return { bg: 'rgba(255,160,0,0.15)', border: 'rgba(255,160,0,0.3)', color: '#ffaa00', type: 'pii' as const };
  if (tag === 'hallucination')
    return { bg: 'rgba(255,60,60,0.15)', border: 'rgba(255,60,60,0.3)', color: '#ff4444', type: 'warn' as const };
  if (tag === 'prompt_injection')
    return { bg: 'rgba(180,0,255,0.15)', border: 'rgba(180,0,255,0.3)', color: '#cc66ff', type: 'injection' as const };
  return { bg: 'rgba(0,200,100,0.15)', border: 'rgba(0,200,100,0.3)', color: '#00c864', type: 'ok' as const };
};

// ── Small helper components ──────────────────────────────────────────────────

const TechBadge: React.FC<{ dotBg: string; dotLabel: string; label: string }> = ({ dotBg, dotLabel, label }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(10,20,40,0.7)', border: '1px solid rgba(26,111,255,0.2)', borderRadius: '20px', padding: '5px 10px 5px 6px', backdropFilter: 'blur(8px)', fontSize: '10px', color: '#7aa0ff', fontWeight: 500 }}>
    <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: dotBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', fontWeight: 800, color: 'white', flexShrink: 0 }}>{dotLabel}</div>
    <span>{label}</span>
  </div>
);

const WbBadge: React.FC<{ dimmed?: boolean }> = ({ dimmed }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: dimmed ? 'rgba(10,20,40,0.5)' : 'rgba(10,20,40,0.7)', border: dimmed ? '1px solid rgba(255,183,0,0.15)' : '1px solid rgba(255,183,0,0.4)', borderRadius: '20px', padding: '5px 10px 5px 6px', backdropFilter: 'blur(8px)', fontSize: '10px', color: dimmed ? '#5a6080' : '#ffb740', fontWeight: 500, cursor: dimmed ? 'default' : 'pointer', transition: 'border-color 0.2s, color 0.2s' }}>
    <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: dimmed ? '#2a2a2a' : 'linear-gradient(135deg, #ffb800, #ff6d00)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', fontWeight: 800, color: 'white', flexShrink: 0 }}>W</div>
    <span>W&amp;B Weave</span>
    {!dimmed && <span style={{ fontSize: '8px', opacity: 0.7 }}>↗</span>}
  </div>
);

const StatCard: React.FC<{
  value: string; label: string; valueColor: string;
  valueFontSize?: string; cardStyle?: React.CSSProperties; labelStyle?: React.CSSProperties;
}> = ({ value, label, valueColor, valueFontSize = '20px', cardStyle = {}, labelStyle = {} }) => (
  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '12px', textAlign: 'center', ...cardStyle }}>
    <div style={{ fontSize: valueFontSize, fontWeight: 700, color: valueColor, lineHeight: 1.2 }}>{value}</div>
    <div style={{ fontSize: '9px', color: '#4a6080', marginTop: '3px', textTransform: 'uppercase', letterSpacing: '1px', ...labelStyle }}>{label}</div>
  </div>
);

const DemoMenuItem: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void }> = ({ icon, label, onClick }) => (
  <button onClick={onClick} className="demo-menu-item" style={{ width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: '11px', color: '#c0d0e8', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'inherit' }}>
    {icon} {label}
  </button>
);

// ── Main App ────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [wbUrl, setWbUrl] = useState<string | null>(null);
  const [showDemoMenu, setShowDemoMenu] = useState(false);
  const [demoStatus, setDemoStatus] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const demoMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      initializeChat();
      setMessages([{ id: 'init', role: 'model', text: INITIAL_MESSAGE, timestamp: new Date() }]);
    } catch (e) { console.error('Failed to init chat', e); }
    fetchWbUrl().then(url => { if (url) setWbUrl(url); });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!showDemoMenu) return;
    const handleOutside = (e: MouseEvent) => {
      if (demoMenuRef.current && !demoMenuRef.current.contains(e.target as Node)) {
        setShowDemoMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showDemoMenu]);

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    const userMessage: Message = { id: Date.now().toString(), role: 'user', text, timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    const botMessageId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { id: botMessageId, role: 'model', text: '', timestamp: new Date(), isStreaming: true }]);
    try {
      const responseText = await sendMessage(text, SESSION_ID);
      setMessages(prev => prev.map(msg => msg.id === botMessageId ? { ...msg, text: responseText, isStreaming: false } : msg));
    } catch (error: any) {
      const errorMsg = error?.message || 'Unknown error';
      setMessages(prev => prev.map(msg => msg.id === botMessageId ? { ...msg, text: `Error: ${errorMsg}`, isStreaming: false } : msg));
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleMicClick = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setIsTranscribing(true);
        try {
          const transcript = await transcribeAudio(audioBlob);
          if (transcript.trim()) setInputValue(transcript.trim());
        } catch (err) { console.error('Transcription failed:', err); }
        finally { setIsTranscribing(false); }
      };
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) { console.error('Microphone access denied:', err); }
  };

  const handleLogDemo = async (demoType: DemoType, index: number = 0) => {
    setShowDemoMenu(false);
    setDemoStatus('logging');
    const result = await logDemoToWb(demoType, index, SESSION_ID);
    if (result.success && result.turns && result.turns.length > 0) {
      const newMessages: Message[] = [];
      result.turns.forEach((turn, i) => {
        const ts = Date.now() + i * 2;
        newMessages.push({ id: `demo-q-${ts}`, role: 'user', text: turn.question, timestamp: new Date(), demoTag: demoType });
        newMessages.push({ id: `demo-a-${ts + 1}`, role: 'model', text: turn.answer, timestamp: new Date(), demoTag: demoType });
      });
      setMessages(prev => [...prev, ...newMessages]);
      setDemoStatus('success');
    } else {
      setDemoStatus('error');
    }
    setTimeout(() => setDemoStatus(null), 3000);
  };

  // ── Observability computed values ────────────────────────────────────────
  const modelMessages = messages.filter(m => m.role === 'model' && m.id !== 'init');
  const totalTraces = modelMessages.length;
  const piiMessages = messages.filter(m => m.demoTag === 'pii' || m.demoTag === 'input_pii');
  const safeMessages = modelMessages.filter(m => !m.demoTag);
  const safeRate = totalTraces > 0 ? ((safeMessages.length / totalTraces) * 100).toFixed(1) : '100.0';
  const activeTraceMsg = [...messages].reverse().find(m => m.demoTag);
  const activeUserMsg = activeTraceMsg
    ? messages[messages.findIndex(m => m.id === activeTraceMsg.id) - 1] ?? null
    : null;
  const recentModelMessages = modelMessages.slice(-4).reverse();
  const shortSession = SESSION_ID.split('-').pop()?.toUpperCase().substring(0, 4) || 'F3D9';

  const traceLabelFor = (tag?: string) => {
    if (tag === 'pii') return 'PII Exposure';
    if (tag === 'hallucination') return 'Hallucination';
    if (tag === 'prompt_injection') return 'Prompt Injection';
    if (tag === 'input_pii') return 'Input PII';
    return 'Issue Detected';
  };

  return (
    <div style={{ background: '#050d1a', height: '100vh', overflow: 'hidden', fontFamily: "'Segoe UI', system-ui, sans-serif", position: 'relative', display: 'flex', flexDirection: 'column' }}>

      {/* ── Background layers ── */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.07, backgroundImage: 'linear-gradient(#1a6fff 1px, transparent 1px), linear-gradient(90deg, #1a6fff 1px, transparent 1px)', backgroundSize: '40px 40px', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, opacity: 0.05, backgroundImage: 'radial-gradient(#00d4ff 1px, transparent 1px)', backgroundSize: '40px 40px', backgroundPosition: '20px 20px', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0px, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'linear-gradient(to right, transparent, #1a6fff, #00d4ff, #1a6fff, transparent)', opacity: 0.8, zIndex: 10 }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(to right, transparent, #1a6fff, #00d4ff, #1a6fff, transparent)', opacity: 0.4, zIndex: 10 }} />
      <div style={{ position: 'absolute', left: '-100px', top: '50%', transform: 'translateY(-50%)', width: '500px', height: '500px', background: 'radial-gradient(circle, rgba(26,111,255,0.15) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', right: '-100px', top: '50%', transform: 'translateY(-50%)', width: '500px', height: '500px', background: 'radial-gradient(circle, rgba(0,212,255,0.1) 0%, transparent 70%)', pointerEvents: 'none' }} />

      {/* ── Top center badges ── */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', padding: '14px 0 6px', position: 'relative', zIndex: 10, flexShrink: 0 }}>
        <TechBadge dotBg="linear-gradient(135deg, #1a1a2e, #4a00e0)" dotLabel="E" label="ElevenLabs STT" />
        {wbUrl ? (
          <a href={wbUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }} title={`View traces: ${wbUrl}`}>
            <WbBadge />
          </a>
        ) : (
          <WbBadge dimmed />
        )}
      </div>

      {/* ── Main two-panel layout ── */}
      <div style={{ flex: 1, display: 'flex', padding: '4px 40px 44px', gap: 0, overflow: 'hidden' }}>

        {/* ════════ LEFT PANEL — CHAT ════════ */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>

          {/* Panel label */}
          <div style={{ fontSize: '11px', letterSpacing: '3px', textTransform: 'uppercase', color: '#1a6fff', marginBottom: '2px', flexShrink: 0 }}>
            AI Banking Assistant
          </div>

          {/* Chat window */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'rgba(10,20,40,0.8)', border: '1px solid rgba(26,111,255,0.25)', borderRadius: '16px', padding: '20px', backdropFilter: 'blur(10px)', boxShadow: '0 0 40px rgba(26,111,255,0.08), inset 0 1px 0 rgba(255,255,255,0.05)', overflow: 'hidden', minHeight: 0 }}>

            {/* Chat header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingBottom: '14px', borderBottom: '1px solid rgba(26,111,255,0.15)', marginBottom: '14px', flexShrink: 0 }}>
              <div style={{ width: '36px', height: '36px', background: 'linear-gradient(135deg, #1a6fff, #00d4ff)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 16px rgba(26,111,255,0.6)', flexShrink: 0 }}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="white" strokeWidth="2">
                  <rect x="3" y="8" width="18" height="12" rx="3" />
                  <path d="M8 8V6a4 4 0 0 1 8 0v2" />
                  <circle cx="9" cy="14" r="1.5" fill="white" stroke="none" />
                  <circle cx="15" cy="14" r="1.5" fill="white" stroke="none" />
                  <path d="M9 17.5h6" />
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#e0eaff', fontSize: '13px', fontWeight: 600 }}>SecureBank Assistant</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#00d4ff', fontSize: '10px' }}>
                  <span style={{ width: '6px', height: '6px', background: '#00d4ff', borderRadius: '50%', boxShadow: '0 0 6px #00d4ff', flexShrink: 0, display: 'inline-block' }} />
                  Online · Mistral-Large
                </div>
              </div>
              <div style={{ display: 'flex', gap: '5px' }}>
                {(['#ff4444', '#ffaa00', '#00c864'] as const).map((c, i) => (
                  <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: c, opacity: 0.7 }} />
                ))}
              </div>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }} className="scrollbar-hide">
              {messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
              {isLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '10px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(26,111,255,0.15)', borderRadius: '18px', alignSelf: 'flex-start', marginTop: '4px' }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} className="typing-dot-pulse" style={{ width: '6px', height: '6px', background: '#1a6fff', borderRadius: '50%' }} />
                  ))}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input section */}
          <div style={{ background: 'rgba(10,20,40,0.8)', border: '1px solid rgba(26,111,255,0.2)', borderRadius: '16px', padding: '12px 16px', flexShrink: 0 }}>
            <form
              onSubmit={e => { e.preventDefault(); handleSendMessage(inputValue); }}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(26,111,255,0.2)', borderRadius: '50px', padding: '8px 12px 8px 16px' }}
            >
              <span style={{ color: '#4a6080', fontSize: '18px', flexShrink: 0, lineHeight: 1 }}>⌘</span>
              <input
                ref={inputRef}
                type="text"
                value={isTranscribing ? 'Transcribing...' : inputValue}
                onChange={e => setInputValue(e.target.value)}
                placeholder="Ask a banking question or press mic to speak..."
                disabled={isLoading || isTranscribing}
                className="msg-input"
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: isTranscribing ? '#6080aa' : '#c8d8f0', fontSize: '12px', minWidth: 0, fontFamily: 'inherit' }}
              />
              <button
                type="button"
                onClick={handleMicClick}
                disabled={isLoading || isTranscribing}
                title={isRecording ? 'Stop recording' : 'Speak your message'}
                style={{ width: '36px', height: '36px', background: isRecording ? 'linear-gradient(135deg, #ff4444, #cc0000)' : 'linear-gradient(135deg, #1a6fff, #00d4ff)', borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 20px rgba(26,111,255,0.5), 0 0 40px rgba(0,212,255,0.2)' }}
              >
                {isRecording ? <MicOff size={16} color="white" /> : <Mic size={16} color="white" />}
              </button>
            </form>
            {/* ElevenLabs waveform */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px', padding: '0 4px' }}>
              <span style={{ fontSize: '9px', color: '#2a4060', letterSpacing: '0.5px' }}>ELEVENLABS STT</span>
              <div style={{ flex: 1, height: '20px', display: 'flex', alignItems: 'center', gap: '1px' }}>
                {[4, 8, 14, 18, 12, 16, 10, 6, 14, 18, 10, 8, 4].map((h, i) => (
                  <div key={i} style={{ width: '2px', height: `${h}px`, background: [3, 5, 8, 10].includes(i) ? '#00d4ff' : '#1a6fff', borderRadius: '1px', opacity: 0.4 + (h / 18) * 0.6 }} />
                ))}
              </div>
              <span style={{ fontSize: '9px', color: '#00d4ff' }}>● LIVE</span>
            </div>
          </div>

          {/* Quick chips */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', flexShrink: 0 }}>
            {QUICK_ACTIONS.map(action => (
              <button
                key={action.id}
                onClick={() => handleSendMessage(action.prompt)}
                className="quick-chip-btn"
                style={{ background: 'rgba(26,111,255,0.1)', border: '1px solid rgba(26,111,255,0.25)', color: '#7aa0ff', fontSize: '10px', padding: '5px 12px', borderRadius: '20px', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Vertical divider ── */}
        <div style={{ width: '1px', background: 'linear-gradient(to bottom, transparent, rgba(26,111,255,0.33), rgba(0,212,255,0.33), transparent)', margin: '0 20px', flexShrink: 0 }} />

        {/* ════════ RIGHT PANEL — OBSERVABILITY ════════ */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>

          {/* Panel label + Demo dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ fontSize: '11px', letterSpacing: '3px', textTransform: 'uppercase', color: '#1a6fff' }}>
              W&B Weave — LLM Observability
            </div>
            <div ref={demoMenuRef} style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
              {demoStatus === 'success' && <span style={{ fontSize: '9px', color: '#00c864', fontWeight: 600 }}>Logged!</span>}
              {demoStatus === 'error' && <span style={{ fontSize: '9px', color: '#ff4444', fontWeight: 600 }}>Failed — start backend</span>}
              {demoStatus === 'logging' && <span style={{ fontSize: '9px', color: '#7aa0ff', fontWeight: 600 }}>Logging...</span>}
              <button
                onClick={() => setShowDemoMenu(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', fontWeight: 600, background: 'rgba(26,111,255,0.1)', border: '1px solid rgba(26,111,255,0.3)', color: '#7aa0ff', padding: '4px 10px', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Log Demo <ChevronDown size={11} />
              </button>

              {showDemoMenu && (
                <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: '4px', width: '270px', background: 'rgba(5,15,30,0.97)', border: '1px solid rgba(26,111,255,0.3)', borderRadius: '12px', padding: '8px 0', zIndex: 50, backdropFilter: 'blur(12px)' }}>
                  <p style={{ padding: '4px 12px 2px', fontSize: '9px', fontWeight: 600, color: '#4a6080', textTransform: 'uppercase', letterSpacing: '1px' }}>Hallucination Demos</p>
                  <DemoMenuItem icon={<AlertTriangle size={13} color="#ffaa00" />} label="Senior Joint Account (wrong docs)" onClick={() => handleLogDemo('hallucination', 0)} />
                  <DemoMenuItem icon={<AlertTriangle size={13} color="#ffaa00" />} label="ACH Limits (wrong amounts)" onClick={() => handleLogDemo('hallucination', 1)} />
                  <DemoMenuItem icon={<AlertTriangle size={13} color="#ffaa00" />} label="Wire Cancellation (wrong policy)" onClick={() => handleLogDemo('hallucination', 2)} />
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '4px 0' }} />
                  <p style={{ padding: '4px 12px 2px', fontSize: '9px', fontWeight: 600, color: '#4a6080', textTransform: 'uppercase', letterSpacing: '1px' }}>PII Leak Demos</p>
                  <DemoMenuItem icon={<ShieldAlert size={13} color="#ff6060" />} label="SSN + Personal Details Leaked" onClick={() => handleLogDemo('pii', 0)} />
                  <DemoMenuItem icon={<ShieldAlert size={13} color="#ff6060" />} label="Account + Card Number Leaked" onClick={() => handleLogDemo('pii', 1)} />
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '4px 0' }} />
                  <p style={{ padding: '4px 12px 2px', fontSize: '9px', fontWeight: 600, color: '#4a6080', textTransform: 'uppercase', letterSpacing: '1px' }}>Prompt Injection Demos</p>
                  <DemoMenuItem icon={<Siren size={13} color="#cc66ff" />} label="System Prompt Override Attack" onClick={() => handleLogDemo('prompt_injection', 0)} />
                  <DemoMenuItem icon={<Siren size={13} color="#cc66ff" />} label="Social Engineering via Roleplay" onClick={() => handleLogDemo('prompt_injection', 1)} />
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '4px 0' }} />
                  <p style={{ padding: '4px 12px 2px', fontSize: '9px', fontWeight: 600, color: '#4a6080', textTransform: 'uppercase', letterSpacing: '1px' }}>Input PII Demos</p>
                  <DemoMenuItem icon={<UserX size={13} color="#ffaa40" />} label="User Shares Credit Card (no warning)" onClick={() => handleLogDemo('input_pii', 0)} />
                  <DemoMenuItem icon={<UserX size={13} color="#ffaa40" />} label="User Shares SSN (agent processes it)" onClick={() => handleLogDemo('input_pii', 1)} />
                </div>
              )}
            </div>
          </div>

          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', flexShrink: 0 }}>
            <StatCard value={String(totalTraces)} label="Total Traces" valueColor="#00d4ff" />
            <StatCard
              value={piiMessages.length > 0 ? `🔴 ${piiMessages.length} NEW` : '0'}
              label="PII Alert"
              valueColor="#ff4444"
              valueFontSize={piiMessages.length > 0 ? '13px' : '20px'}
              cardStyle={piiMessages.length > 0 ? { borderColor: 'rgba(255,140,0,0.3)', background: 'rgba(255,100,0,0.06)' } : {}}
              labelStyle={piiMessages.length > 0 ? { color: '#ffaa40' } : {}}
            />
            <StatCard value={`${safeRate}%`} label="Safe Rate" valueColor="#00c864" />
          </div>

          {/* Active trace (shown when any demo message is present) */}
          {activeTraceMsg && (
            <div style={{ background: 'rgba(5,12,25,0.85)', border: '1px solid rgba(255,140,0,0.4)', borderRadius: '16px', padding: '16px', boxShadow: '0 0 30px rgba(255,120,0,0.1)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="#ffaa40"><path d="M12 1a5 5 0 1 0 0 10A5 5 0 0 0 12 1zm0 12c-5.3 0-8 2.7-8 4v2h16v-2c0-1.3-2.7-4-8-4z" /></svg>
                  <span style={{ color: '#ffaa40', fontSize: '12px', fontWeight: 600 }}>
                    Active Trace · {traceLabelFor(activeTraceMsg.demoTag)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(255,60,60,0.15)', border: '1px solid rgba(255,60,60,0.3)', color: '#ff6060', fontSize: '9px', padding: '3px 8px', borderRadius: '20px', fontWeight: 600, letterSpacing: '1px' }}>
                  <div style={{ width: '5px', height: '5px', background: '#ff4444', borderRadius: '50%', boxShadow: '0 0 6px #ff4444' }} />
                  JUST NOW
                </div>
              </div>

              {/* Input / Output comparison */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px', padding: '10px' }}>
                  <div style={{ fontSize: '9px', color: '#4a6080', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>Input</div>
                  <div style={{ fontSize: '10px', color: '#c0d0e8', lineHeight: 1.5 }}>
                    "{(activeUserMsg?.text ?? 'User query').substring(0, 60)}{(activeUserMsg?.text ?? '').length > 60 ? '…' : ''}"
                  </div>
                </div>
                <div style={{ background: 'rgba(255,100,0,0.07)', border: '1px solid rgba(255,140,0,0.3)', borderRadius: '8px', padding: '10px' }}>
                  <div style={{ fontSize: '9px', color: '#ffaa40', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>⚠ Output — {traceLabelFor(activeTraceMsg.demoTag)}</div>
                  <div style={{ fontSize: '10px', color: '#ffaa40', lineHeight: 1.6 }}>
                    {activeTraceMsg.text.substring(0, 80)}{activeTraceMsg.text.length > 80 ? '…' : ''}
                  </div>
                </div>
              </div>

              {/* Scores + VIEW TRACE button */}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch' }}>
                <div style={{ flex: 1, background: 'rgba(255,100,0,0.1)', border: '1px solid rgba(255,140,0,0.25)', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: '#ff6040' }}>{getDemoScore(activeTraceMsg.demoTag)}</div>
                  <div style={{ fontSize: '8px', color: '#996633', marginTop: '2px' }}>{activeTraceMsg.demoTag === 'pii' ? 'PII' : (activeTraceMsg.demoTag ?? 'SAFETY').toUpperCase().replace('_', ' ')} SCORE</div>
                </div>
                <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: '#00c864' }}>0.94</div>
                  <div style={{ fontSize: '8px', color: '#4a6080', marginTop: '2px' }}>GROUNDEDNESS</div>
                </div>
                <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: '#00d4ff' }}>301ms</div>
                  <div style={{ fontSize: '8px', color: '#4a6080', marginTop: '2px' }}>LATENCY</div>
                </div>
                {wbUrl && (
                  <a href={wbUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 10px', background: 'rgba(255,140,0,0.1)', border: '1px solid rgba(255,140,0,0.4)', borderRadius: '8px', fontSize: '9px', color: '#ffaa40', fontWeight: 700, letterSpacing: '0.5px', textDecoration: 'none', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                    VIEW TRACE →
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Recent Traces */}
          <div style={{ flex: 1, background: 'rgba(5,12,25,0.85)', border: '1px solid rgba(0,212,255,0.2)', borderRadius: '16px', padding: '16px', overflow: 'auto', backdropFilter: 'blur(10px)', boxShadow: '0 0 40px rgba(0,212,255,0.06)', minHeight: 0 }} className="scrollbar-hide">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ color: '#c8d8f0', fontSize: '12px', fontWeight: 600 }}>Recent Traces</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {wbUrl && (
                  <a href={wbUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '9px', color: '#ffb740', fontWeight: 700, textDecoration: 'none', border: '1px solid rgba(255,183,0,0.3)', padding: '2px 8px', borderRadius: '6px', background: 'rgba(255,183,0,0.08)', letterSpacing: '0.3px' }}>
                    VIEW ALL IN W&amp;B →
                  </a>
                )}
                <span style={{ fontSize: '9px', color: '#4a6080' }}>Session {shortSession}</span>
              </div>
            </div>

            {recentModelMessages.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#2a4060', fontSize: '11px', padding: '20px 0' }}>
                No traces yet. Send a message or log a demo.
              </div>
            ) : (
              recentModelMessages.map(msg => {
                const ts = getTraceStyle(msg.demoTag);
                const score = getDemoScore(msg.demoTag);
                const scoreColor = score >= 0.9 ? '#00c864' : score >= 0.4 ? '#ffaa00' : '#ff4444';
                const idx = messages.findIndex(m => m.id === msg.id);
                const prevUser = idx > 0 ? messages[idx - 1] : null;
                const queryText = prevUser?.text ?? 'Query';
                return (
                  <div key={msg.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', borderRadius: '8px', marginBottom: '6px', background: msg.demoTag ? `${ts.bg}` : 'rgba(255,255,255,0.02)', border: `1px solid ${msg.demoTag ? ts.border : 'rgba(255,255,255,0.04)'}` }}>
                    {msg.demoTag && <div style={{ width: '6px', height: '6px', background: ts.color, borderRadius: '50%', boxShadow: `0 0 6px ${ts.color}`, flexShrink: 0 }} />}
                    <div style={{ width: '28px', height: '28px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: ts.bg, border: `1px solid ${ts.border}` }}>
                      {ts.type === 'ok' ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="#00c864"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" /></svg>
                      ) : ts.type === 'pii' ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="#ffaa00"><path d="M12 1a5 5 0 1 0 0 10A5 5 0 0 0 12 1zm0 12c-5.3 0-8 2.7-8 4v2h16v-2c0-1.3-2.7-4-8-4z" /></svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill={ts.color}><path d="M12 2L2 20h20L12 2zm-1 13h2v2h-2v-2zm0-6h2v4h-2V9z" /></svg>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: msg.demoTag ? ts.color : '#c0d0e8', fontSize: '11px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        "{queryText.substring(0, 38)}{queryText.length > 38 ? '…' : ''}"
                      </div>
                      <div style={{ color: msg.demoTag ? `${ts.color}99` : '#4a6080', fontSize: '9px', marginTop: '2px' }}>
                        {msg.demoTag ? `⚠ ${traceLabelFor(msg.demoTag)} · ` : ''}just now
                      </div>
                    </div>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: scoreColor, flexShrink: 0 }}>
                      {score.toFixed(2)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom Mistral badge ── */}
      <div style={{ position: 'absolute', bottom: '16px', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(10,20,40,0.7)', border: '1px solid rgba(26,111,255,0.2)', borderRadius: '20px', padding: '5px 10px 5px 6px', backdropFilter: 'blur(8px)', fontSize: '10px', color: '#7aa0ff', fontWeight: 500, zIndex: 5 }}>
        <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'linear-gradient(135deg, #ff7000, #ff3300)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', fontWeight: 800, color: 'white' }}>M</div>
        <span>Mistral Large</span>
      </div>

    </div>
  );
};

export default App;
