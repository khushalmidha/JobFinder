import React, { useState } from 'react';
import api from '../services/api';
import { Send } from 'lucide-react';

const Login = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (isLogin) {
        const { data } = await api.post('/auth/login', { email, password });
        localStorage.setItem('token', data.token);
        onLogin();
      } else {
        const { data } = await api.post('/auth/signup', { name, email, password });
        localStorage.setItem('token', data.token);
        onLogin();
      }
    } catch (err) {
      setError(err.response?.data?.error || 'An error occurred');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 font-sans p-4">
      <div className="max-w-md w-full bg-zinc-900 rounded-2xl shadow-2xl overflow-hidden border border-zinc-800">
        <div className="bg-yellow-500 p-8 text-center text-zinc-950">
          <Send className="w-12 h-12 mx-auto mb-4 opacity-90 text-zinc-950" />
          <h1 className="text-3xl font-bold tracking-tight">ColdMail Pilot</h1>
          <p className="text-zinc-800 font-medium mt-2">Automate your job applications</p>
        </div>
        <div className="p-8">
          <h2 className="text-2xl font-semibold text-zinc-100 mb-6 text-center">
            {isLogin ? 'Welcome back' : 'Create an account'}
          </h2>
          
          {error && <div className="mb-4 p-3 bg-red-500/10 text-red-400 rounded-lg text-sm border border-red-500/20">{error}</div>}
          
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 bg-zinc-800 rounded-lg border border-zinc-700 focus:ring-2 focus:ring-yellow-500 focus:border-transparent outline-none transition text-zinc-200"
                  placeholder="John Doe"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-800 rounded-lg border border-zinc-700 focus:ring-2 focus:ring-yellow-500 focus:border-transparent outline-none transition text-zinc-200"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-800 rounded-lg border border-zinc-700 focus:ring-2 focus:ring-yellow-500 focus:border-transparent outline-none transition text-zinc-200"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-yellow-500 hover:bg-yellow-400 text-zinc-950 font-bold py-3 px-4 rounded-lg transition-colors shadow-sm"
            >
              {isLogin ? 'Sign In' : 'Sign Up'}
            </button>
          </form>
          
          <div className="mt-6 text-center">
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="text-yellow-500 hover:text-yellow-400 text-sm font-medium transition-colors"
            >
              {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
