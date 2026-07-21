import { useState } from 'react';

export function Login({ onLogin }) {
  const [name, setName] = useState('');

  return (
    <main className="login-screen">
      <form className="login-panel" onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) onLogin(name.trim());
      }}>
        <p className="eyebrow">DeepSeek Agent Demo</p>
        <h1>AI 前端技术学习台</h1>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="输入昵称进入" autoFocus />
        <button type="submit">进入 Demo</button>
      </form>
    </main>
  );
}
