/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Trophy, 
  Users, 
  Zap, 
  PlusCircle, 
  TrendingUp, 
  ChevronRight,
  Star,
  ShieldCheck,
  CreditCard,
  LogOut,
  LayoutDashboard
} from "lucide-react";
import { auth, db, signInWithGoogle, logout } from "./firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, onSnapshot, query, limit, doc, setDoc, getDoc, addDoc, serverTimestamp, updateDoc, orderBy, getDocFromServer } from "firebase/firestore";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error?.message || "");
        if (parsed.error) errorMessage = `Firebase Error: ${parsed.error}`;
      } catch (e) {
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen bg-bg flex items-center justify-center p-6 text-center">
          <div className="max-w-md bg-card border border-white/10 rounded-[2rem] p-10">
            <h2 className="text-2xl font-black uppercase italic text-primary mb-4">Error Detected</h2>
            <p className="text-white/60 mb-8">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-8 py-3 bg-primary text-white font-black uppercase rounded-xl shadow-lg shadow-primary/20"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [matches, setMatches] = useState<any[]>([]);
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [playerStats, setPlayerStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState<any>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<any>(null);
  const [matchTab, setMatchTab] = useState<"scorecard" | "commentary">("scorecard");
  const [profileData, setProfileData] = useState({
    bio: "",
    location: ""
  });
  const [newMatch, setNewMatch] = useState({
    teamA: "",
    teamB: "",
    scoreA: "0/0",
    oversA: "0.0"
  });

  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Sync user to Firestore
        const userRef = doc(db, "users", currentUser.uid);
        const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            const newUser = {
              uid: currentUser.uid,
              displayName: currentUser.displayName || "Anonymous",
              email: currentUser.email,
              photoURL: currentUser.photoURL,
              role: "player",
              createdAt: new Date().toISOString()
            };
            await setDoc(userRef, newUser);
          } else {
            setProfileData({
              bio: userSnap.data().bio || "",
              location: userSnap.data().location || ""
            });
          }

          // Sync player stats
          const statsRef = doc(db, "players", currentUser.uid, "stats", "global");
          const statsSnap = await getDoc(statsRef);
          if (statsSnap.exists()) {
            setPlayerStats(statsSnap.data());
          } else {
            // Initialize empty stats
            const initialStats = {
              playerId: currentUser.uid,
              batting: { matches: 0, runs: 0, highestScore: 0, average: 0, strikeRate: 0 },
              bowling: { wickets: 0, economy: 0, bestBowling: "0/0" }
            };
            await setDoc(statsRef, initialStats);
            setPlayerStats(initialStats);
          }
        }
      setLoading(false);
    });

    // Real-time matches listener
    const q = query(collection(db, "matches"), orderBy("createdAt", "desc"), limit(5));
    const unsubMatches = onSnapshot(q, (snapshot) => {
      const matchData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMatches(matchData);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "matches");
    });

    // Real-time tournaments listener
    const qTournaments = query(collection(db, "tournaments"), limit(5));
    const unsubTournaments = onSnapshot(qTournaments, (snapshot) => {
      const tournamentData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTournaments(tournamentData);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "tournaments");
    });

    return () => {
      unsubscribe();
      unsubMatches();
      unsubTournaments();
    };
  }, []);

  const handleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user') {
        console.warn("User closed the sign-in popup.");
      } else {
        console.error("Login failed:", err);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleCreateMatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const path = "matches";
    try {
      await addDoc(collection(db, path), {
        teamA: { name: newMatch.teamA },
        teamB: { name: newMatch.teamB },
        scoreA: newMatch.scoreA,
        oversA: newMatch.oversA,
        status: "live",
        createdAt: serverTimestamp(),
        adminId: user.uid
      });
      setShowCreateModal(false);
      setNewMatch({ teamA: "", teamB: "", scoreA: "0/0", oversA: "0.0" });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleUpdateScore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showUpdateModal) return;
    const path = `matches/${showUpdateModal.id}`;
    try {
      const matchRef = doc(db, "matches", showUpdateModal.id);
      await updateDoc(matchRef, {
        scoreA: showUpdateModal.scoreA,
        oversA: showUpdateModal.oversA
      });
      setShowUpdateModal(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const path = `users/${user.uid}`;
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        bio: profileData.bio,
        location: profileData.location
      });
      setShowProfileModal(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-bg text-white font-sans selection:bg-primary selection:text-white">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 bg-bg/80 backdrop-blur-md border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
              <Zap className="text-white fill-white" size={24} />
            </div>
            <span className="text-2xl font-black tracking-tighter italic uppercase">Apna Cricket</span>
          </div>
          
          <div className="hidden md:flex items-center gap-8 text-sm font-medium uppercase tracking-widest text-white/60">
            <a href="#matches" className="hover:text-primary transition-colors">Matches</a>
            <a href="#tournaments" className="hover:text-primary transition-colors">Tournaments</a>
            <a href="#" className="hover:text-primary transition-colors">Stats</a>
            <a href="#" className="hover:text-primary transition-colors">Scout</a>
          </div>

          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setShowProfileModal(true)}
                  className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-full border border-white/10 hover:bg-white/10 transition-colors"
                >
                  <img src={user.photoURL || ""} className="w-6 h-6 rounded-full" alt="Avatar" referrerPolicy="no-referrer" />
                  <span className="text-xs font-bold">{user.displayName}</span>
                </button>
                <button onClick={logout} className="p-2 hover:text-primary transition-colors">
                  <LogOut size={20} />
                </button>
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                disabled={isLoggingIn}
                className="px-6 py-2 rounded-full bg-primary text-white text-sm font-black hover:scale-105 transition-transform disabled:opacity-50 disabled:scale-100 shadow-lg shadow-primary/20"
              >
                {isLoggingIn ? "Signing in..." : "Login with Google"}
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-40 pb-20 px-6 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full pointer-events-none">
          <div className="absolute top-40 left-1/4 w-96 h-96 bg-primary/10 blur-[120px] rounded-full" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-accent/10 blur-[120px] rounded-full" />
        </div>

        <div className="max-w-7xl mx-auto relative">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-3xl"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-accent text-xs font-bold uppercase tracking-widest mb-6">
              <Star size={14} /> The Future of Local Cricket
            </div>
            <h1 className="text-7xl md:text-9xl font-black leading-[0.9] tracking-tighter uppercase mb-8">
              Your Game. <br />
              <span className="text-gradient-red">Your Legacy.</span>
            </h1>
            <p className="text-xl text-white/60 max-w-xl mb-10 leading-relaxed">
              The ultimate platform for rural talent discovery. Digital identities, real-time stats, and tournament management for the next generation of champions.
            </p>
            <div className="flex flex-wrap gap-4">
              <button className="px-8 py-4 rounded-2xl bg-primary text-white font-black text-lg flex items-center gap-2 hover:rotate-[-2deg] transition-all shadow-xl shadow-primary/20">
                Create Tournament <PlusCircle size={20} />
              </button>
              <button className="px-8 py-4 rounded-2xl bg-white/5 border border-white/10 font-bold text-lg hover:bg-white/10 transition-all">
                Explore Matches
              </button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Live Matches Section */}
      <section id="matches" className="py-20 px-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-12">
          <h2 className="text-4xl font-black uppercase italic tracking-tighter">Live Matches</h2>
          <div className="flex items-center gap-2 text-primary animate-pulse">
            <div className="w-2 h-2 bg-primary rounded-full" />
            <span className="text-xs font-black uppercase tracking-widest">Live Now</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {matches.length > 0 ? (
            matches.map((match) => (
              <motion.div 
                key={match.id}
                whileHover={{ scale: 1.02 }}
                className="bg-card border border-white/5 rounded-[2rem] p-8 relative overflow-hidden group"
              >
                <div className="flex justify-between items-center mb-6">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Match #{match.id.slice(0,4)}</span>
                  <div className="px-2 py-1 bg-primary/10 text-primary text-[10px] font-black uppercase rounded">Live</div>
                </div>
                <div className="flex justify-between items-center gap-4">
                  <div className="text-center flex-1">
                    <div className="w-16 h-16 bg-white/5 rounded-full mx-auto mb-3 flex items-center justify-center text-2xl font-black italic">
                      {match.teamA?.name?.[0] || 'A'}
                    </div>
                    <h4 className="font-black uppercase text-sm">{match.teamA?.name || 'Team A'}</h4>
                  </div>
                  <div className="text-2xl font-black italic text-white/20">VS</div>
                  <div className="text-center flex-1">
                    <div className="w-16 h-16 bg-white/5 rounded-full mx-auto mb-3 flex items-center justify-center text-2xl font-black italic">
                      {match.teamB?.name?.[0] || 'B'}
                    </div>
                    <h4 className="font-black uppercase text-sm">{match.teamB?.name || 'Team B'}</h4>
                  </div>
                </div>
                <div className="mt-8 pt-6 border-t border-white/5 flex justify-between items-center">
                  <div className="text-2xl font-black text-primary">{match.scoreA || '0/0'} <span className="text-[10px] text-white/40 ml-1">({match.oversA || '0.0'})</span></div>
                  <div className="flex gap-2">
                    {user?.uid === match.adminId && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); setShowUpdateModal(match); }}
                        className="px-4 py-1.5 bg-primary text-white text-[10px] font-black uppercase rounded-full hover:scale-105 transition-transform"
                      >
                        Update
                      </button>
                    )}
                    <button 
                      onClick={() => setSelectedMatch(match)}
                      className="p-2 bg-white/5 rounded-full hover:text-primary transition-colors"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))
          ) : (
            <div className="col-span-full py-20 text-center bg-card rounded-[2rem] border border-dashed border-white/10">
              <p className="text-white/30 font-bold uppercase tracking-widest">No live matches at the moment</p>
              <button 
                onClick={() => user ? setShowCreateModal(true) : handleLogin()}
                className="mt-4 text-primary text-sm font-black uppercase hover:underline"
              >
                {user ? "Start a match" : "Login to start a match"}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Tournaments Section */}
      <section id="tournaments" className="py-20 px-6 max-w-7xl mx-auto border-t border-white/5">
        <div className="flex items-center justify-between mb-12">
          <h2 className="text-4xl font-black uppercase italic tracking-tighter">Active Tournaments</h2>
          <button className="text-primary text-xs font-black uppercase tracking-widest hover:underline">View All</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {tournaments.length > 0 ? (
            tournaments.map((t) => (
              <motion.div 
                key={t.id}
                whileHover={{ y: -5 }}
                className="bg-card border border-white/5 rounded-[2.5rem] p-10 flex flex-col md:flex-row gap-8 group"
              >
                <div className="w-full md:w-40 h-40 bg-white/5 rounded-2xl overflow-hidden flex-shrink-0">
                  <img src={t.bannerUrl || `https://picsum.photos/seed/${t.id}/400/400`} className="w-full h-full object-cover opacity-50 group-hover:opacity-100 transition-opacity" alt="Tournament" referrerPolicy="no-referrer" />
                </div>
                <div className="flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-black uppercase rounded">{t.status}</span>
                      <span className="text-white/40 text-[10px] font-bold uppercase tracking-widest">{t.location}</span>
                    </div>
                    <h3 className="text-3xl font-black uppercase italic mb-2">{t.name}</h3>
                    <p className="text-white/50 text-sm line-clamp-2">{t.description || "A professional cricket tournament for local talent discovery."}</p>
                  </div>
                  <div className="mt-6 flex items-center justify-between">
                    <div className="text-xs font-bold text-white/30 uppercase tracking-widest">
                      Prize Pool: <span className="text-accent">{t.prizePool || "₹50,000"}</span>
                    </div>
                    <button className="px-6 py-2 bg-white/5 border border-white/10 rounded-full text-[10px] font-black uppercase hover:bg-primary hover:text-white transition-all">Join Now</button>
                  </div>
                </div>
              </motion.div>
            ))
          ) : (
            <div className="col-span-full py-20 text-center bg-card rounded-[2rem] border border-dashed border-white/10">
              <p className="text-white/30 font-bold uppercase tracking-widest">No active tournaments</p>
              <button className="mt-4 text-primary text-sm font-black uppercase hover:underline">Create a tournament</button>
            </div>
          )}
        </div>
      </section>

      {/* Create Match Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCreateModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-lg bg-card border border-white/10 rounded-[2.5rem] p-10 shadow-2xl"
            >
              <h3 className="text-3xl font-black uppercase italic italic mb-8">Start Live Match</h3>
              <form onSubmit={handleCreateMatch} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-white/40">Team A Name</label>
                    <input 
                      required
                      value={newMatch.teamA}
                      onChange={e => setNewMatch({...newMatch, teamA: e.target.value})}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-primary outline-none transition-colors"
                      placeholder="e.g. Mumbai Indians"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-white/40">Team B Name</label>
                    <input 
                      required
                      value={newMatch.teamB}
                      onChange={e => setNewMatch({...newMatch, teamB: e.target.value})}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-primary outline-none transition-colors"
                      placeholder="e.g. CSK"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-white/40">Current Score (A)</label>
                    <input 
                      value={newMatch.scoreA}
                      onChange={e => setNewMatch({...newMatch, scoreA: e.target.value})}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-primary outline-none transition-colors"
                      placeholder="0/0"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-white/40">Overs (A)</label>
                    <input 
                      value={newMatch.oversA}
                      onChange={e => setNewMatch({...newMatch, oversA: e.target.value})}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-primary outline-none transition-colors"
                      placeholder="0.0"
                    />
                  </div>
                </div>
                <div className="flex gap-4 pt-4">
                  <button 
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="flex-1 py-4 rounded-2xl border border-white/10 font-bold hover:bg-white/5 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-4 rounded-2xl bg-primary text-white font-black uppercase tracking-tighter hover:scale-[1.02] transition-transform shadow-lg shadow-primary/20"
                  >
                    Go Live
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Match Details Modal */}
      <AnimatePresence>
        {selectedMatch && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedMatch(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-2xl bg-card border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl"
            >
              <div className="bg-primary p-8 text-white">
                <div className="flex justify-between items-start mb-6">
                  <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Match Details</span>
                  <button onClick={() => setSelectedMatch(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                    <PlusCircle className="rotate-45" size={24} />
                  </button>
                </div>
                <div className="flex justify-between items-center gap-8">
                  <div className="text-center flex-1">
                    <div className="text-4xl font-black italic mb-1">{selectedMatch.teamA?.name}</div>
                    <div className="text-sm font-bold opacity-60 uppercase tracking-widest">Team A</div>
                  </div>
                  <div className="text-2xl font-black italic opacity-20">VS</div>
                  <div className="text-center flex-1">
                    <div className="text-4xl font-black italic mb-1">{selectedMatch.teamB?.name}</div>
                    <div className="text-sm font-bold opacity-60 uppercase tracking-widest">Team B</div>
                  </div>
                </div>
              </div>

              <div className="p-8">
                <div className="flex gap-4 mb-8 border-b border-white/10 pb-4">
                  <button 
                    onClick={() => setMatchTab("scorecard")}
                    className={`text-sm font-black uppercase tracking-widest transition-colors ${matchTab === "scorecard" ? "text-primary" : "text-white/40 hover:text-white"}`}
                  >
                    Scorecard
                  </button>
                  <button 
                    onClick={() => setMatchTab("commentary")}
                    className={`text-sm font-black uppercase tracking-widest transition-colors ${matchTab === "commentary" ? "text-primary" : "text-white/40 hover:text-white"}`}
                  >
                    Commentary
                  </button>
                </div>

                <div className="min-h-[300px]">
                  {matchTab === "scorecard" ? (
                    <div className="space-y-4">
                      <div className="flex justify-between items-center p-4 bg-white/5 rounded-2xl border border-white/5">
                        <span className="font-bold uppercase text-xs">Current Score</span>
                        <span className="text-xl font-black text-primary">{selectedMatch.scoreA} ({selectedMatch.oversA})</span>
                      </div>
                      <p className="text-white/30 text-center py-10 uppercase text-xs font-bold tracking-widest">Detailed scorecard coming soon...</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="p-4 bg-white/5 rounded-2xl border-l-4 border-primary">
                        <div className="text-[10px] font-black text-primary uppercase mb-1">Over 18.2</div>
                        <p className="text-sm">Great shot! Boundary through the covers. The crowd is going wild!</p>
                      </div>
                      <p className="text-white/30 text-center py-10 uppercase text-xs font-bold tracking-widest">Live commentary starting soon...</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showUpdateModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowUpdateModal(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-lg bg-card border border-white/10 rounded-[2.5rem] p-10 shadow-2xl"
            >
              <h3 className="text-3xl font-black uppercase italic mb-8">Update Score</h3>
              <form onSubmit={handleUpdateScore} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-white/40">Current Score</label>
                    <input 
                      required
                      value={showUpdateModal.scoreA}
                      onChange={e => setShowUpdateModal({...showUpdateModal, scoreA: e.target.value})}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-primary outline-none transition-colors"
                      placeholder="e.g. 145/4"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-white/40">Overs</label>
                    <input 
                      required
                      value={showUpdateModal.oversA}
                      onChange={e => setShowUpdateModal({...showUpdateModal, oversA: e.target.value})}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-primary outline-none transition-colors"
                      placeholder="e.g. 18.2"
                    />
                  </div>
                </div>
                <div className="flex gap-4 pt-4">
                  <button 
                    type="button"
                    onClick={() => setShowUpdateModal(null)}
                    className="flex-1 py-4 rounded-2xl border border-white/10 font-bold hover:bg-white/5 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-4 rounded-2xl bg-primary text-white font-black uppercase tracking-tighter hover:scale-[1.02] transition-transform shadow-lg shadow-primary/20"
                  >
                    Update
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Profile Modal */}
      <AnimatePresence>
        {showProfileModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowProfileModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-lg bg-card border border-white/10 rounded-[2.5rem] p-10 shadow-2xl"
            >
              <div className="flex items-center gap-4 mb-8">
                <img src={user?.photoURL || ""} className="w-16 h-16 rounded-2xl" alt="Avatar" referrerPolicy="no-referrer" />
                <div>
                  <h3 className="text-2xl font-black uppercase italic leading-none">{user?.displayName}</h3>
                  <p className="text-white/40 text-xs mt-1">{user?.email}</p>
                </div>
              </div>

              {/* Player Stats Display */}
              {playerStats && (
                <div className="grid grid-cols-3 gap-4 mb-8">
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
                    <div className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">Runs</div>
                    <div className="text-xl font-black text-accent">{playerStats.batting?.runs || 0}</div>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
                    <div className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">Wickets</div>
                    <div className="text-xl font-black text-accent">{playerStats.bowling?.wickets || 0}</div>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
                    <div className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">Avg</div>
                    <div className="text-xl font-black text-accent">{playerStats.batting?.average || 0}</div>
                  </div>
                </div>
              )}

              <form onSubmit={handleUpdateProfile} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-white/40">Your Location</label>
                  <input 
                    value={profileData.location}
                    onChange={e => setProfileData({...profileData, location: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-primary outline-none transition-colors"
                    placeholder="e.g. Mumbai, India"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-white/40">Bio / Playing Style</label>
                  <textarea 
                    value={profileData.bio}
                    onChange={e => setProfileData({...profileData, bio: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-primary outline-none transition-colors min-h-[100px] resize-none"
                    placeholder="e.g. Right-hand top order batsman, Leg spinner..."
                  />
                </div>
                <div className="flex gap-4 pt-4">
                  <button 
                    type="button"
                    onClick={() => setShowProfileModal(false)}
                    className="flex-1 py-4 rounded-2xl border border-white/10 font-bold hover:bg-white/5 transition-all"
                  >
                    Close
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-4 rounded-2xl bg-primary text-white font-black uppercase tracking-tighter hover:scale-[1.02] transition-transform shadow-lg shadow-primary/20"
                  >
                    Save Profile
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <section className="py-20 px-6 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Feature 1 */}
          <motion.div 
            whileHover={{ y: -5 }}
            className="md:col-span-2 bg-card border border-white/5 rounded-[2.5rem] p-10 flex flex-col justify-between overflow-hidden relative group"
          >
            <div className="relative z-10">
              <div className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center mb-6">
                <TrendingUp className="text-primary" size={28} />
              </div>
              <h3 className="text-4xl font-black mb-4 uppercase italic">Real-Time Stats</h3>
              <p className="text-white/50 text-lg max-w-md">
                Every run, every wicket, recorded instantly. Build your digital career profile with pro-level analytics.
              </p>
            </div>
            <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="mt-12 flex items-end justify-between">
              <div className="flex -space-x-4">
                {[1,2,3,4].map(i => (
                  <div key={i} className="w-12 h-12 rounded-full border-4 border-card bg-gray-800 overflow-hidden">
                    <img src={`https://picsum.photos/seed/player${i}/100/100`} alt="Player" referrerPolicy="no-referrer" />
                  </div>
                ))}
                <div className="w-12 h-12 rounded-full border-4 border-card bg-primary text-white flex items-center justify-center font-bold text-xs">
                  +2k
                </div>
              </div>
              <ChevronRight className="text-white/20 group-hover:text-primary transition-colors" size={40} />
            </div>
          </motion.div>

          {/* Feature 2 */}
          <motion.div 
            whileHover={{ y: -5 }}
            className="bg-primary rounded-[2.5rem] p-10 flex flex-col justify-between text-white shadow-2xl shadow-primary/20"
          >
            <div>
              <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center mb-6">
                <Trophy className="text-white" size={28} />
              </div>
              <h3 className="text-4xl font-black mb-4 uppercase italic leading-none">Tournament Admin</h3>
              <p className="text-white/80 text-lg font-medium">
                Manage teams, fixtures, and points tables with ease.
              </p>
            </div>
            <div className="mt-12">
              <button className="w-full py-4 bg-white text-primary rounded-2xl font-black uppercase tracking-tighter hover:scale-[1.02] transition-transform">
                Get Started
              </button>
            </div>
          </motion.div>

          {/* Feature 3 */}
          <motion.div 
            whileHover={{ y: -5 }}
            className="bg-card border border-white/5 rounded-[2.5rem] p-10 flex flex-col justify-between"
          >
            <div className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center mb-6">
              <ShieldCheck className="text-accent" size={28} />
            </div>
            <h3 className="text-3xl font-black mb-4 uppercase italic">Digital Identity</h3>
            <p className="text-white/50">
              Verified profiles for rural players to get discovered by scouts and sponsors.
            </p>
          </motion.div>

          {/* Feature 4 */}
          <motion.div 
            whileHover={{ y: -5 }}
            className="bg-card border border-white/5 rounded-[2.5rem] p-10 flex flex-col justify-between"
          >
            <div className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center mb-6">
              <CreditCard className="text-accent" size={28} />
            </div>
            <h3 className="text-3xl font-black mb-4 uppercase italic">Easy Payments</h3>
            <p className="text-white/50">
              Integrated payment systems for tournament registrations and prize distributions.
            </p>
          </motion.div>

          {/* Feature 5 */}
          <motion.div 
            whileHover={{ y: -5 }}
            className="bg-card border border-white/5 rounded-[2.5rem] p-10 flex flex-col justify-between"
          >
            <div className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center mb-6">
              <Users className="text-accent" size={28} />
            </div>
            <h3 className="text-3xl font-black mb-4 uppercase italic">Global Search</h3>
            <p className="text-white/50">
              Find players, teams, or matches anywhere in the country instantly.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Stats Ticker */}
      <div className="bg-primary py-4 overflow-hidden whitespace-nowrap border-y-2 border-primary-dark">
        <div className="flex animate-marquee">
          {[1,2,3,4,5,6,7,8].map(i => (
            <span key={i} className="text-white font-black uppercase text-2xl mx-10 italic">
              Live: Mumbai vs Delhi • 145/4 (18.2) • Next Match: 4:00 PM • Tournament Registration Open • 
            </span>
          ))}
        </div>
      </div>

      {/* Footer */}
      <footer className="py-20 px-6 border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start gap-12">
          <div>
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 bg-primary rounded flex items-center justify-center">
                <Zap className="text-white fill-white" size={18} />
              </div>
              <span className="text-xl font-black tracking-tighter italic uppercase">Apna Cricket</span>
            </div>
            <p className="text-white/40 max-w-xs">
              Empowering local cricket talent with professional-grade digital tools.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-12">
            <div className="flex flex-col gap-4">
              <span className="font-bold uppercase text-xs tracking-widest text-white/30">Platform</span>
              <a href="#matches" className="text-white/60 hover:text-primary">Matches</a>
              <a href="#tournaments" className="text-white/60 hover:text-primary">Tournaments</a>
              <a href="#" className="text-white/60 hover:text-primary">Players</a>
            </div>
            <div className="flex flex-col gap-4">
              <span className="font-bold uppercase text-xs tracking-widest text-white/30">Company</span>
              <a href="#" className="text-white/60 hover:text-primary">About</a>
              <a href="#" className="text-white/60 hover:text-primary">Vision</a>
              <a href="#" className="text-white/60 hover:text-primary">Contact</a>
            </div>
            <div className="flex flex-col gap-4">
              <span className="font-bold uppercase text-xs tracking-widest text-white/30">Legal</span>
              <a href="#" className="text-white/60 hover:text-primary">Privacy</a>
              <a href="#" className="text-white/60 hover:text-primary">Terms</a>
            </div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto mt-20 pt-8 border-t border-white/5 text-center text-white/20 text-sm">
          © 2026 Apna Cricket. Built for the next generation.
        </div>
      </footer>

      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee {
          display: flex;
          width: fit-content;
          animation: marquee 30s linear infinite;
        }
      `}</style>
      </div>
    </ErrorBoundary>
  );
}
