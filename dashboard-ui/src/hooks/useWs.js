import { useState, useEffect, useRef } from 'react';

// Module-level WebSocket singleton — shared across all components
const messageListeners = new Set();
const statusListeners  = new Set();
let wsStatus = 'disconnected';
let socket   = null;

function notifyMessage(msg) {
  for (const fn of messageListeners) fn(msg);
}

function notifyStatus(s) {
  wsStatus = s;
  for (const fn of statusListeners) fn(s);
}

function connect() {
  const url =
    import.meta.env.VITE_WS_URL ||
    `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;

  try {
    socket = new WebSocket(url);
    notifyStatus('connecting');

    socket.onopen    = () => notifyStatus('connected');
    socket.onmessage = (e) => { try { notifyMessage(JSON.parse(e.data)); } catch {} };
    socket.onclose   = () => {
      notifyStatus('disconnected');
      setTimeout(connect, 3000);
    };
    socket.onerror   = () => socket.close();
  } catch {
    notifyStatus('disconnected');
    setTimeout(connect, 5000);
  }
}

connect();

// Subscribe to WebSocket messages — handler is stable via ref
export function useWsMessages(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (msg) => ref.current?.(msg);
    messageListeners.add(fn);
    return () => messageListeners.delete(fn);
  }, []);
}

// Subscribe to connection status
export function useWsStatus() {
  const [status, setStatus] = useState(wsStatus);
  useEffect(() => {
    statusListeners.add(setStatus);
    return () => statusListeners.delete(setStatus);
  }, []);
  return status;
}
