export function connectStatusSocket(onEvent) {
  let socket;
  let closed = false;
  let pingTimer;

  const open = () => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${location.host}/ws`);
    onEvent({ type: 'status', status: 'connecting' });

    socket.onopen = () => {
      onEvent({ type: 'status', status: 'connected' });
      pingTimer = setInterval(() => {
        socket.send(JSON.stringify({ type: 'ping' }));
      }, 5000);
    };
    socket.onmessage = (event) => onEvent(JSON.parse(event.data));
    socket.onclose = () => {
      clearInterval(pingTimer);
      onEvent({ type: 'status', status: 'reconnecting' });
      if (!closed) setTimeout(open, 1200);
    };
    socket.onerror = () => onEvent({ type: 'status', status: 'error' });
  };

  open();
  return () => {
    closed = true;
    clearInterval(pingTimer);
    socket?.close();
  };
}
