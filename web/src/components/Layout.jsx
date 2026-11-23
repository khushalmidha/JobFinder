import React, {Suspense,useEffect,useState} from 'react';
import api from '../services/api';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { Mail, Settings, LogOut, Send, Briefcase } from 'lucide-react';

const Layout = ({ onLogout }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [unreadJobs,setUnreadJobs]=useState(0);
  useEffect(()=>{let active=true;const poll=()=>api.get('/career-watch/notifications?view=matching').then(({data})=>{if(active)setUnreadJobs(data.unread||0);}).catch(()=>{});poll();const timer=setInterval(poll,60000);return()=>{active=false;clearInterval(timer);};},[location.pathname]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    if (onLogout) onLogout();
    navigate('/login');
  };

  const navItems = [
    { path: '/jobs', label: 'Jobs', icon: Briefcase },
    { path: '/', label: 'Mails', icon: Mail },
  ];

  return (
    <div className="flex h-screen bg-zinc-950 font-sans text-zinc-300">
      {/* Sidebar */}
      <div className="w-16 md:w-64 shrink-0 bg-zinc-900 border-r border-zinc-800 flex flex-col">
        <div className="p-3 md:p-6 border-b border-zinc-800 flex items-center">
          <div className="w-8 h-8 rounded-lg bg-yellow-500 flex items-center justify-center mr-3 shadow-lg shadow-yellow-500/20">
            <Send className="w-4 h-4 text-zinc-950" />
          </div>
          <h1 className="hidden md:block text-xl font-bold text-zinc-100 tracking-tight">ColdMail</h1>
        </div>
        
        <nav className="flex-1 p-1 md:p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <Link 
                key={item.path} 
                to={item.path}
                aria-label={item.label}
                title={item.label}
                className={`flex items-center px-3 md:px-4 py-3 rounded-lg transition-all duration-200 ${
                  isActive 
                    ? 'bg-zinc-800 text-yellow-400 font-medium' 
                    : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                }`}
              >
                <Icon className={`w-5 h-5 mr-3 ${isActive ? 'text-yellow-400' : 'text-zinc-500'}`} />
                <span className="hidden md:inline">{item.label}</span>{item.path==='/jobs'&&unreadJobs>0&&<span aria-label={`${unreadJobs} unread job notifications`} className="ml-1 rounded bg-yellow-500 px-1 text-xs font-bold text-black">{unreadJobs}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="p-1 md:p-4 border-t border-zinc-800">
          <Link to="/settings" aria-label="Settings" title="Settings" className="flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-zinc-800"><Settings className="h-5 w-5" /><span className="hidden md:inline">Settings</span></Link>
          <button 
            onClick={handleLogout}
            aria-label="Logout"
            className="flex items-center w-full px-3 md:px-4 py-3 text-zinc-400 hover:bg-red-500/10 hover:text-red-400 rounded-lg transition-all duration-200"
          >
            <LogOut className="w-5 h-5 mr-3" />
            <span className="hidden md:inline">Logout</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-w-0 overflow-auto bg-zinc-950">
        <Suspense fallback={<p role="status" className="p-8 text-zinc-400">Loading page...</p>}><Outlet /></Suspense>
      </div>
    </div>
  );
};

export default Layout;
