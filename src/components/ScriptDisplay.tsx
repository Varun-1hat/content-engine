import React, { useState, useMemo } from 'react';
import { Copy, Sparkles, Edit3, Loader2, Undo2, Redo2, Eye, EyeOff } from 'lucide-react';
import { diffWords } from 'diff';

interface ScriptDisplayProps {
  script: {
    topic: string;
    template: string;
    hookType: string;
    severity: string;
    wordCount: number;
    estimatedDuration: string;
    hasCTA: boolean;
    fullScript: string;
  };
  onScriptUpdate?: (newScriptText: string) => void;
}

export default function ScriptDisplay({ script, onScriptUpdate }: ScriptDisplayProps) {
  const [history, setHistory] = useState<string[]>([script.fullScript || ""]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [editValue, setEditValue] = useState(script.fullScript || "");
  const [revisionPrompt, setRevisionPrompt] = useState("");
  const [isRevising, setIsRevising] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  const diffResult = useMemo(() => {
    if (!showDiff) return [];
    return diffWords(history[0], editValue);
  }, [showDiff, history, editValue]);

  const pushToHistory = (newText: string) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newText);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setEditValue(newText);
    if (onScriptUpdate) onScriptUpdate(newText);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setEditValue(history[newIndex]);
      if (onScriptUpdate) onScriptUpdate(history[newIndex]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setEditValue(history[newIndex]);
      if (onScriptUpdate) onScriptUpdate(history[newIndex]);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(editValue);
    alert('Copied full script to clipboard!');
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditValue(e.target.value);
    if (onScriptUpdate) {
      onScriptUpdate(e.target.value);
    }
  };

  const handleTextBlur = () => {
    // Only push to history if the text actually changed from the current history state
    if (editValue !== history[historyIndex]) {
      pushToHistory(editValue);
    }
  };

  const callReviseAPI = async (promptText: string) => {
    if (!promptText) return;
    setIsRevising(true);
    try {
      const res = await fetch('/api/revise-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: editValue, prompt: promptText }),
      });
      const data = await res.json();
      if (data.success) {
        pushToHistory(data.revisedScript);
        setRevisionPrompt("");
      } else {
        alert("Failed to revise: " + data.error);
      }
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setIsRevising(false);
    }
  };

  const handleManualRevise = () => {
    callReviseAPI(revisionPrompt);
  };

  const handleAutoEnhance = () => {
    callReviseAPI("Please auto-enhance this script. Make it more punchy, engaging, and viral. Keep all the medical facts perfectly intact. Ensure emotion markers are placed well.");
  };

  return (
    <div className="w-full mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-4">
        <div>
          <h2 className="text-2xl font-bold gradient-text">Script Editor</h2>
          <div className="flex gap-4 mt-2 text-sm text-gray-400">
            <span><strong>Words:</strong> {script.wordCount}</span>
            <span><strong>Duration:</strong> {script.estimatedDuration}</span>
            <span><strong>Template:</strong> {script.template}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleUndo}
            disabled={historyIndex === 0}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded-lg transition-all text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed"
            title="Undo (Revert last AI edit)"
          >
            <Undo2 size={16} /> Undo
          </button>
          <button
            onClick={handleRedo}
            disabled={historyIndex >= history.length - 1}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded-lg transition-all text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Redo2 size={16} /> Redo
          </button>
          <button
            onClick={() => setShowDiff(!showDiff)}
            className={`flex items-center gap-2 px-3 py-2 border rounded-lg transition-all text-sm font-semibold ${
              showDiff 
                ? 'bg-primary/20 text-primary border-primary/50' 
                : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700'
            }`}
            title="Toggle Visual Changes"
          >
            {showDiff ? <EyeOff size={16} /> : <Eye size={16} />} 
            {showDiff ? "Hide Changes" : "Show Changes"}
          </button>
          <button
            onClick={copyToClipboard}
            className="flex items-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-lg transition-all font-semibold"
          >
            <Copy size={16} /> Copy Script
          </button>
        </div>
      </div>

      <div className="glass-card p-2 relative overflow-hidden flex flex-col h-[500px]">
        {isRevising && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-10 flex flex-col items-center justify-center">
            <Loader2 className="animate-spin text-primary w-12 h-12 mb-4" />
            <p className="text-white font-bold text-lg">Revising your script...</p>
          </div>
        )}

        {showDiff ? (
          <div className="flex-1 w-full p-6 bg-transparent text-gray-200 overflow-y-auto font-mono text-base leading-relaxed whitespace-pre-wrap">
            {diffResult.map((part, index) => {
              if (part.added) {
                return <span key={index} className="bg-green-500/20 text-green-300 px-1 rounded">{part.value}</span>;
              }
              if (part.removed) {
                return <span key={index} className="bg-red-500/20 text-red-400 line-through px-1 rounded">{part.value}</span>;
              }
              return <span key={index}>{part.value}</span>;
            })}
          </div>
        ) : (
          <textarea
            value={editValue}
            onChange={handleTextChange}
            onBlur={handleTextBlur}
            className="flex-1 w-full p-6 bg-transparent text-gray-200 focus:outline-none resize-none font-mono text-base leading-relaxed"
            placeholder="Your script will appear here..."
          />
        )}
        
        {/* Integrated AI Toolbar */}
        <div className="p-4 bg-indigo-950/40 border-t border-indigo-500/20 rounded-b-xl flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <div className="flex-1 relative">
            <input 
              type="text"
              value={revisionPrompt}
              onChange={(e) => setRevisionPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualRevise()}
              placeholder="Ask AI to change something (e.g. 'make it funnier')"
              className="w-full bg-black/50 border border-gray-700 text-sm rounded-lg pl-4 pr-10 py-3 text-white outline-none focus:ring-1 focus:ring-primary"
            />
            <button 
              onClick={handleManualRevise}
              disabled={!revisionPrompt.trim() || isRevising}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-primary disabled:opacity-50 transition-colors"
            >
              <Edit3 size={18} />
            </button>
          </div>
          <button
            onClick={handleAutoEnhance}
            disabled={isRevising}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-primary to-indigo-600 hover:from-primary-hover hover:to-indigo-500 text-white font-bold rounded-lg transition-all shadow-[0_0_15px_rgba(99,102,241,0.3)] disabled:opacity-50"
          >
            <Sparkles size={16} /> Auto Enhance
          </button>
        </div>
      </div>
    </div>
  );
}
