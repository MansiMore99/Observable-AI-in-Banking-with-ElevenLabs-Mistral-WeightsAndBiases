import React from 'react';
import { Message } from '../types';
import { AlertTriangle, ShieldAlert, Siren, UserX } from 'lucide-react';

interface MessageBubbleProps {
  message: Message;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === 'user';

  const formatText = (text: string) => {
    return text.split('\n').map((line, i) => {
      if (line.trim().startsWith('* ') || line.trim().startsWith('- ')) {
        const content = line.trim().substring(2);
        return (
          <li key={i} style={{ marginLeft: '16px', listStyleType: 'disc', marginBottom: '4px' }}>
            {parseBold(content)}
          </li>
        );
      }
      return <p key={i} style={{ minHeight: '1rem', marginBottom: '2px' }}>{parseBold(line)}</p>;
    });
  };

  const parseBold = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={index} style={{ fontWeight: 600, color: '#00d4ff' }}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  const DEMO_CONFIG: Record<string, {
    bubbleBorder: string; bubbleBg: string; badgeBg: string; badgeBorder: string;
    badgeColor: string; textColor: string; label: string; icon: React.ReactNode;
  }> = {
    hallucination: {
      bubbleBorder: 'rgba(255,170,0,0.4)',
      bubbleBg: 'rgba(255,140,0,0.07)',
      badgeBg: 'rgba(255,140,0,0.15)',
      badgeBorder: 'rgba(255,140,0,0.4)',
      badgeColor: '#ffaa00',
      textColor: '#ffc060',
      label: '⚠ HALLUCINATION',
      icon: <AlertTriangle size={11} color="#ffaa00" />,
    },
    pii: {
      bubbleBorder: 'rgba(255,140,0,0.5)',
      bubbleBg: 'rgba(255,100,0,0.07)',
      badgeBg: 'rgba(255,140,0,0.9)',
      badgeBorder: 'rgba(255,140,0,0.9)',
      badgeColor: '#000',
      textColor: '#ffaa40',
      label: '⚠ PII LEAKED',
      icon: <ShieldAlert size={11} color="#000" />,
    },
    prompt_injection: {
      bubbleBorder: 'rgba(180,0,255,0.4)',
      bubbleBg: 'rgba(180,0,255,0.07)',
      badgeBg: 'rgba(180,0,255,0.15)',
      badgeBorder: 'rgba(180,0,255,0.4)',
      badgeColor: '#cc66ff',
      textColor: '#cc66ff',
      label: '⚠ PROMPT INJECTION',
      icon: <Siren size={11} color="#cc66ff" />,
    },
    input_pii: {
      bubbleBorder: 'rgba(255,120,0,0.4)',
      bubbleBg: 'rgba(255,100,0,0.06)',
      badgeBg: 'rgba(255,120,0,0.15)',
      badgeBorder: 'rgba(255,120,0,0.4)',
      badgeColor: '#ffaa40',
      textColor: '#ffaa40',
      label: '⚠ INPUT PII',
      icon: <UserX size={11} color="#ffaa40" />,
    },
  };

  // User message bubble
  if (isUser) {
    const isDemoUser = !!message.demoTag;
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%', marginBottom: '8px' }}>
        <div style={{
          background: isDemoUser ? 'linear-gradient(135deg, #1a3080, #001870)' : 'linear-gradient(135deg, #1a4fff, #0033cc)',
          color: '#fff',
          padding: '10px 14px',
          borderRadius: '18px 18px 4px 18px',
          fontSize: '12px',
          maxWidth: '75%',
          boxShadow: '0 4px 20px rgba(26,111,255,0.3)',
          lineHeight: 1.5,
        }}>
          {formatText(message.text)}
        </div>
      </div>
    );
  }

  // Bot message bubble
  const demo = message.demoTag ? DEMO_CONFIG[message.demoTag] : null;

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', width: '100%', marginBottom: '8px' }}>
      <div style={{
        background: demo ? demo.bubbleBg : 'rgba(255,255,255,0.04)',
        border: `1px solid ${demo ? demo.bubbleBorder : 'rgba(26,111,255,0.2)'}`,
        color: demo ? demo.textColor : '#c8d8f0',
        padding: '10px 14px',
        borderRadius: '18px 18px 18px 4px',
        fontSize: '12px',
        maxWidth: '80%',
        lineHeight: 1.6,
        position: 'relative',
      }}>
        {/* Demo badge */}
        {demo && (
          <div style={{
            position: 'absolute', top: '-10px', right: '10px',
            background: demo.badgeBg, border: `1px solid ${demo.badgeBorder}`,
            color: demo.badgeColor, fontSize: '8px', fontWeight: 800,
            padding: '2px 8px', borderRadius: '6px', letterSpacing: '1px',
            display: 'flex', alignItems: 'center', gap: '3px',
          }}>
            {demo.icon} {demo.label}
          </div>
        )}

        <div style={{ color: demo ? demo.textColor : '#c8d8f0' }}>
          {formatText(message.text)}
        </div>

        {/* Streaming indicator */}
        {message.isStreaming && (
          <div style={{ display: 'flex', gap: '4px', marginTop: '8px', alignItems: 'center' }}>
            {[0, 1, 2].map(i => (
              <div key={i} className="typing-dot-pulse" style={{ width: '6px', height: '6px', background: '#1a6fff', borderRadius: '50%' }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
