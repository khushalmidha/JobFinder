import React, { useState, useEffect } from 'react';
import { 
  Briefcase, 
  Building2, 
  CheckCircle2, 
  Sparkles, 
  KeyRound, 
  Copy, 
  RotateCw, 
  Send, 
  ShieldCheck, 
  TrendingUp, 
  FileText, 
  Layers,
  ChevronDown,
  ExternalLink,
  Flame
} from 'lucide-react';
import resumeData from '../resumes.json';
import { estimateSalary } from '../utils/salaryEstimator';
import { matchBestResume } from '../utils/roleMatcher';
import { generateHumanoidAnswer } from '../utils/humanoidAnswers';

export const AutoApplyPanel = ({ token, backendUrl }) => {
  const [loading, setLoading] = useState(true);
  const [activeTabUrl, setActiveTabUrl] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [hasForm, setHasForm] = useState(false);
  const [formFieldsCount, setFormFieldsCount] = useState(0);

  // Resume selection state
  const [selectedResumeId, setSelectedResumeId] = useState('variant_sde_fullstack');
  const [matchInfo, setMatchInfo] = useState(null);

  // Salary state
  const [salaryInfo, setSalaryInfo] = useState(null);

  // Action states
  const [isApplying, setIsApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null);
  const [autoPilotActive, setAutoPilotActive] = useState(false);
  const [currentStepName, setCurrentStepName] = useState('');

  // OTP state
  const [isFetchingOtp, setIsFetchingOtp] = useState(false);
  const [latestOtp, setLatestOtp] = useState('');
  const [otpDetails, setOtpDetails] = useState(null);
  const [otpCopied, setOtpCopied] = useState(false);
  const [otpStatus, setOtpStatus] = useState('');

  // Humanoid preview
  const [previewQuestion, setPreviewQuestion] = useState('Why do you want to work at our company?');
  const [previewAnswer, setPreviewAnswer] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  // Initial page inspection
  useEffect(() => {
    analyzeCurrentTab();
  }, []);

  // Re-calculate salary & resume match whenever company or role changes
  useEffect(() => {
    if (company || role) {
      const sal = estimateSalary(company, role);
      setSalaryInfo(sal);

      const m = matchBestResume(role, '', company);
      setMatchInfo(m);
      if (!selectedResumeId || selectedResumeId === 'variant_sde_fullstack') {
        setSelectedResumeId(m.bestResume.id);
      }
    }
  }, [company, role]);

  // Update humanoid preview when inputs change
  useEffect(() => {
    if (previewQuestion && company) {
      const ans = generateHumanoidAnswer(previewQuestion, company, role, selectedResumeId);
      setPreviewAnswer(ans);
    }
  }, [previewQuestion, company, role, selectedResumeId]);

  const analyzeCurrentTab = async () => {
    setLoading(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      setActiveTabUrl(tab.url || '');

      // Try communicating with content script
      chrome.tabs.sendMessage(tab.id, { action: 'ANALYZE_PAGE' }, async (response) => {
        if (chrome.runtime.lastError || !response) {
          // If content script was not yet loaded into this tab, inject it now!
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id, allFrames: true },
              files: ['content.bundle.js']
            });
            // Retry message
            chrome.tabs.sendMessage(tab.id, { action: 'ANALYZE_PAGE' }, (retryRes) => {
              if (retryRes && retryRes.company) {
                applyAnalysisResponse(retryRes);
              } else {
                fallbackParse(tab);
              }
            });
          } catch (e) {
            fallbackParse(tab);
          }
        } else {
          applyAnalysisResponse(response);
        }
      });
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  const applyAnalysisResponse = (response) => {
    setCompany(response.company || 'Company');
    setRole(response.role || 'Software Development Engineer');
    setHasForm(response.hasForm);
    setFormFieldsCount(response.formFieldsCount || 0);
    setSalaryInfo(response.salary);
    setMatchInfo(response.match);
    if (response.autoPilotRunning !== undefined) {
      setAutoPilotActive(response.autoPilotRunning);
    }
    if (response.currentStep) {
      setCurrentStepName(response.currentStep);
    }
    if (response.match?.bestResume?.id) {
      setSelectedResumeId(response.match.bestResume.id);
    }
    setLoading(false);
  };

  const handleToggleAutoPilot = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;
      
      const newAction = autoPilotActive ? 'STOP_AUTOPILOT' : 'START_AUTOPILOT';
      chrome.tabs.sendMessage(tab.id, { action: newAction, resumeId: selectedResumeId }, async (res) => {
        if (!chrome.runtime.lastError && res && res.running !== undefined) {
          setAutoPilotActive(res.running);
          return;
        }

        // Fallback: inject content script if not yet loaded
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            files: ['content.bundle.js']
          });
          chrome.tabs.sendMessage(tab.id, { action: newAction, resumeId: selectedResumeId }, (retryRes) => {
            setAutoPilotActive(retryRes?.running ?? !autoPilotActive);
          });
        } catch (e) {
          setAutoPilotActive(!autoPilotActive);
        }
      });
    } catch (err) {
      console.error(err);
    }
  };

  const fallbackParse = (tab) => {
    const title = tab.title || '';
    let extractedCompany = 'Company';
    let extractedRole = 'Software Development Engineer';

    if (title.includes(' at ')) {
      extractedRole = title.split(' at ')[0].trim();
      extractedCompany = title.split(' at ')[1].split(' - ')[0].trim();
    } else if (title.includes(' - ')) {
      const parts = title.split(' - ');
      extractedRole = parts[0].trim();
      extractedCompany = parts[parts.length - 1].trim();
    }

    setCompany(extractedCompany);
    setRole(extractedRole);
    setHasForm(true);
    setSalaryInfo(estimateSalary(extractedCompany, extractedRole));
    const m = matchBestResume(extractedRole, '', extractedCompany);
    setMatchInfo(m);
    setSelectedResumeId(m.bestResume.id);
    setLoading(false);
  };

  const handleAutoApply = async () => {
    setIsApplying(true);
    setApplyResult(null);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        setIsApplying(false);
        setApplyResult({ success: false, message: 'No active browser tab found.' });
        return;
      }

      // 1. Try standard message communication with content script
      chrome.tabs.sendMessage(tab.id, { action: 'AUTO_FILL_FORM', resumeId: selectedResumeId }, async (response) => {
        if (!chrome.runtime.lastError && response && response.filledCount !== undefined) {
          setIsApplying(false);
          setApplyResult({
            success: true,
            filledCount: response.filledCount,
            summary: response.filledSummary || []
          });
          return;
        }

        // 2. BULLETPROOF FALLBACK: Execute directly into page & ALL iframes via chrome.scripting
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: inPageDirectAutoFill,
            args: [resumeData.profile, selectedResumeId]
          });

          let totalFilled = 0;
          let combinedSummary = [];
          if (results && results.length) {
            results.forEach(r => {
              if (r.result) {
                totalFilled += (r.result.filledCount || 0);
                if (r.result.filledSummary) combinedSummary.push(...r.result.filledSummary);
              }
            });
          }

          setIsApplying(false);
          setApplyResult({
            success: true,
            filledCount: totalFilled,
            summary: [...new Set(combinedSummary)]
          });
        } catch (injectionErr) {
          setIsApplying(false);
          setApplyResult({
            success: false,
            message: `Could not auto-fill: ${injectionErr.message}. Make sure you are on a webpage (not a protected browser tab).`
          });
        }
      });
    } catch (err) {
      setIsApplying(false);
      setApplyResult({ success: false, message: err.message });
    }
  };

  const handleFetchOtp = () => {
    setIsFetchingOtp(true);
    setOtpStatus('Checking Gmail inbox & open tabs...');

    chrome.runtime.sendMessage({ action: 'FETCH_OTP' }, (response) => {
      setIsFetchingOtp(false);
      if (response && response.success && response.otp) {
        setLatestOtp(response.otp);
        setOtpDetails(response);
        setOtpStatus(`Found code: ${response.otp}!`);

        // Automatically attempt to inject into page
        chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
          if (tab) {
            chrome.tabs.sendMessage(tab.id, { action: 'FILL_OTP', otp: response.otp }, (fillRes) => {
              if (fillRes && fillRes.success) {
                setOtpStatus(`Injected OTP ${response.otp} into page!`);
              }
            });
          }
        });
      } else {
        setOtpStatus(response?.error || 'No recent OTP found in inbox.');
      }
    });
  };

  const copyOtpToClipboard = () => {
    if (!latestOtp) return;
    navigator.clipboard.writeText(latestOtp);
    setOtpCopied(true);
    setTimeout(() => setOtpCopied(false), 2000);
  };

  const handleFillOtpManually = () => {
    if (!latestOtp) return;
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { action: 'FILL_OTP', otp: latestOtp }, (res) => {
          if (res?.success) {
            setOtpStatus(`Filled OTP ${latestOtp} into form!`);
          } else {
            setOtpStatus(res?.error || 'Failed to inject OTP into input.');
          }
        });
      }
    });
  };

  const currentResume = resumeData.resumes.find(r => r.id === selectedResumeId) || resumeData.resumes[0];

  return (
    <div className="space-y-3.5 text-zinc-100">
      {/* 1. Top Target Job Context Card */}
      <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-xl p-3 shadow-md">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Target Application</span>
          </div>
          <button 
            onClick={analyzeCurrentTab} 
            className="text-[11px] text-zinc-400 hover:text-yellow-400 flex items-center gap-1 transition"
            title="Re-analyze page"
          >
            <RotateCw className="w-3 h-3" /> Rescan
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="bg-zinc-950/70 border border-zinc-800/60 rounded-lg p-2">
            <label className="text-[10px] text-zinc-400 block font-medium mb-0.5">Company</label>
            <input 
              type="text" 
              value={company} 
              onChange={e => setCompany(e.target.value)}
              className="w-full bg-transparent text-xs font-semibold text-zinc-100 outline-none focus:text-yellow-400"
              placeholder="Detecting company..."
            />
          </div>
          <div className="bg-zinc-950/70 border border-zinc-800/60 rounded-lg p-2">
            <label className="text-[10px] text-zinc-400 block font-medium mb-0.5">Detected Role</label>
            <input 
              type="text" 
              value={role} 
              onChange={e => setRole(e.target.value)}
              className="w-full bg-transparent text-xs font-semibold text-zinc-100 outline-none focus:text-yellow-400"
              placeholder="Detecting role..."
            />
          </div>
        </div>

        {hasForm && (
          <div className="mt-2 flex items-center justify-between text-[11px] text-emerald-400/90 bg-emerald-950/30 border border-emerald-800/30 rounded-md px-2 py-1">
            <span className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Application Form Ready
            </span>
            <span className="text-[10px] text-zinc-400">{formFieldsCount ? `${formFieldsCount} fields` : 'Active'}</span>
          </div>
        )}
      </div>

      {/* 2. Expected SDE1 CTC & Base Card */}
      {salaryInfo && (
        <div className="bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950 border border-yellow-500/30 rounded-xl p-3 shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-yellow-500/5 rounded-full blur-2xl pointer-events-none"></div>
          
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-yellow-400" />
              <span className="text-[11px] font-bold text-yellow-400 uppercase tracking-wide">
                {salaryInfo.isIntern ? 'Expected Stipend & PPO' : 'Expected SDE1 Compensation'}
              </span>
            </div>
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700/50">
              {salaryInfo.tier}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-lg p-2.5">
              <span className="text-[10px] text-zinc-400 block font-medium">Base Salary</span>
              <span className="text-sm font-extrabold text-zinc-100 tracking-tight">{salaryInfo.baseSalary}</span>
            </div>
            <div className="bg-zinc-950/80 border border-yellow-500/30 rounded-lg p-2.5">
              <span className="text-[10px] text-yellow-400/90 block font-medium">Total CTC</span>
              <span className="text-sm font-extrabold text-yellow-400 tracking-tight">{salaryInfo.ctc}</span>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-400 px-1">
            <span>Market Tier: <strong className="text-zinc-200">{salaryInfo.rating}</strong></span>
            <span className="text-emerald-400 font-semibold">90%+ Verified Data</span>
          </div>
        </div>
      )}

      {/* 3. Best Resume Variant Selector */}
      <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-xl p-3 shadow-md space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-[11px] font-bold text-zinc-200 uppercase tracking-wide">Matched Resume Variant</span>
          </div>
          {matchInfo && (
            <span className="text-[10px] font-bold text-blue-400 bg-blue-950/40 border border-blue-800/40 px-2 py-0.5 rounded-full">
              {matchInfo.score}% Fit
            </span>
          )}
        </div>

        {/* Dropdown selector */}
        <div className="relative">
          <select 
            value={selectedResumeId}
            onChange={e => setSelectedResumeId(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-750 rounded-lg px-2.5 py-2 text-xs font-semibold text-zinc-100 focus:border-yellow-500 focus:outline-none appearance-none cursor-pointer pr-8"
          >
            {resumeData.resumes.map(r => (
              <option key={r.id} value={r.id}>
                {r.badge} — {r.title}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Selected resume highlight pills */}
        <div className="text-[11px] bg-zinc-950/60 border border-zinc-800/60 rounded-lg p-2 text-zinc-300">
          <div className="font-semibold text-zinc-200 mb-1 flex items-center gap-1">
            <Flame className="w-3 h-3 text-amber-400" />
            {currentResume.headline}
          </div>
          <div className="text-[10px] text-zinc-400">
            Projects: <span className="text-zinc-200">{currentResume.projects.map(p => p.name).join(', ')}</span>
          </div>
        </div>
      </div>

      {/* 4. Background Auto-Pilot (Hands-Free Mode) */}
      <div className="space-y-2">
        <button 
          onClick={handleToggleAutoPilot}
          className={`w-full py-3 px-4 rounded-xl shadow-xl font-black text-xs transition-all flex items-center justify-center gap-2 cursor-pointer ${
            autoPilotActive 
              ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-900/40 animate-pulse'
              : 'bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 text-zinc-950 hover:brightness-110 shadow-yellow-500/25'
          }`}
        >
          <Sparkles className={`w-4 h-4 ${autoPilotActive ? 'fill-white' : 'fill-zinc-950'}`} />
          {autoPilotActive 
            ? `⏸️ Pause Background Auto-Pilot (${currentStepName || 'Running'})` 
            : '🚀 Start Background Auto-Pilot (Hands-Free)'}
        </button>

        {/* Secondary: Fill current page button */}
        <button 
          onClick={handleAutoApply}
          disabled={isApplying || autoPilotActive}
          className="w-full bg-zinc-900 hover:bg-zinc-850 border border-zinc-750 text-zinc-200 font-bold py-2 px-3 rounded-lg text-xs transition flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
        >
          {isApplying ? 'Filling details...' : '⚡ Fill Only Current Step'}
        </button>
      </div>

      {/* Auto Apply Result Toast */}
      {applyResult && (
        <div className={`p-2.5 rounded-lg border text-xs ${applyResult.success ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300' : 'bg-red-950/40 border-red-800/50 text-red-300'}`}>
          <div className="font-bold flex items-center gap-1.5 mb-1">
            {applyResult.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}
            {applyResult.success ? `Successfully filled ${applyResult.filledCount} fields!` : 'Notice'}
          </div>
          <p className="text-[11px] text-zinc-300">{applyResult.message || `Filled standard candidate details & injected authentic humanoid answers.`}</p>
        </div>
      )}

      {/* 5. Automated Email OTP Extractor */}
      <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-xl p-3 shadow-md space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[11px] font-bold text-zinc-200 uppercase tracking-wide">Email OTP Verification</span>
          </div>
          <span className="text-[10px] text-zinc-400 font-mono">
            {resumeData.profile.email}
          </span>
        </div>

        <div className="flex gap-2 items-center">
          <button 
            onClick={handleFetchOtp}
            disabled={isFetchingOtp}
            className="flex-1 bg-zinc-800 hover:bg-zinc-750 text-yellow-400 border border-yellow-500/30 rounded-lg py-2 px-3 text-xs font-bold transition flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isFetchingOtp ? 'animate-spin' : ''}`} />
            {isFetchingOtp ? 'Fetching from Gmail...' : 'Auto-Fetch OTP'}
          </button>

          {latestOtp && (
            <div className="flex items-center gap-1 bg-zinc-950 border border-yellow-500/60 rounded-lg px-2.5 py-1.5 font-mono text-sm font-bold text-yellow-400 tracking-wider">
              {latestOtp}
              <button onClick={copyOtpToClipboard} className="ml-1 text-zinc-400 hover:text-zinc-100 p-0.5">
                <Copy className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {latestOtp && (
          <button 
            onClick={handleFillOtpManually}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-1.5 rounded-lg text-xs transition"
          >
            Insert OTP {latestOtp} into Form
          </button>
        )}

        {otpStatus && (
          <div className="text-[10px] text-zinc-400 text-center font-medium bg-zinc-950/60 rounded py-1 px-2">
            {otpStatus}
          </div>
        )}
      </div>

      {/* 6. Humanoid Answer Preview Drawer */}
      <div className="border-t border-zinc-800/80 pt-2">
        <button 
          onClick={() => setShowPreview(!showPreview)} 
          className="text-[11px] text-zinc-400 hover:text-zinc-200 flex items-center justify-between w-full font-medium"
        >
          <span className="flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-yellow-400" /> Preview Humanoid AI Answers
          </span>
          <ChevronDown className={`w-3 h-3 transition-transform ${showPreview ? 'rotate-180' : ''}`} />
        </button>

        {showPreview && (
          <div className="mt-2 bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs space-y-2">
            <div>
              <label className="text-[10px] text-zinc-400 block mb-1">Select / Test Question:</label>
              <select 
                value={previewQuestion} 
                onChange={e => setPreviewQuestion(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded p-1 text-[11px] text-zinc-200 outline-none"
              >
                <option value="Why do you want to work at our company?">Why do you want to work at {company || 'our company'}?</option>
                <option value="Describe a difficult technical bug or challenge you solved.">Describe a technical challenge you solved</option>
                <option value="Tell us about yourself and your background.">Tell us about yourself</option>
                <option value="What are your core technical strengths?">What are your core strengths?</option>
                <option value="What are your salary expectations?">Salary expectations</option>
              </select>
            </div>
            <div className="bg-zinc-900/80 border border-zinc-800/60 rounded p-2 text-[11px] text-zinc-300 leading-relaxed max-h-36 overflow-y-auto">
              "{previewAnswer}"
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Standalone self-contained function executed directly in web pages across all frames
function inPageDirectAutoFill(profile, chosenResumeId) {
  function setVal(el, val) {
    if (!el || val === undefined || val === null) return;
    const valueSetter = Object.getOwnPropertyDescriptor(el, 'value')?.set;
    const prototype = Object.getPrototypeOf(el);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
      prototypeValueSetter.call(el, val);
    } else if (valueSetter) {
      valueSetter.call(el, val);
    } else {
      el.value = val;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function getDesc(el) {
    const name = (el.getAttribute('name') || '').toLowerCase();
    const id = (el.getAttribute('id') || '').toLowerCase();
    const ph = (el.getAttribute('placeholder') || '').toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    const dataAuto = (el.getAttribute('data-automation-id') || '').toLowerCase();
    const testId = (el.getAttribute('data-testid') || '').toLowerCase();
    let lblText = '';
    if (el.id) {
      const l = document.querySelector(`label[for="${el.id}"]`);
      if (l) lblText = l.innerText.toLowerCase();
    }
    if (!lblText && el.closest('label')) {
      lblText = el.closest('label').innerText.toLowerCase();
    }
    if (!lblText && el.parentElement) {
      const prev = el.previousElementSibling;
      if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'P')) {
        lblText = prev.innerText.toLowerCase();
      }
    }
    if (!lblText) {
      const c = el.closest('[data-automation-id*="formField"], [data-automation-id*="Section"], .css-1, [data-automation-id*="input"], .field, .form-group');
      if (c) {
        const l = c.querySelector('label, [data-automation-id*="label"]');
        if (l) lblText = l.innerText.toLowerCase();
      }
    }
    return { combined: `${name} ${id} ${ph} ${aria} ${ac} ${dataAuto} ${testId} ${lblText}`.trim(), labelText: lblText || ph || name };
  }

  function matchSelect(selectEl, keywords) {
    if (!selectEl || !selectEl.options) return false;
    for (let i = 0; i < selectEl.options.length; i++) {
      const opt = selectEl.options[i];
      const optText = (opt.text || opt.value || '').toLowerCase();
      if (keywords.some(kw => optText.includes(kw.toLowerCase()))) {
        selectEl.selectedIndex = i;
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  let filledCount = 0;
  const filledSummary = [];
  const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'));

  inputs.forEach(el => {
    if (el.disabled || el.readOnly) return;
    const { combined, labelText } = getDesc(el);

    // First Name
    if ((combined.includes('first') && combined.includes('name')) || combined.includes('fname') || combined.includes('legalnamesection_firstname') || combined === 'first_name') {
      if (el.value !== profile.firstName) {
        setVal(el, profile.firstName);
        filledCount++;
        filledSummary.push('First Name');
      }
      return;
    }

    // Last Name
    if ((combined.includes('last') && combined.includes('name')) || combined.includes('lname') || combined.includes('legalnamesection_lastname') || combined === 'last_name') {
      if (el.value !== profile.lastName) {
        setVal(el, profile.lastName);
        filledCount++;
        filledSummary.push('Last Name');
      }
      return;
    }

    // Full Name
    if ((combined.includes('full name') || combined.includes('candidate name') || (combined.includes('name') && !combined.includes('company') && !combined.includes('user') && !combined.includes('first') && !combined.includes('last') && !combined.includes('school'))) && el.type === 'text') {
      if (el.value !== profile.name) {
        setVal(el, profile.name);
        filledCount++;
        filledSummary.push('Full Name');
      }
      return;
    }

    // Email
    if (combined.includes('email') || el.type === 'email' || combined.includes('addresssection_email')) {
      if (el.value !== profile.email) {
        setVal(el, profile.email);
        filledCount++;
        filledSummary.push('Email');
      }
      return;
    }

    // Phone
    if (combined.includes('phone') || combined.includes('mobile') || combined.includes('cell') || el.type === 'tel' || combined.includes('contact number')) {
      const pVal = (combined.includes('raw') || combined.includes('addresssection')) ? profile.phoneRaw : profile.phone;
      if (el.value !== pVal) {
        setVal(el, pVal);
        filledCount++;
        filledSummary.push('Phone');
      }
      return;
    }

    // Address
    if (combined.includes('address line 1') || combined.includes('addressline1') || combined.includes('street address')) {
      if (!el.value) {
        setVal(el, profile.addressLine1 || profile.location);
        filledCount++;
        filledSummary.push('Address');
      }
      return;
    }

    // City
    if (combined.includes('city') || combined.includes('addresssection_city') || combined.includes('town')) {
      if (!el.value) {
        setVal(el, profile.currentCity);
        filledCount++;
        filledSummary.push('City');
      }
      return;
    }

    // Postal / Zip Code
    if (combined.includes('postal') || combined.includes('zip') || combined.includes('postalcode') || combined.includes('pincode')) {
      if (!el.value) {
        setVal(el, profile.postalCode);
        filledCount++;
        filledSummary.push('Postal Code');
      }
      return;
    }

    // State
    if (combined.includes('state') || combined.includes('province') || combined.includes('countryregion')) {
      if (el.tagName === 'SELECT') {
        matchSelect(el, ['uttar pradesh', 'delhi', 'haryana']);
      } else if (!el.value) {
        setVal(el, profile.state || 'Uttar Pradesh');
      }
      filledCount++;
      return;
    }

    // LinkedIn
    if (combined.includes('linkedin')) {
      if (el.value !== profile.linkedin) {
        setVal(el, profile.linkedin);
        filledCount++;
        filledSummary.push('LinkedIn');
      }
      return;
    }

    // GitHub
    if (combined.includes('github') || combined.includes('git')) {
      if (el.value !== profile.github) {
        setVal(el, profile.github);
        filledCount++;
        filledSummary.push('GitHub');
      }
      return;
    }

    // Portfolio
    if (combined.includes('portfolio') || combined.includes('website') || combined.includes('personal site') || combined.includes('blog') || combined.includes('other website')) {
      if (el.value !== profile.portfolio) {
        setVal(el, profile.portfolio);
        filledCount++;
        filledSummary.push('Portfolio');
      }
      return;
    }

    // LeetCode
    if (combined.includes('leetcode') || combined.includes('competitive') || combined.includes('coding profile')) {
      if (el.value !== profile.leetcode) {
        setVal(el, profile.leetcode);
        filledCount++;
        filledSummary.push('LeetCode');
      }
      return;
    }

    // University
    if (combined.includes('university') || combined.includes('college') || combined.includes('institution') || combined.includes('school')) {
      if (!el.value) {
        setVal(el, profile.education?.institution || 'Indian Institute of Information Technology, Lucknow');
        filledCount++;
        filledSummary.push('University');
      }
      return;
    }

    // Degree
    if (combined.includes('degree') || combined.includes('qualification')) {
      if (el.tagName === 'SELECT') {
        matchSelect(el, ['bachelor', 'b.tech', 'undergraduate', 'btech']);
      } else if (!el.value) {
        setVal(el, profile.education?.degree || 'B.Tech');
      }
      filledCount++;
      filledSummary.push('Degree');
      return;
    }

    // Major
    if (combined.includes('major') || combined.includes('discipline') || combined.includes('field of study') || combined.includes('branch')) {
      if (!el.value) {
        setVal(el, profile.education?.major || 'Computer Science and Artificial Intelligence');
        filledCount++;
        filledSummary.push('Major');
      }
      return;
    }

    // CGPA
    if (combined.includes('cgpa') || combined.includes('gpa') || combined.includes('grade') || combined.includes('marks')) {
      if (!el.value) {
        setVal(el, profile.education?.cgpa || '8.72');
        filledCount++;
        filledSummary.push('CGPA');
      }
      return;
    }

    // Graduation Year
    if (combined.includes('graduat') || combined.includes('end year') || combined.includes('passout') || combined.includes('batch')) {
      if (el.tagName === 'SELECT') {
        matchSelect(el, ['2027', '27']);
      } else if (!el.value) {
        setVal(el, profile.education?.endYear || '2027');
      }
      filledCount++;
      filledSummary.push('Graduation Year');
      return;
    }

    // Current Employer
    if (combined.includes('current company') || combined.includes('employer') || combined.includes('most recent company') || combined.includes('organization')) {
      if (!el.value) {
        setVal(el, profile.currentExperience?.company || 'Coffeee.io');
        filledCount++;
        filledSummary.push('Current Employer');
      }
      return;
    }

    // Current Title
    if (combined.includes('current title') || combined.includes('current role') || combined.includes('designation') || combined.includes('jobtitle')) {
      if (!el.value) {
        setVal(el, profile.currentExperience?.role || 'SDE Intern');
        filledCount++;
        filledSummary.push('Current Title');
      }
      return;
    }

    // Location
    if (combined.includes('location') || combined.includes('current location')) {
      if (!el.value) {
        setVal(el, profile.location);
        filledCount++;
        filledSummary.push('Location');
      }
      return;
    }

    // Work Authorization
    if (combined.includes('authorized to work') || combined.includes('legally authorized') || combined.includes('work permit') || combined.includes('eligible to work')) {
      if (el.type === 'checkbox') {
        el.checked = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (el.type === 'radio') {
        if (!combined.includes('not') && !combined.includes('no')) {
          el.checked = true;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else if (el.tagName === 'SELECT') {
        matchSelect(el, ['yes', 'authorized']);
      }
      filledCount++;
      return;
    }

    // Sponsorship Requirement
    if (combined.includes('sponsorship') || combined.includes('require visa') || combined.includes('require sponsorship')) {
      if (el.type === 'radio') {
        if (combined.includes('no') || labelText.includes('no')) {
          el.checked = true;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else if (el.tagName === 'SELECT') {
        matchSelect(el, ['no']);
      }
      filledCount++;
      return;
    }

    // Notice Period
    if (combined.includes('notice period') || combined.includes('notice')) {
      if (el.tagName === 'SELECT') {
        matchSelect(el, ['immediate', '0', 'less than 15', '1 month']);
      } else if (!el.value) {
        setVal(el, profile.workAuthorization?.noticePeriodText || 'Immediate (0 days)');
      }
      filledCount++;
      filledSummary.push('Notice Period');
      return;
    }

    // Gender
    if (combined.includes('gender')) {
      if (el.tagName === 'SELECT') {
        matchSelect(el, ['male', 'prefer not to say', 'man']);
      }
      return;
    }

    // Signature
    if (combined.includes('signature') || combined.includes('sign here') || combined.includes('type your name')) {
      if (!el.value) {
        setVal(el, profile.name);
        filledCount++;
        filledSummary.push('Signature');
      }
      return;
    }

    // Terms / Consent
    if (el.type === 'checkbox' && (combined.includes('agree') || combined.includes('certif') || combined.includes('consent') || combined.includes('terms') || combined.includes('statement'))) {
      if (!el.checked) {
        el.checked = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        filledCount++;
        filledSummary.push('Agreed to Terms');
      }
      return;
    }

    // Essays / Textareas / Open Questions
    if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text' && combined.length > 25)) {
      if (!el.value || el.value.length < 5) {
        let answer = `I am an ambitious Computer Science & AI student at IIIT Lucknow with production fullstack experience, proven problem-solving track record (LeetCode Guardian 2137), and a strong passion for writing high-performance, clean code.`;
        if (combined.includes('why') && (combined.includes('company') || combined.includes('join') || combined.includes('role'))) {
          answer = `I am drawn to your team because of the exceptional engineering standard and the high scale of your products. At IIIT Lucknow, I have architected resilient systems like MediPulse (125 REST APIs, Kafka, Redis) with strict concurrency guarantees. Contributing as a software engineer would be a thrilling opportunity to deliver high impact from day one.`;
        } else if (combined.includes('challenge') || combined.includes('difficult') || combined.includes('bug')) {
          answer = `While building MediPulse, concurrent OPD appointments caused race conditions and booking conflicts during load tests. I introduced Redis distributed locks with idempotent tokens and transactional rollbacks, backed by Kafka event streams, completely eliminating data anomalies under heavy concurrency.`;
        }
        setVal(el, answer);
        filledCount++;
        filledSummary.push('Humanoid Answer');
      }
    }
  });

  return {
    success: true,
    filledCount,
    filledSummary: [...new Set(filledSummary)]
  };
}
