"use client";

import { useState } from "react";
import { Loader2, LogIn } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const supabase = supabaseBrowser();
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) throw new Error(error.message);
      window.location.href = "/";
    } catch (err: any) {
      setError(err.message || "Login failed");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={handleLogin} className="glass-card p-12 max-w-md w-full text-center space-y-6 shadow-2xl">
        <div className="mx-auto w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center mb-6 border border-primary/40">
          <LogIn size={32} className="text-primary" />
        </div>
        <h1 className="text-3xl font-bold text-white">Reel Engine</h1>
        <p className="text-gray-400">Sign in to continue</p>

        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="w-full px-4 py-3 bg-black/40 border border-gray-700 rounded-lg focus:ring-2 focus:ring-primary text-white placeholder-gray-500 outline-none"
        />
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full px-4 py-3 bg-black/40 border border-gray-700 rounded-lg focus:ring-2 focus:ring-primary text-white placeholder-gray-500 outline-none"
        />

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-4 bg-primary hover:bg-primary-hover text-white rounded-lg font-bold transition-all shadow-[0_0_20px_rgba(99,102,241,0.4)] disabled:opacity-50 flex justify-center items-center gap-2"
        >
          {isLoading ? <Loader2 className="animate-spin" size={18} /> : <LogIn size={18} />}
          Sign In
        </button>
      </form>
    </div>
  );
}
