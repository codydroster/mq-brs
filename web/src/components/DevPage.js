import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { WS_URL } from '../config';

const TOPICS = {
  cnc:   { pub: 'machine/cnc/command',   sub: 'machine/cnc/response' },
  crane: { pub: 'machine/crane/command', sub: 'machine/crane/response' },
};

const S = {
  page:  { display: 'flex', gap: 24, padding: 24, height: '100%', boxSizing: 'border-box', overflow: 'hidden', fontFamily: 'Arial, Helvetica, sans-serif' },
  panel: { display: 'flex', flexDirection: 'column', flex: 1, gap: 12, minWidth: 0 },
  title: { margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: 1, color: '#003087', textTransform: 'uppercase', borderBottom: '2px solid #003087', paddingBottom: 6 },
  log:   { flex: 1, background: '#111', color: '#0f0', fontFamily: 'monospace', fontSize: 12, padding: 10, borderRadius: 4, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
  row:   { display: 'flex', gap: 8 },
  input: { flex: 1, fontFamily: 'monospace', fontSize: 13, padding: '6px 10px', border: '1px solid #ccc', borderRadius: 3 },
  btn:   { background: '#003087', color: '#fff', border: 'none', borderRadius: 3, padding: '6px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  btnRed: { background: '#cc0000' },
  dot:   (ok) => ({ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: ok ? '#0a0' : '#555', marginRight: 6 }),
};

function useDevWS(onMessage) {
  const ws = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    function connect() {
      const sock = new WebSocket(WS_URL);
      ws.current = sock;
      sock.onopen  = () => setConnected(true);
      sock.onclose = () => { setConnected(false); setTimeout(connect, 2000); };
      sock.onerror = () => sock.close();
      sock.onmessage = (e) => {
        try { onMessage(JSON.parse(e.data)); } catch {}
      };
    }
    connect();
    return () => { ws.current?.close(); };
  }, [onMessage]);

  const publish = useCallback((topic, payload) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ topic, payload }));
    }
  }, []);

  return { connected, publish };
}

const SerialPanel = forwardRef(function SerialPanel({ title, device, publish, connected }, ref) {
  const [input, setInput]   = useState('');
  const [log, setLog]       = useState([]);
  const logRef              = useRef();
  const topics              = TOPICS[device];

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const addLog = useCallback((line, color) => setLog(l => [...l, { line, color, key: Date.now() + Math.random() }]), []);

  useImperativeHandle(ref, () => ({ addLog }), [addLog]);

  const send = () => {
    const cmd = input.trim();
    if (!cmd || !connected) return;
    addLog(`> ${cmd}`, '#fff');
    publish(topics.pub, { command: cmd });
    setInput('');
  };

  const handleKey = (e) => { if (e.key === 'Enter') send(); };

  return (
    <div style={S.panel}>
      <h2 style={S.title}>
        <span style={S.dot(connected)} />
        {title}
        <span style={{ fontWeight: 400, fontSize: 11, marginLeft: 8, color: '#999' }}>
          {connected ? topics.pub : 'disconnected'}
        </span>
      </h2>
      <div ref={logRef} style={S.log}>
        {log.length === 0 && <span style={{ color: '#555' }}>No output yet</span>}
        {log.map(entry => <div key={entry.key} style={{ color: entry.color }}>{entry.line}</div>)}
      </div>
      <div style={S.row}>
        <input
          style={S.input}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={connected ? 'Enter command...' : 'Waiting for MQTT connection...'}
          disabled={!connected}
          spellCheck={false}
        />
        <button style={S.btn} onClick={send} disabled={!connected}>Send</button>
        <button style={{ ...S.btn, ...S.btnRed }} onClick={() => setLog([])}>Clear</button>
      </div>
    </div>
  );
});

export default function DevPage() {
  const cncRef   = useRef();
  const craneRef = useRef();

  const handleMessage = useCallback((msg) => {
    if (msg.topic === TOPICS.cnc.sub)   cncRef.current?.addLog(msg.payload?.response ?? JSON.stringify(msg.payload), '#0f0');
    if (msg.topic === TOPICS.crane.sub) craneRef.current?.addLog(msg.payload?.response ?? JSON.stringify(msg.payload), '#0f0');
  }, []);

  const { connected, publish } = useDevWS(handleMessage);

  return (
    <div style={S.page}>
      <SerialPanel ref={cncRef}   title="CNC (Gcode)" device="cnc"   publish={publish} connected={connected} />
      <SerialPanel ref={craneRef} title="Crane Arduino" device="crane" publish={publish} connected={connected} />
    </div>
  );
}
