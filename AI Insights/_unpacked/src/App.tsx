/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, FormEvent, useMemo } from 'react';
import { Search, Building2, MapPin, Info, ExternalLink, Calendar, Users, Hash, Loader2, AlertCircle, Globe, Bookmark, BookmarkCheck, Trash2, Filter, ArrowLeft, ArrowRight, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";
import { useLiveQuery } from 'dexie-react-hooks';
import { BusinessInfo } from './types';
import { db } from './db';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const businessSchema = {
  type: Type.OBJECT,
  properties: {
    companyName: { type: Type.STRING },
    companyNumber: { type: Type.STRING },
    registeredAddress: { type: Type.STRING },
    status: { type: Type.STRING },
    incorporationDate: { type: Type.STRING },
    sicCodes: { type: Type.ARRAY, items: { type: Type.STRING } },
    natureOfBusiness: { type: Type.STRING },
    directors: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          role: { type: Type.STRING }
        }
      }
    },
    lastAccountsDate: { type: Type.STRING },
    confirmationStatementDate: { type: Type.STRING },
    website: { type: Type.STRING },
    digitalLinks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          url: { type: Type.STRING }
        }
      }
    },
    summary: { type: Type.STRING },
    sources: { type: Type.ARRAY, items: { type: Type.STRING } }
  },
  required: ['companyName', 'companyNumber', 'sicCodes', 'summary']
};

export default function App() {
  const [view, setView] = useState<'search' | 'saved'>('search');
  const [name, setName] = useState('');
  const [postcode, setPostcode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [businessData, setBusinessData] = useState<BusinessInfo | null>(null);
  
  // Filtering for saved searches
  const [filterText, setFilterText] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const savedBusinesses = useLiveQuery(() => db.savedBusinesses.toArray());

  const filteredSaved = useMemo(() => {
    if (!savedBusinesses) return [];
    return savedBusinesses.filter(b => {
      const matchesText = b.companyName.toLowerCase().includes(filterText.toLowerCase()) || 
                          b.companyNumber.includes(filterText) ||
                          b.sicCodes.some(s => s.toLowerCase().includes(filterText.toLowerCase()));
      const matchesStatus = statusFilter === 'all' || 
                           (statusFilter === 'active' && b.status.toLowerCase().includes('active')) ||
                           (statusFilter === 'inactive' && !b.status.toLowerCase().includes('active'));
      return matchesText && matchesStatus;
    });
  }, [savedBusinesses, filterText, statusFilter]);

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError(null);
    setBusinessData(null);
    setView('search');

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Find detailed information about the UK business named "${name}" located near postcode "${postcode}". 
        Include data from Companies House, their official website, social media profiles (LinkedIn, X/Twitter, Facebook, Instagram), and other public sources.
        Identify the main official website and list any relevant auxiliary digital links (e.g., trustpilot, glassdoor, or secondary domains).
        Specifically focus on the SIC codes, company status, and directors.
        Be precise with the Company Number and Registered Address.`,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          responseSchema: businessSchema,
          systemInstruction: "You are a professional UK business researcher. You find accurate, up-to-date information about companies in the UK using Google Search. Always verify company numbers and SIC codes. Find as many official digital presence links as possible (Websites, Social Media, Review Sites)."
        }
      });

      const result = JSON.parse(response.text || '{}');
      setBusinessData(result as BusinessInfo);
    } catch (err) {
      console.error(err);
      setError("Failed to fetch business information. Please try again with more specific details.");
    } finally {
      setLoading(false);
    }
  };

  const saveBusiness = async (data: BusinessInfo) => {
    try {
      const exists = await db.savedBusinesses.where('companyNumber').equals(data.companyNumber).first();
      if (exists) {
        alert("This business is already saved.");
        return;
      }
      await db.savedBusinesses.add({
        ...data,
        savedAt: Date.now()
      });
    } catch (err) {
      console.error("Failed to save business:", err);
    }
  };

  const deleteSaved = async (id?: number) => {
    if (!id) return;
    if (confirm("Are you sure you want to remove this saved search?")) {
      await db.savedBusinesses.delete(id);
    }
  };

  const isSaved = useMemo(() => {
    if (!businessData || !savedBusinesses) return false;
    return savedBusinesses.some(b => b.companyNumber === businessData.companyNumber);
  }, [businessData, savedBusinesses]);

  const exportToJson = (data: BusinessInfo) => {
    const fileName = `${data.companyName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_insight.json`;
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-teal-50 text-teal-950 font-sans selection:bg-teal-950 selection:text-white">
      {/* Header */}
      <header className="border-b border-teal-950 p-6 lg:p-10">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="cursor-pointer" onClick={() => setView('search')}>
            <div className="flex items-center gap-3 mb-2">
              <Building2 className="w-8 h-8 text-teal-700" />
              <span className="font-mono text-xs uppercase tracking-widest opacity-50 font-bold">UK Business Intelligence</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tighter uppercase leading-none">
              Insight <br /> Explorer
            </h1>
          </div>
          <div className="flex flex-col md:items-end gap-4">
            <nav className="flex gap-4">
              <button 
                onClick={() => setView('search')}
                className={`font-mono text-xs uppercase tracking-widest px-4 py-2 border-2 border-teal-950 transition-all ${view === 'search' ? 'bg-teal-950 text-white' : 'hover:bg-teal-950/10'}`}
              >
                Search Tool
              </button>
              <button 
                onClick={() => setView('saved')}
                className={`font-mono text-xs uppercase tracking-widest px-4 py-2 border-2 border-teal-950 transition-all flex items-center gap-2 ${view === 'saved' ? 'bg-teal-950 text-white' : 'hover:bg-teal-950/10'}`}
              >
                Archive {savedBusinesses && savedBusinesses.length > 0 && <span className="bg-teal-600 text-white px-1.5 py-0.5 rounded-full text-[10px]">{savedBusinesses.length}</span>}
              </button>
            </nav>
            <p className="font-mono text-xs max-w-xs opacity-70 md:text-right hidden md:block">
              Synthesizing Companies House and open registry data.
            </p>
          </div>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {view === 'search' ? (
          <motion.div 
            key="search-view"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
          >
            {/* Search Section - DARK ON LIGHT */}
            <section className="border-b border-teal-950 bg-white text-teal-950">
              <div className="max-w-7xl mx-auto p-6 lg:px-10 py-12 md:py-20 text-center md:text-left">
                <form onSubmit={handleSearch} className="grid grid-cols-1 md:grid-cols-12 gap-4">
                  <div className="md:col-span-6 relative">
                    <label htmlFor="name" className="absolute -top-6 left-0 font-mono text-[10px] uppercase opacity-50">Business Name</label>
                    <input
                      id="name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Acme Services Ltd"
                      className="w-full bg-transparent border-b-2 border-teal-950 py-4 px-2 text-2xl focus:outline-none focus:border-teal-600 transition-colors placeholder:opacity-20"
                      required
                    />
                  </div>
                  <div className="md:col-span-4 relative">
                    <label htmlFor="postcode" className="absolute -top-6 left-0 font-mono text-[10px] uppercase opacity-50">Address / Postcode</label>
                    <input
                      id="postcode"
                      type="text"
                      value={postcode}
                      onChange={(e) => setPostcode(e.target.value)}
                      placeholder="e.g. SW1A 1AA"
                      className="w-full bg-transparent border-b-2 border-teal-950 py-4 px-2 text-2xl focus:outline-none focus:border-teal-600 transition-colors placeholder:opacity-20"
                    />
                  </div>
                  <div className="md:col-span-2 pt-2 md:pt-0">
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full h-full bg-teal-950 text-white font-bold uppercase tracking-widest text-sm hover:bg-teal-800 active:scale-95 transition-all disabled:opacity-50 py-4 md:py-0"
                    >
                      {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Search'}
                    </button>
                  </div>
                </form>
              </div>
            </section>

            {/* Main Content (Search Results) */}
            <main className="max-w-7xl mx-auto min-h-[50vh]">
              <AnimatePresence mode="wait">
                {loading ? (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="p-20 flex flex-col items-center justify-center text-center gap-6"
                  >
                    <div className="relative">
                      <div className="w-16 h-16 border-4 border-teal-950 border-t-transparent rounded-full animate-spin"></div>
                      <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] font-bold">AI</div>
                    </div>
                    <div>
                      <p className="font-mono text-xs uppercase tracking-widest mb-1">Synthesizing Records</p>
                      <p className="text-xl font-medium italic opacity-60 font-serif">Consulting data layers...</p>
                    </div>
                  </motion.div>
                ) : error ? (
                  <motion.div
                    key="error"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-10 md:p-20 flex flex-col items-center text-center text-red-600 gap-4"
                  >
                    <AlertCircle size={48} />
                    <p className="text-2xl font-serif italic">{error}</p>
                    <button onClick={() => setError(null)} className="font-mono text-xs underline uppercase tracking-widest">Clear and try again</button>
                  </motion.div>
                ) : businessData ? (
                  <motion.div
                    key="results"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="animate-in fade-in duration-700"
                  >
                    {/* Results Actions */}
                    <div className="border-b border-teal-950 p-4 flex justify-end gap-3">
                      <button 
                        onClick={() => exportToJson(businessData)}
                        className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-tighter px-4 py-2 border border-teal-950 hover:bg-white transition-all shadow-sm"
                      >
                        <Download size={14} />
                        Export JSON
                      </button>
                      <button 
                        onClick={() => saveBusiness(businessData)}
                        disabled={isSaved}
                        className={`flex items-center gap-2 font-mono text-[10px] uppercase tracking-tighter px-4 py-2 border border-teal-950 transition-all ${isSaved ? 'bg-teal-950 text-white' : 'hover:bg-white shadow-sm'}`}
                      >
                        {isSaved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                        {isSaved ? 'Already in Archive' : 'Save to Archive'}
                      </button>
                    </div>

                    {/* Summary Bar */}
                    <div className="grid grid-cols-1 md:grid-cols-3 border-b border-teal-950">
                      <div className="p-8 border-b md:border-b-0 md:border-r border-teal-950">
                        <p className="font-mono text-[10px] uppercase opacity-50 mb-4">Official Identification</p>
                        <h2 className="text-2xl font-bold uppercase mb-2 leading-tight">{businessData.companyName}</h2>
                        <div className="flex items-center gap-2 font-mono text-sm">
                          <Hash size={14} className="opacity-50" />
                          <span>{businessData.companyNumber}</span>
                        </div>
                      </div>
                      <div className="p-8 border-b md:border-b-0 md:border-r border-teal-950 bg-teal-100/30">
                        <p className="font-mono text-[10px] uppercase opacity-50 mb-4">Live Status</p>
                        <div className="flex items-center gap-2 bg-teal-950 text-white px-3 py-1 w-fit rounded-full text-xs font-bold uppercase tracking-wider mb-2">
                          <div className={`w-2 h-2 rounded-full ${businessData.status?.toLowerCase().includes('active') ? 'bg-green-400' : 'bg-red-400 shadow-[0_0_8px_red]'}`}></div>
                          {businessData.status}
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs flex items-center gap-2"><Calendar size={12} className="opacity-50" /> Inc: {businessData.incorporationDate}</p>
                          <p className="text-xs flex items-center gap-2 font-serif italic"><Info size={12} className="opacity-50" /> {businessData.natureOfBusiness}</p>
                        </div>
                      </div>
                      <div className="p-8">
                        <p className="font-mono text-[10px] uppercase opacity-50 mb-4">Contact Info</p>
                        <div className="flex items-start gap-2 mb-4">
                          <MapPin size={16} className="mt-1 flex-shrink-0 opacity-50" />
                          <p className="text-sm font-medium">{businessData.registeredAddress}</p>
                        </div>
                        {businessData.website && (
                          <a href={businessData.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm hover:underline font-mono mb-2 text-teal-800 font-bold">
                            <Globe size={14} className="opacity-70" /> Main Website <ExternalLink size={12} />
                          </a>
                        )}
                        {businessData.digitalLinks && businessData.digitalLinks.length > 0 && (
                          <div className="space-y-1.5 mt-3 pt-3 border-t border-teal-950/10">
                            <p className="font-mono text-[9px] uppercase opacity-40 mb-1">Extended Presence</p>
                            <div className="flex flex-col gap-1.5">
                              {businessData.digitalLinks.map((link, idx) => (
                                <a 
                                  key={idx} 
                                  href={link.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  className="text-[11px] font-mono hover:underline flex items-center justify-between group text-teal-900"
                                >
                                  <span className="opacity-70 group-hover:opacity-100">{link.label}</span>
                                  <ExternalLink size={10} className="opacity-30 group-hover:opacity-100" />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Details Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-2">
                      <div className="p-8 border-b lg:border-b-0 lg:border-r border-teal-950">
                        <h3 className="font-serif italic text-3xl mb-6">SIC Classifications</h3>
                        <div className="flex flex-wrap gap-2">
                          {businessData.sicCodes.map((code, idx) => (
                            <div key={idx} className="bg-teal-950 text-white px-4 py-3 border border-teal-950 hover:bg-white hover:text-teal-950 transition-colors cursor-default group flex flex-col">
                              <span className="font-mono text-xl font-bold">{code.split(' - ')[0]}</span>
                              <span className="text-[10px] uppercase tracking-tighter opacity-70 max-w-[120px] leading-tight mt-1">{code.split(' - ')[1] || 'Industrial Code'}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-10 p-6 border border-teal-950 rounded-sm bg-white/50">
                          <p className="font-mono text-[10px] uppercase opacity-50 mb-2">Researcher Analytics</p>
                          <p className="text-sm leading-relaxed whitespace-pre-line">{businessData.summary}</p>
                        </div>
                      </div>

                      <div className="p-8">
                        <h3 className="font-serif italic text-3xl mb-6">Management Structure</h3>
                        <div className="space-y-1">
                          <div className="grid grid-cols-6 mb-2 border-b border-teal-950 pb-2">
                            <div className="col-span-4 font-mono text-[10px] uppercase opacity-50 italic">Full Name / Entity</div>
                            <div className="col-span-2 font-mono text-[10px] uppercase opacity-50 italic text-right">Appointed Role</div>
                          </div>
                          {businessData.directors.map((director, idx) => (
                            <div key={idx} className="grid grid-cols-6 py-4 border-b border-teal-950/10 hover:bg-white/40 transition-colors px-1 group">
                              <div className="col-span-4 flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-teal-950 text-white flex items-center justify-center font-mono text-xs">
                                   {director.name.charAt(0)}
                                </div>
                                <span className="font-bold tracking-tight uppercase group-hover:underline cursor-default">{director.name}</span>
                              </div>
                              <div className="col-span-2 flex items-center justify-end text-right">
                                <span className="font-mono text-[10px] bg-teal-950 text-white px-2 py-0.5 rounded-sm uppercase">{director.role}</span>
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="mt-12">
                          <p className="font-mono text-[10px] uppercase opacity-50 mb-3 border-b border-teal-950 pb-1">Verified Data Sources</p>
                          <div className="flex flex-wrap gap-2">
                            {businessData.sources.map((source, idx) => (
                              <div key={idx} className="text-[10px] font-mono border border-teal-950 px-2 py-1 rounded-sm opacity-60 hover:opacity-100 transition-opacity whitespace-nowrap">
                                {source}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <div className="flex flex-col items-center justify-center p-20 opacity-10 select-none pointer-events-none">
                    <Search size={120} strokeWidth={0.5} />
                    <p className="font-mono text-sm uppercase tracking-widest mt-4 italic">Awaiting Search Query</p>
                  </div>
                )}
              </AnimatePresence>
            </main>
          </motion.div>
        ) : (
          <motion.div 
            key="saved-view"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            {/* Archive Management Screen */}
            <section className="bg-teal-950 text-white border-b border-teal-950">
               <div className="max-w-7xl mx-auto p-6 lg:p-10 flex flex-col md:flex-row justify-between items-center gap-6">
                 <div>
                   <h2 className="text-3xl font-bold uppercase tracking-tighter">Business Archive</h2>
                   <p className="font-mono text-[10px] uppercase opacity-50">Managing saved intelligence entries</p>
                 </div>
                 <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto">
                    <div className="relative flex-grow min-w-[300px]">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
                      <input 
                        type="text" 
                        placeholder="Filter by name, number, SIC..." 
                        value={filterText}
                        onChange={(e) => setFilterText(e.target.value)}
                        className="w-full bg-white/10 border border-white/20 rounded-sm py-2 pl-10 pr-4 font-mono text-xs focus:bg-white/20 outline-none transition-all"
                      />
                    </div>
                    <div className="flex gap-2">
                       <button 
                        onClick={() => setStatusFilter('all')}
                        className={`font-mono text-[10px] border border-white/20 px-3 py-2 rounded-sm uppercase tracking-widest transition-all ${statusFilter === 'all' ? 'bg-white text-teal-950' : 'hover:bg-white/10'}`}
                       >
                         All
                       </button>
                       <button 
                        onClick={() => setStatusFilter('active')}
                        className={`font-mono text-[10px] border border-white/20 px-3 py-2 rounded-sm uppercase tracking-widest transition-all ${statusFilter === 'active' ? 'bg-white text-teal-950' : 'hover:bg-white/10'}`}
                       >
                         Active Only
                       </button>
                    </div>
                 </div>
               </div>
            </section>

            <main className="max-w-7xl mx-auto p-6 lg:p-10">
              {filteredSaved.length === 0 ? (
                <div className="p-20 text-center opacity-30 flex flex-col items-center gap-4">
                  <Filter size={64} strokeWidth={1} />
                  <div>
                    <h3 className="font-serif italic text-2xl">No matching records found</h3>
                    <p className="font-mono text-[10px] uppercase tracking-widest mt-2">{savedBusinesses?.length === 0 ? 'Archive is currently empty.' : 'Try adjusting your filters.'}</p>
                  </div>
                  {savedBusinesses?.length === 0 && (
                    <button onClick={() => setView('search')} className="mt-4 font-mono text-xs underline uppercase tracking-widest pointer-events-auto">Start a search</button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {filteredSaved.map((b) => (
                    <motion.div 
                      key={b.id} 
                      layout
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="bg-white border border-teal-950 flex flex-col group relative overflow-hidden"
                    >
                       <div className="p-6 border-b border-teal-950">
                         <div className="flex justify-between items-start mb-2">
                            <span className="font-mono text-[9px] uppercase bg-teal-950 text-white px-1.5 py-0.5">{b.companyNumber}</span>
                            <div className="flex gap-2">
                               <button 
                                onClick={() => exportToJson(b)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-teal-950 hover:text-white border border-teal-950"
                                title="Export JSON"
                               >
                                 <Download size={14} />
                               </button>
                               <button 
                                onClick={() => {
                                  setBusinessData(b);
                                  setView('search');
                                }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-teal-950 hover:text-white border border-teal-950"
                                title="View Details"
                               >
                                 <ArrowRight size={14} />
                               </button>
                               <button 
                                onClick={() => deleteSaved(b.id)}
                                className="p-1.5 hover:bg-red-600 hover:text-white border border-teal-950 transition-all font-bold"
                                title="Remove from Archive"
                               >
                                 <Trash2 size={14} />
                               </button>
                            </div>
                         </div>
                         <h4 className="text-xl font-bold uppercase leading-tight mb-1 text-teal-950">{b.companyName}</h4>
                         <p className="text-[10px] font-mono opacity-50 uppercase">{new Date(b.savedAt).toLocaleDateString()} • Saved at {new Date(b.savedAt).toLocaleTimeString()}</p>
                       </div>
                       
                       <div className="p-6 flex-grow bg-teal-50/50">
                          <div className={`text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 mb-3 ${b.status.toLowerCase().includes('active') ? 'text-teal-700' : 'text-red-600'}`}>
                             <div className={`w-1.5 h-1.5 rounded-full ${b.status.toLowerCase().includes('active') ? 'bg-teal-600' : 'bg-red-600 animate-pulse'}`}></div>
                             {b.status}
                          </div>
                          <div className="space-y-2 mb-4">
                            <div className="flex items-start gap-2">
                              <MapPin size={12} className="opacity-50 mt-0.5 flex-shrink-0" />
                              <p className="text-[10px] line-clamp-2">{b.registeredAddress}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Info size={12} className="opacity-50" />
                              <p className="text-[10px] font-serif italic line-clamp-1">{b.natureOfBusiness}</p>
                            </div>
                            {b.digitalLinks && b.digitalLinks.length > 0 && (
                              <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2 border-t border-teal-950/5 mt-2">
                                {b.digitalLinks.slice(0, 3).map((link, i) => (
                                  <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="text-[9px] font-mono opacity-60 hover:opacity-100 hover:underline flex items-center gap-1 text-teal-800">
                                    {link.label} <ExternalLink size={8} />
                                  </a>
                                ))}
                                {b.digitalLinks.length > 3 && <span className="text-[9px] font-mono opacity-30">+{b.digitalLinks.length - 3}</span>}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1">
                             {b.sicCodes.slice(0, 3).map((s, i) => (
                               <span key={i} className="text-[8px] font-mono bg-teal-950/10 px-1.5 py-0.5 rounded-sm">{s.split(' - ')[0]}</span>
                             ))}
                             {b.sicCodes.length > 3 && <span className="text-[8px] font-mono opacity-50 ml-1">+{b.sicCodes.length - 3} more</span>}
                          </div>
                       </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </main>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="border-t border-teal-950 p-10 mt-20 bg-teal-100/50">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-600"></div>
            <div className="w-4 h-4 bg-white border border-teal-950"></div>
            <div className="w-4 h-4 bg-teal-800"></div>
            <span className="font-mono text-[10px] ml-2 font-bold uppercase">UK Integrated Data Mesh</span>
          </div>
          <div className="flex gap-6 items-center">
            {view === 'saved' && (
               <button onClick={() => setView('search')} className="font-mono text-[10px] uppercase hover:underline flex items-center gap-2 text-teal-800 font-bold">
                 <ArrowLeft size={12} /> Back to Investigation
               </button>
            )}
            <p className="font-mono text-[10px] opacity-50">
              Powered by Google Gemini 3 Flash and Public Business Registries.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
